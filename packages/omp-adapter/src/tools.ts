import type { Stats } from 'node:fs';
import { readFile as readArtifactFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  ArtifactNotFoundError,
  type ArtifactRef,
  type BashResult,
  type CellResult,
  type DebugStackFrame,
  type DebugThread,
  type DirEntry,
  type FileContent,
  type LspDiagnostic,
  type LspLocation,
  type LspStatus,
  type LspSymbol,
  OperationNotSupportedError,
  SessionNotFoundError,
  type SessionTools,
  type TodoPhase,
  ToolExecutionError,
} from '@ai-gui/agent-runtime';
import { ensureTheme } from '@oh-my-pi/pi-coding-agent';
import { getEditStore } from '@oh-my-pi/pi-coding-agent/edit';
import type { TodoPhase as SdkTodoPhase, Tool, ToolSession } from '@oh-my-pi/pi-coding-agent/tools';
import { BUILTIN_TOOLS } from '@oh-my-pi/pi-coding-agent/tools';
import {
  artifactsDirForSessionFile,
  findArtifactFilename,
  hasHashlineSection,
  parseArtifactFilename,
  sliceLinesByRange,
  splitHashlineHeader,
} from './tool-helpers.js';
import { buildToolSession, type ToolSessionHandle } from './tools-session.js';

/**
 * SDK-direct SessionTools: every method executes a real `BUILTIN_TOOLS`
 * factory outside any agent turn.
 *
 * Tool → factory mapping (all from `BUILTIN_TOOLS.<name>(toolSession)`):
 * - readFile/listDir → `read` (ReadTool). listDir resolves + type-checks the
 *   directory through the read tool, then structures entries via node:fs
 *   (the read tool renders listings as text, which carries no sizes).
 * - writeFile → `write` (WriteTool).
 * - editFile → `edit` (EditTool, hashline mode pinned by settings).
 * - runBash → `bash` (BashTool; `timeoutMs` converted to SDK seconds).
 * - runCell/resetKernel → `eval` (EvalTool; reset via `reset: true`).
 * - getTodos/applyTodoOp → `todo` (TodoTool over in-memory session phases).
 * - listArtifacts/readArtifact → no tool exists: resolved from the session
 *   journal's artifact directory with the SDK naming rule (`<id>.<tool>.log`,
 *   `<id>.` prefix match). Needs a registered session file.
 * - lsp* → `lsp` (LspTool; `timeoutMs` converted to SDK seconds). The tool
 *   renders formatted text, so diagnostics/definition/symbols/status are
 *   parsed back into structures (see `parse*` below); hover passes through.
 * - debug* → `debug` (DebugTool over the process-wide DAP singleton; the
 *   tool serializes requests, so no per-session locking here). Structured
 *   state (threads/frames/scopes/variables/sessions/snapshots) comes from
 *   result `details`; `remove_breakpoint` needs file+line or function, so
 *   breakpoint targets are tracked per web session (see `breakpointRegs`).
 *
 * Settings keys consumed (see `session-tool-settings.ts`): `bash.enabled`,
 * `todo.enabled`, `eval.js`, `eval.py`, `lsp.enabled`, `debug.enabled`,
 * `tools.xdev`, `edit.mode`.
 */

interface BuiltTools {
  read: Tool;
  write: Tool;
  edit: Tool;
  bash: Tool;
  eval: Tool;
  todo: Tool;
  lsp: Tool;
  debug: Tool;
}

interface SessionEntry {
  handle: ToolSessionHandle;
  built: BuiltTools | null;
  building: Promise<BuiltTools> | null;
  seq: number;
}

const entries = new Map<string, SessionEntry>();
const cwdRegs = new Map<string, string>();
const fileRegs = new Map<string, string | null>();

/** Register the session cwd (server supplies it from createSession). */
export function setSessionCwd(sessionId: string, cwd: string): void {
  cwdRegs.set(sessionId, cwd);
  const entry = entries.get(sessionId);
  if (entry) entry.handle.session.cwd = cwd;
}

/** Register the durable journal file (server supplies via getSessionFile). */
export function setSessionFile(sessionId: string, file: string | null): void {
  fileRegs.set(sessionId, file);
  const entry = entries.get(sessionId);
  if (entry) entry.handle.setSessionFile(file);
}

/** Forget all per-web-session tool state (server calls on drop). */
export function dropSessionTools(sessionId: string): void {
  entries.delete(sessionId);
  cwdRegs.delete(sessionId);
  fileRegs.delete(sessionId);
  breakpointRegs.delete(sessionId);
  breakpointSeqs.delete(sessionId);
}

function requireEntry(sessionId: string): SessionEntry {
  const existing = entries.get(sessionId);
  if (existing) return existing;
  const cwd = cwdRegs.get(sessionId);
  if (!cwd) throw new SessionNotFoundError(sessionId);
  const handle = buildToolSession({ cwd, sessionFile: fileRegs.get(sessionId) ?? null });
  const entry: SessionEntry = { handle, built: null, building: null, seq: 1 };
  entries.set(sessionId, entry);
  return entry;
}

async function builtTools(entry: SessionEntry, _sessionId: string): Promise<BuiltTools> {
  if (entry.built) return entry.built;
  entry.building ??= (async () => {
    // LSP/debug formatters read the process-global SDK theme; init once.
    await ensureTheme().catch(() => {});
    const session = entry.handle.session;
    const [read, write, edit, bash, evalTool, todo, lsp, debug] = await Promise.all([
      BUILTIN_TOOLS.read(session),
      BUILTIN_TOOLS.write(session),
      BUILTIN_TOOLS.edit(session),
      BUILTIN_TOOLS.bash(session),
      BUILTIN_TOOLS.eval(session),
      BUILTIN_TOOLS.todo(session),
      BUILTIN_TOOLS.lsp(session),
      BUILTIN_TOOLS.debug(session),
    ]);
    const missing = [
      ['read', read],
      ['write', write],
      ['edit', edit],
      ['bash', bash],
      ['eval', evalTool],
      ['todo', todo],
      ['lsp', lsp],
      ['debug', debug],
    ]
      .filter(([, tool]) => !tool)
      .map(([name]) => name);
    if (
      missing.length > 0 ||
      !read ||
      !write ||
      !edit ||
      !bash ||
      !evalTool ||
      !todo ||
      !lsp ||
      !debug
    ) {
      throw new OperationNotSupportedError(`session tools unavailable: ${missing.join(',')}`);
    }
    return { read, write, edit, bash, eval: evalTool, todo, lsp, debug };
  })();
  try {
    entry.built = await entry.building;
    return entry.built;
  } finally {
    entry.building = null;
  }
}

interface ToolTextResult {
  text: string;
  details: Record<string, unknown> | undefined;
}

function resultText(result: { content?: Array<{ type?: unknown; text?: unknown }> }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

async function runTool(
  tool: Tool,
  entry: SessionEntry,
  params: Record<string, unknown>,
  toolName: string,
  opts?: { throwOnError?: boolean },
): Promise<ToolTextResult> {
  const toolCallId = `web-${entry.seq++}`;
  let result: ToolRawResult;
  try {
    result = (await tool.execute(toolCallId, params)) as ToolRawResult;
  } catch (err) {
    throw new ToolExecutionError(toolName, err instanceof Error ? err.message : String(err));
  }
  const text = resultText(result);
  if (result.isError && opts?.throwOnError !== false) {
    throw new ToolExecutionError(toolName, text || 'tool reported an error');
  }
  const details =
    result.details && typeof result.details === 'object'
      ? (result.details as Record<string, unknown>)
      : undefined;
  return { text, details };
}

interface ToolRawResult {
  content?: Array<{ type?: unknown; text?: unknown }>;
  isError?: unknown;
  details?: unknown;
}

interface ReadDetails {
  isDirectory?: unknown;
  resolvedPath?: unknown;
  truncation?: { truncated?: unknown };
  displayContent?: { text?: unknown };
}

function entrySession(entry: SessionEntry): ToolSession {
  return entry.handle.session;
}

function mapTodoPhases(phases: SdkTodoPhase[] | undefined): TodoPhase[] {
  return (phases ?? []).map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map((task) => ({
      content: task.content,
      status: task.status,
      ...(task.blocker !== undefined ? { blocker: task.blocker } : {}),
    })),
  }));
}

async function readFileImpl(sessionId: string, path: string, range?: string): Promise<FileContent> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(
    tools.read,
    entry,
    { path: range ? `${path}:${range}` : path },
    'read',
  );
  const info = (details ?? {}) as ReadDetails;
  if (info.isDirectory === true) {
    throw new ToolExecutionError('read', `path is a directory: ${path}`);
  }
  const displayText = info.displayContent;
  const { body, tag: headerTag } = splitHashlineHeader(text);
  const bodyText = typeof displayText?.text === 'string' ? displayText.text : body;
  let tag = headerTag;
  if (typeof info.resolvedPath === 'string' && info.resolvedPath) {
    tag = getEditStore(entrySession(entry)).headHash(info.resolvedPath) ?? tag;
  }
  return {
    path,
    ...(tag ? { tag } : {}),
    text: bodyText,
    truncated: info.truncation?.truncated === true,
  };
}

async function listDirImpl(sessionId: string, path?: string): Promise<DirEntry[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const target = path ?? session.cwd;
  const { details } = await runTool(tools.read, entry, { path: target }, 'read');
  const info = (details ?? {}) as ReadDetails;
  if (typeof info.resolvedPath !== 'string' || !info.resolvedPath) {
    throw new ToolExecutionError('read', `cannot resolve directory: ${target}`);
  }
  let dirStat: Stats;
  try {
    dirStat = await stat(info.resolvedPath);
  } catch {
    throw new ToolExecutionError('read', `cannot stat directory: ${target}`);
  }
  if (!dirStat.isDirectory()) {
    throw new ToolExecutionError('read', `not a directory: ${target}`);
  }
  let names: string[];
  try {
    names = await readdir(info.resolvedPath);
  } catch (err) {
    throw new ToolExecutionError('read', err instanceof Error ? err.message : String(err));
  }
  const out: DirEntry[] = [];
  for (const name of names) {
    const abs = `${info.resolvedPath}/${name}`;
    let kind: 'file' | 'dir' = 'file';
    let size: number | undefined;
    try {
      const child = await stat(abs);
      kind = child.isDirectory() ? 'dir' : 'file';
      if (!child.isDirectory()) size = child.size;
    } catch {
      /* vanished mid-listing: keep the name without size */
    }
    const rel = relative(session.cwd, abs);
    out.push({
      name,
      path: rel.startsWith('..') || rel === '' ? abs : rel,
      kind,
      ...(size !== undefined ? { size } : {}),
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

async function writeFileImpl(
  sessionId: string,
  path: string,
  content: string,
): Promise<{ bytes: number; tag: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.write, entry, { path, content }, 'write');
  const resolved =
    details && typeof details.resolvedPath === 'string' && details.resolvedPath
      ? (details.resolvedPath as string)
      : resolve(entrySession(entry).cwd, path);
  const store = getEditStore(entrySession(entry));
  const tag = store.headHash(resolved) ?? store.recordSnapshot(resolved, content);
  return { bytes: new TextEncoder().encode(content).length, tag };
}

async function editFileImpl(
  sessionId: string,
  path: string,
  tag: string,
  input: string,
): Promise<{ tag: string; applied: boolean }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const body = hasHashlineSection(input) ? input : `[${path}#${tag}]\n${input}`;
  await runTool(tools.edit, entry, { input: body }, 'edit');
  const abs = resolve(entrySession(entry).cwd, path);
  let next = getEditStore(entrySession(entry)).headHash(abs) ?? undefined;
  if (!next) {
    // Rename/move edits resolve elsewhere: re-read to mint the fresh tag.
    next = (await readFileImpl(sessionId, path)).tag ?? tag;
  }
  return { tag: next, applied: true };
}

async function runBashImpl(
  sessionId: string,
  command: string,
  cwd?: string,
  timeoutMs?: number,
): Promise<BashResult> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Bash surfaces timeouts and non-zero exits as error *results* (not
  // throws), so read output + details unconditionally and only throw when the
  // tool itself throws.
  const { text, details } = await runTool(
    tools.bash,
    entry,
    {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {}),
    },
    'bash',
    { throwOnError: false },
  );
  const info = (details ?? {}) as {
    exitCode?: unknown;
    timedOut?: unknown;
    meta?: { truncation?: unknown };
  };
  return {
    output: text,
    exitCode: typeof info.exitCode === 'number' ? info.exitCode : 0,
    timedOut: info.timedOut === true,
    truncated: info.meta?.truncation != null,
  };
}

function isEvalImage(image: unknown): image is { mimeType: string; data: string } {
  return (
    !!image &&
    typeof image === 'object' &&
    'mimeType' in image &&
    typeof image.mimeType === 'string' &&
    'data' in image &&
    typeof image.data === 'string'
  );
}

async function runCellImpl(
  sessionId: string,
  language: 'py' | 'js',
  code: string,
  title?: string,
): Promise<CellResult> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Like bash, cell failures arrive as error results carrying the traceback
  // as text; only a thrown ToolError (no backend) becomes a 500.
  const { text, details } = await runTool(
    tools.eval,
    entry,
    { language, code, ...(title !== undefined ? { title } : {}) },
    'eval',
    { throwOnError: false },
  );
  const images = (details as { images?: unknown } | undefined)?.images;
  const rendered = Array.isArray(images)
    ? images.flatMap((image) =>
        isEvalImage(image) ? [`data:${image.mimeType};base64,${image.data}`] : [],
      )
    : [];
  return { output: text, ...(rendered.length > 0 ? { images: rendered } : {}) };
}

async function resetKernelImpl(sessionId: string, language: 'py' | 'js'): Promise<{ ok: boolean }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const noop = language === 'py' ? 'pass' : 'void 0;';
  await runTool(tools.eval, entry, { language, code: noop, reset: true }, 'eval');
  return { ok: true };
}

async function getTodosImpl(sessionId: string): Promise<TodoPhase[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.todo, entry, { op: 'view' }, 'todo');
  return mapTodoPhases((details as { phases?: SdkTodoPhase[] } | undefined)?.phases);
}

async function applyTodoOpImpl(
  sessionId: string,
  op: string,
  payload?: unknown,
): Promise<TodoPhase[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const extra = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const { details } = await runTool(tools.todo, entry, { op, ...extra }, 'todo');
  return mapTodoPhases((details as { phases?: SdkTodoPhase[] } | undefined)?.phases);
}

function artifactsDirOrThrow(entry: SessionEntry): string {
  const file = entry.handle.getSessionFile();
  if (!file) {
    throw new OperationNotSupportedError('artifacts: session has no session file yet');
  }
  const dir = artifactsDirForSessionFile(file);
  if (!dir) {
    throw new OperationNotSupportedError('artifacts: session has no session file yet');
  }
  return dir;
}

async function listArtifactsImpl(sessionId: string): Promise<ArtifactRef[]> {
  const entry = requireEntry(sessionId);
  const dir = artifactsDirOrThrow(entry);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ArtifactRef[] = [];
  for (const name of names) {
    const parsed = parseArtifactFilename(name);
    if (!parsed) continue;
    const abs = `${dir}/${name}`;
    try {
      const child = await stat(abs);
      if (child.isDirectory()) continue;
      out.push({ id: parsed.id, kind: parsed.kind, size: child.size, path: abs });
    } catch {
      /* vanished mid-listing */
    }
  }
  out.sort((a, b) => Number(a.id) - Number(b.id));
  return out;
}

async function readArtifactImpl(
  sessionId: string,
  id: string,
  range?: string,
): Promise<{ content: string; truncated: boolean }> {
  const entry = requireEntry(sessionId);
  const dir = artifactsDirOrThrow(entry);
  let names: string[] | null = null;
  try {
    names = await readdir(dir);
  } catch {
    names = null;
  }
  const match = names ? findArtifactFilename(names, id) : null;
  if (!match) throw new ArtifactNotFoundError(id);
  let text: string;
  try {
    text = await readArtifactFile(`${dir}/${match}`, 'utf8');
  } catch {
    throw new ArtifactNotFoundError(id);
  }
  return sliceLinesByRange(text, range);
}

// ---------------------------------------------------------------------------
// LSP (via BUILTIN_TOOLS.lsp execute; formatted text parsed back to structs).
// ---------------------------------------------------------------------------

/** Throw when the lsp tool reports a hard failure instead of a result. */
function throwIfLspError(text: string): void {
  const line = text.trimStart().split('\n', 1)[0] ?? '';
  if (/^(error:|lsp error:|no language server found)/i.test(line)) {
    throw new ToolExecutionError('lsp', text);
  }
}

const DIAG_LINE_RE = /^(\d+):(\d+)\s*\[(error|warning|info|hint)\]\s*(.*)$/i;
const HEADER_RE = /^(#{1,}) (.+?)\/?$/;

/** Regex group or '' (noUncheckedIndexedAccess-safe). */
function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

/** Parse single/multi-file diagnostics text into LspDiagnostic[]. */
function parseDiagnostics(text: string): LspDiagnostic[] {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'OK' || /^no files matched pattern:/i.test(trimmed)) return [];
  const out: LspDiagnostic[] = [];
  // Ungrouped fallback: `path:line:col [sev] message`.
  const ungrouped = /^(.+?):(\d+):(\d+)\s*\[(error|warning|info|hint)\]\s*(.*)$/i;
  // Grouped (`# dir/` / `## file` prefix-folded tree, `  line:col [sev] msg`
  // model lines): track the header stack to rebuild the file path.
  const stack: { depth: number; name: string }[] = [];
  let currentFile: string | null = null;
  const pushFile = (): void => {
    if (stack.length === 0) {
      currentFile = null;
      return;
    }
    currentFile = `${stack.map((part) => part.name).join('/')}`;
  };
  for (const raw of trimmed.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') continue;
    const header = HEADER_RE.exec(line);
    if (header) {
      const depth = group(header, 1).length;
      const name = group(header, 2);
      let top = stack[stack.length - 1];
      while (top && top.depth >= depth) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      stack.push({ depth, name });
      pushFile();
      continue;
    }
    const grouped = DIAG_LINE_RE.exec(line.trim());
    if (grouped && currentFile) {
      out.push({
        file: currentFile,
        line: Number(group(grouped, 1)),
        column: Number(group(grouped, 2)),
        severity: group(grouped, 3).toLowerCase(),
        message: group(grouped, 4),
      });
      continue;
    }
    const flat = ungrouped.exec(line.trim());
    if (flat) {
      out.push({
        file: group(flat, 1),
        line: Number(group(flat, 2)),
        column: Number(group(flat, 3)),
        severity: group(flat, 4).toLowerCase(),
        message: group(flat, 5),
      });
    }
  }
  return out;
}

const DEFINITION_LINE_RE = /^ {2}(.+):(\d+):(\d+)\s*$/;
const SYMBOL_LINE_RE = /^(?:\S+\s+)?(.+?)\s+@\s+(?:line\s+(\d+)|(.+?):(\d+)(?::(\d+))?)\s*$/;

/** Parse `Found N definition(s):\n  file:line:col` (+ context) output. */
function parseLocations(text: string): LspLocation[] {
  const trimmed = text.trim();
  if (/^no .* found/i.test(trimmed)) return [];
  const out: LspLocation[] = [];
  for (const raw of trimmed.split('\n')) {
    const match = DEFINITION_LINE_RE.exec(raw);
    if (match) {
      out.push({
        file: group(match, 1),
        line: Number(group(match, 2)),
        column: Number(group(match, 3)),
      });
    }
  }
  return out;
}
/**
 * Parse symbol lines (`<icon> name [detail] @ line N` document symbols,
 * `<icon> name [(container)] @ file:line:col` workspace symbols).
 */
function parseSymbols(text: string): LspSymbol[] {
  const trimmed = text.trim();
  if (/^no symbols/i.test(trimmed)) return [];
  const out: LspSymbol[] = [];
  for (const raw of trimmed.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') continue;
    if (/symbol\(s\)|symbols in/i.test(line)) continue;
    const match = SYMBOL_LINE_RE.exec(line);
    if (!match) continue;
    const name =
      group(match, 1)
        .replace(/\s*\(.*\)\s*$/, '')
        .trim() || group(match, 1).trim();
    if (match[2] !== undefined) {
      out.push({ name, kind: '', line: Number(match[2]) });
    } else if (match[3] !== undefined) {
      out.push({
        name: `${name} (${group(match, 3)}:${group(match, 4)})`,
        kind: '',
        line: Number(group(match, 4)),
      });
    }
  }
  return out;
}

/** Parse `Language servers: name (status), …` status text. */
function parseLspStatus(text: string): LspStatus {
  const trimmed = text.trim();
  if (/^no language servers configured/i.test(trimmed)) return { servers: [], ok: false };
  const first = trimmed.split('\n', 1)[0] ?? '';
  const list = first.replace(/^language servers:\s*/i, '');
  const servers: { name: string; status: string }[] = [];
  for (const part of list.split(/,\s*/)) {
    const match = /^(.+?)\s*\((.+)\)\s*$/.exec(part.trim());
    if (match) servers.push({ name: group(match, 1), status: group(match, 2) });
  }
  return { servers, ok: servers.some((server) => /ready/i.test(server.status)) };
}

function lspTimeout(timeoutMs?: number): Record<string, unknown> {
  return timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {};
}

async function lspDiagnosticsImpl(
  sessionId: string,
  file: string,
  timeoutMs?: number,
): Promise<LspDiagnostic[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(
    tools.lsp,
    entry,
    { action: 'diagnostics', file, ...lspTimeout(timeoutMs) },
    'lsp',
  );
  throwIfLspError(text);
  return parseDiagnostics(text);
}

async function lspDefinitionImpl(
  sessionId: string,
  file: string,
  line: number,
  symbol: string,
): Promise<LspLocation[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(
    tools.lsp,
    entry,
    { action: 'definition', file, line, symbol },
    'lsp',
  );
  throwIfLspError(text);
  return parseLocations(text);
}

async function lspHoverImpl(
  sessionId: string,
  file: string,
  line: number,
  symbol: string,
): Promise<string> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(tools.lsp, entry, { action: 'hover', file, line, symbol }, 'lsp');
  throwIfLspError(text);
  return text.trim() === 'No hover information' ? '' : text;
}

async function lspSymbolsImpl(
  sessionId: string,
  file: string,
  query?: string,
): Promise<LspSymbol[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const workspace = query !== undefined || file === '*';
  const { text } = await runTool(
    tools.lsp,
    entry,
    workspace ? { action: 'symbols', file: '*', query } : { action: 'symbols', file },
    'lsp',
  );
  throwIfLspError(text);
  return parseSymbols(text);
}

async function lspStatusImpl(sessionId: string): Promise<LspStatus> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(tools.lsp, entry, { action: 'status' }, 'lsp');
  return parseLspStatus(text);
}

// ---------------------------------------------------------------------------
// Debug (via BUILTIN_TOOLS.debug execute; structured state from details).
// ---------------------------------------------------------------------------

export interface DebugBreakpointTarget {
  file?: string;
  line?: number;
  fn?: string;
  condition?: string;
}

/**
 * Map a REST/debug action (+ step kind) to the SDK debug action.
 * Pure (no SDK import) for unit tests.
 */
export function debugSdkAction(action: string, kind?: string): string {
  if (action === 'step') {
    const sdk = STEP_SDK_ACTIONS[kind ?? 'over'];
    if (!sdk) throw new OperationNotSupportedError(`unsupported step kind: ${kind}`);
    return sdk;
  }
  const sdk = DEBUG_SDK_ACTIONS[action];
  if (!sdk) throw new OperationNotSupportedError(`unsupported debug action: ${action}`);
  return sdk;
}

/**
 * Build the SDK `set_breakpoint` params for a contract breakpoint.
 * Pure (no SDK import) for unit tests.
 */
export function buildDebugBreakpointParams(target: DebugBreakpointTarget): Record<string, unknown> {
  if (target.fn) {
    return {
      action: 'set_breakpoint',
      function: target.fn,
      ...(target.condition !== undefined ? { condition: target.condition } : {}),
    };
  }
  if (target.file !== undefined && target.line !== undefined) {
    return {
      action: 'set_breakpoint',
      file: target.file,
      line: target.line,
      ...(target.condition !== undefined ? { condition: target.condition } : {}),
    };
  }
  throw new ToolExecutionError('debug', 'breakpoint requires file+line or fn');
}

/**
 * Build the SDK `remove_breakpoint` params from a tracked breakpoint target.
 * Pure (no SDK import) for unit tests.
 */
export function buildDebugRemoveBreakpointParams(
  target: Pick<DebugBreakpointTarget, 'file' | 'line' | 'fn'>,
): Record<string, unknown> {
  if (target.fn) return { action: 'remove_breakpoint', function: target.fn };
  if (target.file !== undefined && target.line !== undefined) {
    return { action: 'remove_breakpoint', file: target.file, line: target.line };
  }
  throw new ToolExecutionError('debug', 'breakpoint requires file+line or fn');
}

const DEBUG_SDK_ACTIONS: Record<string, string> = {
  launch: 'launch',
  attach: 'attach',
  breakpoint: 'set_breakpoint',
  unbreak: 'remove_breakpoint',
  continue: 'continue',
  pause: 'pause',
  evaluate: 'evaluate',
  threads: 'threads',
  stack: 'stack_trace',
  scopes: 'scopes',
  variables: 'variables',
  output: 'output',
  terminate: 'terminate',
  sessions: 'sessions',
};

const STEP_SDK_ACTIONS: Record<string, string> = {
  over: 'step_over',
  in: 'step_in',
  out: 'step_out',
};

/** Per-web-session breakpoint targets: SDK removal needs file+line|fn, not an id. */
const breakpointRegs = new Map<string, Map<number, DebugBreakpointTarget>>();
const breakpointSeqs = new Map<string, number>();

function trackBreakpoint(sessionId: string, target: DebugBreakpointTarget): number {
  const next = (breakpointSeqs.get(sessionId) ?? 0) + 1;
  breakpointSeqs.set(sessionId, next);
  let reg = breakpointRegs.get(sessionId);
  if (!reg) {
    reg = new Map();
    breakpointRegs.set(sessionId, reg);
  }
  reg.set(next, target);
  return next;
}

function takeBreakpoint(sessionId: string, id: number): DebugBreakpointTarget {
  const target = breakpointRegs.get(sessionId)?.get(id);
  if (!target) throw new ToolExecutionError('debug', `unknown breakpoint id: ${id}`);
  return target;
}

interface DebugDetails {
  snapshot?: { id?: unknown };
  state?: unknown;
  evaluation?: { result?: unknown };
  threads?: Array<{ id?: unknown; name?: unknown }>;
  stackFrames?: Array<{
    id?: unknown;
    name?: unknown;
    source?: { path?: unknown };
    line?: unknown;
  }>;
  scopes?: Array<{ name?: unknown; variablesReference?: unknown }>;
  variables?: Array<{ name?: unknown; value?: unknown }>;
  sessions?: Array<{ id?: unknown; status?: unknown }>;
  output?: unknown;
}

function debugDetails(result: Record<string, unknown> | undefined, tool: string): DebugDetails {
  if (!result || typeof result !== 'object')
    throw new ToolExecutionError(tool, 'missing result details');
  return result as DebugDetails;
}

function snapshotSession(details: DebugDetails): string {
  const id = details.snapshot?.id;
  if (typeof id !== 'string' || !id)
    throw new ToolExecutionError('debug', 'missing session snapshot');
  return id;
}

async function debugLaunchImpl(
  sessionId: string,
  program: string,
  args?: string[],
  cwd?: string,
  adapter?: string,
): Promise<{ session: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: debugSdkAction('launch'),
      program,
      ...(args !== undefined ? { args } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(adapter !== undefined ? { adapter } : {}),
    },
    'debug',
  );
  return { session: snapshotSession(debugDetails(details, 'debug')) };
}

async function debugAttachImpl(
  sessionId: string,
  options: { pid?: number; port?: number; host?: string; adapter?: string; cwd?: string },
): Promise<{ session: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: debugSdkAction('attach'),
      ...(options.pid !== undefined ? { pid: options.pid } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.adapter !== undefined ? { adapter: options.adapter } : {}),
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    },
    'debug',
  );
  return { session: snapshotSession(debugDetails(details, 'debug')) };
}

async function debugBreakpointImpl(
  sessionId: string,
  target: DebugBreakpointTarget,
): Promise<{ id: number }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugBreakpointParams(target), 'debug');
  return { id: trackBreakpoint(sessionId, target) };
}

async function debugRemoveBreakpointImpl(sessionId: string, id: number): Promise<{ ok: boolean }> {
  const target = takeBreakpoint(sessionId, id);
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugRemoveBreakpointParams(target), 'debug');
  breakpointRegs.get(sessionId)?.delete(id);
  return { ok: true };
}

async function debugContinueImpl(sessionId: string): Promise<{ state: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Timeouts arrive as normal outcomes (state + timedOut in details), not
  // throws, so {state} always surfaces.
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('continue') },
    'debug',
    { throwOnError: false },
  );
  const state = debugDetails(details, 'debug').state;
  return { state: typeof state === 'string' ? state : 'running' };
}

async function debugStepImpl(
  sessionId: string,
  kind: 'over' | 'in' | 'out',
): Promise<{ state: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('step', kind) },
    'debug',
    { throwOnError: false },
  );
  const state = debugDetails(details, 'debug').state;
  return { state: typeof state === 'string' ? state : 'running' };
}

async function debugPauseImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: debugSdkAction('pause') }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

async function debugEvaluateImpl(
  sessionId: string,
  expression: string,
  frameId?: number,
): Promise<{ result: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(
    tools.debug,
    entry,
    {
      action: debugSdkAction('evaluate'),
      expression,
      ...(frameId !== undefined ? { frame_id: frameId } : {}),
    },
    'debug',
    { throwOnError: false },
  );
  const result = debugDetails(details, 'debug').evaluation?.result;
  return { result: typeof result === 'string' ? result : text };
}

async function debugThreadsImpl(sessionId: string): Promise<DebugThread[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('threads') },
    'debug',
  );
  return (debugDetails(details, 'debug').threads ?? []).map((thread) => ({
    id: typeof thread.id === 'number' ? thread.id : Number(thread.id ?? 0),
    name: typeof thread.name === 'string' ? thread.name : String(thread.name ?? ''),
  }));
}

async function debugStackImpl(sessionId: string, levels?: number): Promise<DebugStackFrame[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: debugSdkAction('stack'),
      ...(levels !== undefined ? { levels } : {}),
    },
    'debug',
  );
  return (debugDetails(details, 'debug').stackFrames ?? []).map((frame) => ({
    id: typeof frame.id === 'number' ? frame.id : Number(frame.id ?? 0),
    name: typeof frame.name === 'string' ? frame.name : String(frame.name ?? ''),
    ...(typeof frame.source?.path === 'string' ? { file: frame.source.path } : {}),
    ...(typeof frame.line === 'number' ? { line: frame.line } : {}),
  }));
}

async function debugScopesImpl(
  sessionId: string,
  frameId?: number,
): Promise<{ ref: number; name: string }[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: debugSdkAction('scopes'),
      ...(frameId !== undefined ? { frame_id: frameId } : {}),
    },
    'debug',
  );
  return (debugDetails(details, 'debug').scopes ?? []).map((scope) => ({
    ref: typeof scope.variablesReference === 'number' ? scope.variablesReference : 0,
    name: typeof scope.name === 'string' ? scope.name : '',
  }));
}

async function debugVariablesImpl(
  sessionId: string,
  ref: number,
): Promise<{ name: string; value: string }[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('variables'), variable_ref: ref },
    'debug',
  );
  return (debugDetails(details, 'debug').variables ?? []).map((variable) => ({
    name: typeof variable.name === 'string' ? variable.name : '',
    value: typeof variable.value === 'string' ? variable.value : String(variable.value ?? ''),
  }));
}

async function debugOutputImpl(sessionId: string): Promise<{ text: string }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('output') },
    'debug',
  );
  const output = debugDetails(details, 'debug').output;
  return { text: typeof output === 'string' ? output : text };
}

async function debugTerminateImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: debugSdkAction('terminate') }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

async function debugSessionsImpl(sessionId: string): Promise<{ id: string; state: string }[]> {
  const entry = requireEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: debugSdkAction('sessions') },
    'debug',
  );
  return (debugDetails(details, 'debug').sessions ?? []).map((session) => ({
    id: typeof session.id === 'string' ? session.id : String(session.id ?? ''),
    state: typeof session.status === 'string' ? session.status : '',
  }));
}

/** Assemble the SessionTools surface over the per-web-session tool cache. */
export function createSessionTools(): SessionTools {
  return {
    readFile: (input) => readFileImpl(input.sessionId, input.path, input.range),
    listDir: (input) => listDirImpl(input.sessionId, input.path),
    writeFile: (input) => writeFileImpl(input.sessionId, input.path, input.content),
    editFile: (input) => editFileImpl(input.sessionId, input.path, input.tag, input.input),
    runBash: (input) => runBashImpl(input.sessionId, input.command, input.cwd, input.timeoutMs),
    runCell: (input) => runCellImpl(input.sessionId, input.language, input.code, input.title),
    resetKernel: (input) => resetKernelImpl(input.sessionId, input.language),
    getTodos: (input) => getTodosImpl(input.sessionId),
    applyTodoOp: (input) => applyTodoOpImpl(input.sessionId, input.op, input.payload),
    listArtifacts: (input) => listArtifactsImpl(input.sessionId),
    readArtifact: (input) => readArtifactImpl(input.sessionId, input.id, input.range),
    lspDiagnostics: (input) => lspDiagnosticsImpl(input.sessionId, input.file, input.timeoutMs),
    lspDefinition: (input) =>
      lspDefinitionImpl(input.sessionId, input.file, input.line, input.symbol),
    lspHover: (input) => lspHoverImpl(input.sessionId, input.file, input.line, input.symbol),
    lspSymbols: (input) => lspSymbolsImpl(input.sessionId, input.file, input.query),
    lspStatus: (input) => lspStatusImpl(input.sessionId),
    debugLaunch: (input) =>
      debugLaunchImpl(input.sessionId, input.program, input.args, input.cwd, input.adapter),
    debugAttach: (input) =>
      debugAttachImpl(input.sessionId, {
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.port !== undefined ? { port: input.port } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
        ...(input.adapter !== undefined ? { adapter: input.adapter } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      }),
    debugBreakpoint: (input) =>
      debugBreakpointImpl(input.sessionId, {
        ...(input.file !== undefined ? { file: input.file } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.fn !== undefined ? { fn: input.fn } : {}),
        ...(input.condition !== undefined ? { condition: input.condition } : {}),
      }),
    debugRemoveBreakpoint: (input) => debugRemoveBreakpointImpl(input.sessionId, input.id),
    debugContinue: (input) => debugContinueImpl(input.sessionId),
    debugStep: (input) => debugStepImpl(input.sessionId, input.kind),
    debugPause: (input) => debugPauseImpl(input.sessionId),
    debugEvaluate: (input) => debugEvaluateImpl(input.sessionId, input.expression, input.frameId),
    debugThreads: (input) => debugThreadsImpl(input.sessionId),
    debugStack: (input) => debugStackImpl(input.sessionId, input.levels),
    debugScopes: (input) => debugScopesImpl(input.sessionId, input.frameId),
    debugVariables: (input) => debugVariablesImpl(input.sessionId, input.ref),
    debugOutput: (input) => debugOutputImpl(input.sessionId),
    debugTerminate: (input) => debugTerminateImpl(input.sessionId),
    debugSessions: (input) => debugSessionsImpl(input.sessionId),
  };
}
