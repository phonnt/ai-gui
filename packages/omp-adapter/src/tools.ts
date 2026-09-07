import type { Stats } from 'node:fs';
import { readFile as readArtifactFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  ArtifactNotFoundError,
  type ArtifactRef,
  type BashResult,
  type CellResult,
  type DirEntry,
  type FileContent,
  OperationNotSupportedError,
  SessionNotFoundError,
  type SessionTools,
  type TodoPhase,
  ToolExecutionError,
} from '@ai-gui/agent-runtime';
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
 *
 * Settings keys consumed (see `session-tool-settings.ts`): `bash.enabled`,
 * `todo.enabled`, `eval.js`, `eval.py`, `lsp.enabled`, `tools.xdev`,
 * `edit.mode`.
 */

interface BuiltTools {
  read: Tool;
  write: Tool;
  edit: Tool;
  bash: Tool;
  eval: Tool;
  todo: Tool;
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

async function builtTools(entry: SessionEntry, sessionId: string): Promise<BuiltTools> {
  if (entry.built) return entry.built;
  entry.building ??= (async () => {
    const session = entry.handle.session;
    const [read, write, edit, bash, evalTool, todo] = await Promise.all([
      BUILTIN_TOOLS.read(session),
      BUILTIN_TOOLS.write(session),
      BUILTIN_TOOLS.edit(session),
      BUILTIN_TOOLS.bash(session),
      BUILTIN_TOOLS.eval(session),
      BUILTIN_TOOLS.todo(session),
    ]);
    const missing = [
      ['read', read],
      ['write', write],
      ['edit', edit],
      ['bash', bash],
      ['eval', evalTool],
      ['todo', todo],
    ]
      .filter(([, tool]) => !tool)
      .map(([name]) => name);
    if (missing.length > 0 || !read || !write || !edit || !bash || !evalTool || !todo) {
      throw new OperationNotSupportedError(`session tools unavailable: ${missing.join(',')}`);
    }
    return { read, write, edit, bash, eval: evalTool, todo };
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
    details && typeof details['resolvedPath'] === 'string' && details['resolvedPath']
      ? (details['resolvedPath'] as string)
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
  };
}
