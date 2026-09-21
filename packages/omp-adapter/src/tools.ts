import type { Stats } from 'node:fs';
import { readFile as readArtifactFile, readdir, readFile, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  ArtifactNotFoundError,
  type ArtifactRef,
  type BackgroundJob,
  type BashResult,
  type CellResult,
  type ConflictEntry,
  type ConflictSide,
  type DebugStackFrame,
  type DebugThread,
  type DirEntry,
  type FileContent,
  InvalidRequestError,
  type LspDiagnostic,
  type LspLocation,
  type LspStatus,
  type LspSymbol,
  OperationNotSupportedError,
  type PreludeResult,
  SessionNotFoundError,
  type SessionTools,
  type TodoPhase,
  ToolExecutionError,
  type TruncationInfo,
} from '@grove/agent-runtime';
import { ensureTheme, SessionManager } from '@oh-my-pi/pi-coding-agent';
import { getEditStore } from '@oh-my-pi/pi-coding-agent/edit';
import type { EvalPreludeDefinition } from '@oh-my-pi/pi-coding-agent/eval/preludes';
import type { TodoPhase as SdkTodoPhase, Tool, ToolSession } from '@oh-my-pi/pi-coding-agent/tools';
import { BUILTIN_TOOLS } from '@oh-my-pi/pi-coding-agent/tools';
import {
  type ApprovalMode,
  denyError,
  formatApprovalPrompt,
  resolveApproval,
} from '@oh-my-pi/pi-coding-agent/tools/approval';
import { createBrowserPrelude } from '@oh-my-pi/pi-coding-agent/tools/browser';
import { createComputerPrelude } from '@oh-my-pi/pi-coding-agent/tools/computer';
import { getConflictHistory } from '@oh-my-pi/pi-coding-agent/tools/conflict-detect';
import { stripRawOutputArtifactNotice } from '@oh-my-pi/pi-coding-agent/tools/output-meta';
import { toInvalidRequestError, toPathNotFoundError } from './client-errors.js';
import { settingsGet, settingsSnapshot } from './settings.js';
import {
  artifactsDirForSessionFile,
  findArtifactFilename,
  hasHashlineSection,
  parseArtifactFilename,
  sliceLinesByRange,
  splitHashlineHeader,
} from './tool-helpers.js';
import {
  buildToolSession,
  buildToolSessionSettings,
  liveAuthFor,
  liveModelFor,
  liveRegistryFor,
  liveSettingsFor,
  liveSettingsGetterFor,
  sharedJobs,
  type ToolSessionHandle,
} from './tools-session.js';

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
  glob: Tool;
  grep: Tool;
  security: Tool;
}

interface SessionEntry {
  id: string;
  handle: ToolSessionHandle;
  built: BuiltTools | null;
  building: Promise<BuiltTools> | null;
  seq: number;
}

const entries = new Map<string, SessionEntry>();

/** Out-of-turn approval round-trip (installed by the SDK adapter). */
export interface ApprovalBridge {
  requestApproval(sessionId: string, toolName: string, prompt: string): Promise<boolean>;
}

let approvalBridge: ApprovalBridge | undefined;
/**
 * Journal-path resolver supplied by the runtime. The SDK assigns a session's
 * file lazily (first persisted message), so the path must be re-read instead
 * of captured once — it anchors the artifact directory.
 */
let sessionFileResolver: ((sessionId: string) => string | null) | undefined;

export function setSessionFileResolver(
  resolver: ((sessionId: string) => string | null) | undefined,
): void {
  sessionFileResolver = resolver;
}

export function setApprovalBridge(bridge: ApprovalBridge | undefined): void {
  approvalBridge = bridge;
}
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

async function ensureEntry(sessionId: string): Promise<SessionEntry> {
  const existing = entries.get(sessionId);
  if (existing) {
    const known = fileRegs.get(sessionId) ?? null;
    if (known && existing.handle.getSessionFile() !== known) {
      existing.handle.setSessionFile(known);
    }
    await syncApprovalSettings(existing).catch(() => {});
    return existing;
  }
  let cwd = cwdRegs.get(sessionId);
  let file: string | null = fileRegs.get(sessionId) ?? null;
  if (!file && sessionFileResolver) {
    file = sessionFileResolver(sessionId);
    if (file) fileRegs.set(sessionId, file);
  }
  if (!cwd || !file) {
    // Resolve cwd (server restart) and the journal path. The journal is what
    // anchors the artifact directory, so a missing path costs every truncated
    // result its artifact:// link.
    const infos = await SessionManager.listAll();
    const info = infos.find((candidate) => candidate.id === sessionId);
    if (!info) {
      if (!cwd) throw new SessionNotFoundError(sessionId);
    } else {
      if (!cwd) {
        cwd = info.cwd;
        cwdRegs.set(sessionId, cwd);
      }
      if (!file && info.path) {
        file = info.path;
        fileRegs.set(sessionId, file);
      }
    }
  }
  const seed = liveSettingsFor(sessionId);
  const registry = liveRegistryFor(sessionId);
  const authStorage = liveAuthFor(sessionId);
  const handle = buildToolSession({
    cwd: cwd as string,
    sessionFile: file,
    ...(seed ? { settingsSeed: seed } : {}),
    ...(registry ? { modelRegistry: registry } : {}),
    ...(authStorage ? { authStorage } : {}),
    ...(liveModelFor(sessionId) ? { getActiveModel: liveModelFor(sessionId) } : {}),
  });
  const entry: SessionEntry = { id: sessionId, handle, built: null, building: null, seq: 1 };
  entries.set(sessionId, entry);

  await syncApprovalSettings(entry).catch(() => {});
  return entry;
}
/**
 * Shared ToolSession for a web session (hub spawn reuses the same cwd,
 * settings, registry and job manager as the file/bash/eval tools).
 */
export async function getToolSession(sessionId: string): Promise<ToolSession> {
  return (await ensureEntry(sessionId)).handle.session;
}

/**
 * Cwd for a web session, reattaching from the on-disk listing after a
 * server restart. Used by the server jail when its in-memory registry is
 * empty. Truly unknown ids still 404.
 */
export async function resolveToolCwd(sessionId: string): Promise<string> {
  return (await ensureEntry(sessionId)).handle.session.cwd;
}

async function builtTools(entry: SessionEntry, _sessionId: string): Promise<BuiltTools> {
  if (entry.built) return entry.built;
  entry.building ??= (async () => {
    // LSP/debug formatters read the process-global SDK theme; init once.
    await ensureTheme().catch(() => {});
    const session = entry.handle.session;
    const [read, write, edit, bash, evalTool, todo, lsp, debug, glob, grep, securityScan] =
      await Promise.all([
        BUILTIN_TOOLS.read(session),
        BUILTIN_TOOLS.write(session),
        BUILTIN_TOOLS.edit(session),
        BUILTIN_TOOLS.bash(session),
        BUILTIN_TOOLS.eval(session),
        BUILTIN_TOOLS.todo(session),
        BUILTIN_TOOLS.lsp(session),
        BUILTIN_TOOLS.debug(session),
        BUILTIN_TOOLS.glob(session),
        BUILTIN_TOOLS.grep(session),
        BUILTIN_TOOLS.security_scan(session),
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
      ['glob', glob],
      ['grep', grep],
      ['security_scan', securityScan],
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
      !debug ||
      !glob ||
      !grep ||
      !securityScan
    ) {
      throw new OperationNotSupportedError(`session tools unavailable: ${missing.join(',')}`);
    }
    return {
      read,
      write,
      edit,
      bash,
      eval: evalTool,
      todo,
      lsp,
      debug,
      glob,
      grep,
      security: securityScan,
    };
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

function normalizeApprovalMode(value: unknown): ApprovalMode {
  return value === 'always-ask' || value === 'write' || value === 'yolo' ? value : 'yolo';
}

/**
 * Mirror effective approval config (mode, per-tool policies, bash patterns)
 * from global/project settings into the handle's isolated settings, so
 * out-of-turn tools resolve exactly like in-turn ones.
 */
async function syncApprovalSettings(entry: SessionEntry): Promise<void> {
  const session = entry.handle.session;
  const cwd = session.cwd;
  const [mode, policies, patterns] = await Promise.all([
    settingsGet('tools.approvalMode', { cwd }).then(
      (e) => e.value,
      () => undefined,
    ),
    settingsGet('tools.approval', { cwd }).then(
      (e) => e.value,
      () => undefined,
    ),
    settingsGet('bash.patterns', { cwd }).then(
      (e) => e.value,
      () => undefined,
    ),
  ]);
  session.settings.set('tools.approvalMode', normalizeApprovalMode(mode) as never);
  if (policies && typeof policies === 'object' && !Array.isArray(policies)) {
    session.settings.set('tools.approval', policies as never);
  }
  if (Array.isArray(patterns)) {
    session.settings.set('bash.patterns', patterns as never);
  }
}
function resultText(result: { content?: Array<{ type?: unknown; text?: unknown }> }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n');
}

/**
 * Conflict regions the `read` tool registered for this session. The history
 * lives on the shared ToolSession, so ids match what a `write` to
 * `conflict://<id>` will splice.
 */
export async function listConflictsImpl(sessionId: string): Promise<ConflictEntry[]> {
  const entry = await ensureEntry(sessionId);
  return getConflictHistory(entry.handle.session)
    .entries()
    .map((conflict) => ({
      id: conflict.id,
      path: conflict.displayPath,
      startLine: conflict.startLine,
      endLine: conflict.endLine,
      oursLabel: conflict.oursLabel ?? null,
      theirsLabel: conflict.theirsLabel ?? null,
      hasBase: conflict.baseLine !== undefined,
    }));
}

/**
 * Resolve conflicts by writing the SDK's `conflict://` URIs (one per id, or
 * the `conflict://*` bulk form for every known block). Returns the count.
 */
export async function resolveConflictsImpl(
  sessionId: string,
  ids: number[],
  side: ConflictSide,
): Promise<number> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const token = `@${side}`;
  if (ids.length === 0) {
    await runTool(tools.write, entry, { path: 'conflict://*', content: token }, 'write');
    return listConflictsImpl(sessionId).then((remaining) => remaining.length);
  }
  for (const id of ids) {
    await runTool(tools.write, entry, { path: `conflict://${id}`, content: token }, 'write');
  }
  return listConflictsImpl(sessionId).then((remaining) => remaining.length);
}

/**
 * Out-of-turn approval gate (mirrors the in-process ExtensionToolWrapper):
 * resolve policy/tier, deny fast, suspend for a web decision on prompt.
 */
async function checkToolApproval(
  tool: Tool,
  entry: SessionEntry,
  params: Record<string, unknown>,
  toolName: string,
): Promise<void> {
  const settings = entry.handle.session.settings;
  const mode = normalizeApprovalMode(settings.get('tools.approvalMode'));
  const rawPolicies = settings.get('tools.approval');
  const userConfig =
    rawPolicies && typeof rawPolicies === 'object' && !Array.isArray(rawPolicies)
      ? (rawPolicies as Record<string, unknown>)
      : {};
  const resolved = resolveApproval(tool, params, mode, userConfig);
  if (resolved.policy === 'deny') {
    throw new ToolExecutionError(toolName, denyError(resolved, toolName).message);
  }
  if (resolved.policy !== 'prompt') return;
  if (!approvalBridge) {
    throw new ToolExecutionError(
      toolName,
      `Tool call needs approval: set tools.approval.${resolved.policyKey ?? toolName} to allow (no approval UI wired)`,
    );
  }
  const approved = await approvalBridge.requestApproval(
    entry.id,
    toolName,
    formatApprovalPrompt(tool, params, resolved.reason),
  );
  if (!approved) throw new ToolExecutionError(toolName, `Tool call denied by user: ${toolName}`);
}

async function runTool(
  tool: Tool,
  entry: SessionEntry,
  params: Record<string, unknown>,
  toolName: string,
  opts?: { throwOnError?: boolean; onUpdate?: (text: string, details?: unknown) => void },
): Promise<ToolTextResult> {
  const toolCallId = `web-${entry.seq++}`;
  await checkToolApproval(tool, entry, params, toolName);
  let result: ToolRawResult;
  try {
    result = opts?.onUpdate
      ? ((await tool.execute(toolCallId, params, undefined, ((update: ToolRawResult) =>
          opts.onUpdate?.(resultText(update), update.details)) as never)) as ToolRawResult)
      : ((await tool.execute(toolCallId, params)) as ToolRawResult);
  } catch (err) {
    throw (
      toPathNotFoundError(err) ??
      toInvalidRequestError(err) ??
      new ToolExecutionError(toolName, err instanceof Error ? err.message : String(err))
    );
  }
  const text = resultText(result);
  if (result.isError && opts?.throwOnError !== false) {
    throw (
      toPathNotFoundError(text) ??
      toInvalidRequestError(text) ??
      new ToolExecutionError(toolName, text || 'tool reported an error')
    );
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
  const entry = await ensureEntry(sessionId);
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
  const truncation = toTruncationInfo(info.truncation);
  return {
    path,
    ...(tag ? { tag } : {}),
    text: bodyText,
    truncated: truncation !== undefined || info.truncation?.truncated === true,
    ...(truncation ? { truncation } : {}),
  };
}

async function listDirImpl(sessionId: string, path?: string): Promise<DirEntry[]> {
  const entry = await ensureEntry(sessionId);
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

/**
 * Live output tails for background jobs the web started, keyed by job id.
 *
 * The SDK's job manager keeps only the latest *details* per job, so a running
 * job's text is unreachable through it; capturing the tool's progress updates
 * here is what makes a live tail possible for detached commands we launch.
 * In-turn background jobs (started by the agent) surface their output once
 * they settle, via the job's result text.
 */
const jobTails = new Map<string, string>();
const JOB_TAIL_LIMIT = 32_000;

/** Accumulate a chunk for a job, keeping the last {@link JOB_TAIL_LIMIT} chars. */
function appendJobTail(jobId: string, text: string): void {
  if (!text) return;
  const next = `${jobTails.get(jobId) ?? ''}${text}`;
  jobTails.set(jobId, next.length > JOB_TAIL_LIMIT ? next.slice(-JOB_TAIL_LIMIT) : next);
}

/**
 * Workspace glob via the SDK `find` tool outside any turn. Display paths are
 * made cwd-relative so the UI can paste them straight into a prompt.
 */
export async function globFilesImpl(
  sessionId: string,
  pattern: string,
  limit = 100,
): Promise<{ paths: string[]; truncated: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const capped = Math.max(1, Math.min(500, limit));
  const { details } = await runTool(tools.glob, entry, { path: pattern, limit: capped }, 'glob');
  const info = (details ?? {}) as { files?: unknown; truncated?: unknown };
  const files = Array.isArray(info.files)
    ? info.files.filter((f): f is string => typeof f === 'string')
    : [];
  const paths = files.map((file) => {
    const rel = relative(session.cwd, resolve(session.cwd, file));
    return rel.startsWith('..') ? file : rel;
  });
  return { paths, truncated: info.truncated === true || files.length > capped };
}

async function writeFileImpl(
  sessionId: string,
  path: string,
  content: string,
): Promise<{ bytes: number; tag: string }> {
  const entry = await ensureEntry(sessionId);
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
  const entry = await ensureEntry(sessionId);
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

/**
 * Content search via the SDK `grep` tool outside any turn. Paths are returned
 * cwd-relative; `text` is the tool's own pre-formatted rendering, so the UI
 * never re-implements the hashline/gutter format.
 */
export async function grepFilesImpl(
  sessionId: string,
  pattern: string,
  path?: string,
  caseSensitive?: boolean,
  skip?: number,
): Promise<{
  files: { path: string; count: number }[];
  text: string;
  matchCount: number;
  truncated: boolean;
}> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const { text, details } = await runTool(
    tools.grep,
    entry,
    {
      pattern,
      ...(path !== undefined ? { path } : {}),
      ...(caseSensitive ? { case: true } : {}),
      ...(skip !== undefined ? { skip } : {}),
    },
    'grep',
    { throwOnError: false },
  );
  const info = (details ?? {}) as {
    files?: unknown;
    fileMatches?: unknown;
    matchCount?: unknown;
    truncated?: unknown;
    displayContent?: unknown;
  };
  const toRel = (value: string): string => {
    const rel = relative(session.cwd, resolve(session.cwd, value));
    return rel.startsWith('..') ? value : rel;
  };
  const fromFileMatches = Array.isArray(info.fileMatches)
    ? info.fileMatches
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const rec = item as { path?: unknown; count?: unknown };
          if (typeof rec.path !== 'string') return null;
          return { path: toRel(rec.path), count: typeof rec.count === 'number' ? rec.count : 0 };
        })
        .filter((item): item is { path: string; count: number } => item !== null)
    : [];
  const fromFiles = Array.isArray(info.files)
    ? info.files
        .filter((item): item is string => typeof item === 'string')
        .map((file) => ({ path: toRel(file), count: 0 }))
    : [];
  return {
    files: fromFileMatches.length > 0 ? fromFileMatches : fromFiles,
    text: typeof info.displayContent === 'string' ? info.displayContent : text,
    matchCount: typeof info.matchCount === 'number' ? info.matchCount : 0,
    truncated: info.truncated === true,
  };
}

/**
 * Eval-prelude host calls (`browser`, `computer`).
 *
 * Both preludes are the SDK's own bridge: they own tab supervision, CDP, the
 * desktop controller and screenshot storage. The web calls the same `invoke`
 * the eval snippet would, so nothing about the automation is re-implemented
 * here — only the transport.
 */

/**
 * Re-seed the tool session's settings from the live session.
 *
 * The tool session holds an isolated settings instance seeded at attach time,
 * but the SDK reads user-facing keys at call time (browser mode/headless,
 * prelude gates, timeouts). Without a refresh those reads see attach-time
 * values, so a setting toggled in the UI never reaches the tool.
 */
function refreshToolSessionSettings(entry: SessionEntry, sessionId: string): void {
  const live = liveSettingsGetterFor(sessionId)?.();
  if (!live) return;
  try {
    entry.handle.session.settings = buildToolSessionSettings(settingsSnapshot(live));
  } catch {
    /* keep the previous settings when the live session cannot be snapshotted */
  }
}

const preludeCache = new Map<
  string,
  { browser?: EvalPreludeDefinition; computer?: EvalPreludeDefinition }
>();

function preludesFor(entry: SessionEntry): {
  browser?: EvalPreludeDefinition;
  computer?: EvalPreludeDefinition;
} {
  const existing = preludeCache.get(entry.id);
  if (existing) return existing;
  const fresh: { browser?: EvalPreludeDefinition; computer?: EvalPreludeDefinition } = {
    browser: createBrowserPrelude(entry.handle.session),
    computer: createComputerPrelude(entry.handle.session),
  };
  preludeCache.set(entry.id, fresh);
  return fresh;
}

const PRELUDE_IMAGE_LIMIT = 4_000_000;

/** Data URLs for the image parts a prelude returned, plus screenshot files. */
async function preludeImages(result: {
  content?: unknown;
  details?: unknown;
}): Promise<string[] | undefined> {
  const images: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as { type?: unknown; data?: unknown; mimeType?: unknown; source?: unknown };
    if (record.type !== 'image') continue;
    const data = typeof record.data === 'string' ? record.data : undefined;
    const mime = typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
    if (data) images.push(`data:${mime};base64,${data}`);
  }
  // Screenshots are written to disk; the run only returns their metadata, so
  // the bytes are read back here for the pane to render.
  const details = result.details as { screenshots?: unknown } | undefined;
  const shots = Array.isArray(details?.screenshots) ? details.screenshots : [];
  for (const shot of shots) {
    if (!shot || typeof shot !== 'object') continue;
    const record = shot as { dest?: unknown; mimeType?: unknown; bytes?: unknown };
    if (typeof record.dest !== 'string') continue;
    if (typeof record.bytes === 'number' && record.bytes > PRELUDE_IMAGE_LIMIT) continue;
    try {
      const bytes = await readFile(record.dest);
      const mime = typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
      images.push(`data:${mime};base64,${bytes.toString('base64')}`);
    } catch {
      /* screenshot file vanished: the metadata still reaches the client */
    }
  }
  return images.length > 0 ? images : undefined;
}

/** Shared plumbing for both prelude passthroughs. */
async function runPreludeAction(
  sessionId: string,
  params: Record<string, unknown>,
  which: 'browser' | 'computer',
): Promise<PreludeResult> {
  const setting = which === 'browser' ? 'browser.enabled' : 'computer.enabled';
  // Gate first: `ensureEntry` builds the whole tool session (the preludes probe
  // the OS for displays and screen-recording permission), which took 25-33s
  // before answering "disabled". The live settings getter is registered at
  // attach, so a disabled prelude can fail without building anything.
  const liveSettings = liveSettingsGetterFor(sessionId)?.();
  if (liveSettings && liveSettings.get(setting) !== true) {
    throw new InvalidRequestError(
      `${which} is disabled. Enable ${setting} before using the ${which} pane.`,
    );
  }
  const entry = await ensureEntry(sessionId);
  refreshToolSessionSettings(entry, sessionId);
  // Read the live session's settings: the tool session's copy is a snapshot
  // taken at attach, so a toggle made afterwards would be ignored here.
  const settings = liveSettingsGetterFor(sessionId)?.() ?? entry.handle.session.settings;
  if (settings.get(setting) !== true) {
    throw new InvalidRequestError(
      `${which} is disabled. Enable ${setting} before using the ${which} pane.`,
    );
  }
  const prelude = preludesFor(entry)[which];
  if (!prelude) throw new InvalidRequestError(`${which} prelude is unavailable`);
  const result = (await prelude.invoke(params, {
    session: entry.handle.session,
    toolCallId: `web-prelude-${entry.seq++}`,
  })) as { content?: unknown; details?: unknown };
  const images = await preludeImages(result);
  return {
    text: resultText(result as ToolRawResult),
    details:
      result.details && typeof result.details === 'object'
        ? (result.details as Record<string, unknown>)
        : undefined,
    ...(images ? { images } : {}),
  };
}

export async function browserActionImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<PreludeResult> {
  return runPreludeAction(sessionId, params, 'browser');
}

export async function computerActionImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<PreludeResult> {
  return runPreludeAction(sessionId, params, 'computer');
}

const ASYNC_JOB_TAIL_LIMIT = 8_000;

/** Background jobs (running + recent) with whatever output we hold for them. */
export async function listJobsImpl(sessionId: string): Promise<BackgroundJob[]> {
  // Jobs are process-wide, so this used to answer 200 {"jobs":[]} for a session
  // that does not exist: a client could not tell "no jobs" from "no session".
  await ensureEntry(sessionId);
  const seen = new Map<string, BackgroundJob>();
  const toJob = (job: {
    id: string;
    type: unknown;
    status: string;
    label: string;
    startTime: number;
    agentId?: string | undefined;
    resultText?: string | undefined;
    errorText?: string | undefined;
  }): BackgroundJob => {
    const tail = jobTails.get(job.id);
    const settled = typeof job.resultText === 'string' ? job.resultText : undefined;
    const output = tail ?? settled;
    return {
      id: job.id,
      type: String(job.type),
      status: job.status as BackgroundJob['status'],
      label: job.label,
      startedAt: new Date(job.startTime).toISOString(),
      durationMs: Math.max(0, Date.now() - job.startTime),
      ...(job.agentId !== undefined ? { agentId: job.agentId } : {}),
      ...(output !== undefined
        ? {
            output:
              output.length > ASYNC_JOB_TAIL_LIMIT ? output.slice(-ASYNC_JOB_TAIL_LIMIT) : output,
          }
        : {}),
      ...(typeof job.errorText === 'string' ? { errorText: job.errorText } : {}),
    };
  };
  for (const job of sharedJobs.getRunningJobs()) seen.set(job.id, toJob(job));
  for (const job of sharedJobs.getRecentJobs()) if (!seen.has(job.id)) seen.set(job.id, toJob(job));
  return [...seen.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function cancelJobImpl(
  sessionId: string,
  id: string,
): Promise<{ cancelled: boolean }> {
  await ensureEntry(sessionId);
  const cancelled = sharedJobs.cancel(id);
  return { cancelled };
}

/**
 * Detached bash owned by the adapter.
 *
 * The SDK's async bash path suppresses progress forwarding once a run is
 * backgrounded (`forwardUpdates: !startBackgrounded`), so a tool-level tail is
 * impossible for detached commands — the TUI only shows them in the job list.
 * Spawning here keeps the exact job↔output pairing: the run is registered in
 * the same process-wide job manager (so the jobs list and cancel still see it)
 * while every chunk is kept in {@link jobTails} for a live tail.
 *
 * Divergence from the tool path, by design: no output artifact file, no PTY
 * (detached PTY stays unsupported), and no auto-background of foreground runs.
 */
async function runDetachedBash(input: {
  entry: SessionEntry;
  tool: Tool;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<BashResult> {
  const { entry, tool } = input;
  const session = entrySession(entry);
  const params: Record<string, unknown> = {
    command: input.command,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.timeoutMs !== undefined
      ? { timeout: Math.max(1, Math.ceil(input.timeoutMs / 1000)) }
      : {}),
    ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    async: true,
  };
  // Same gate as a foreground run: a denied command never spawns.
  await checkToolApproval(tool, entry, params, 'bash');

  const label = input.command.length > 120 ? `${input.command.slice(0, 117)}...` : input.command;
  const cwd = input.cwd ?? session.cwd;
  const jobId = sharedJobs.register(
    'bash',
    label,
    async ({ jobId: id, signal, reportProgress }) => {
      const child = Bun.spawn(['bash', '-lc', input.command], {
        cwd,
        env: { ...process.env, ...(input.env ?? {}) },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const onAbort = (): void => {
        child.kill('SIGTERM');
      };
      signal.addEventListener('abort', onAbort, { once: true });

      let tail = '';
      const collect = (chunk: string): void => {
        tail =
          tail.length + chunk.length > JOB_TAIL_LIMIT
            ? (tail + chunk).slice(-JOB_TAIL_LIMIT)
            : tail + chunk;
        appendJobTail(id, chunk);
        void reportProgress(tail, { async: { state: 'running', jobId: id, type: 'bash' } });
      };
      const pump = async (stream: ReadableStream<Uint8Array> | null | undefined): Promise<void> => {
        if (!stream) return;
        const decoder = new TextDecoder();
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) collect(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
        }
      };

      let timedOut = false;
      const timer =
        input.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
            }, input.timeoutMs)
          : undefined;
      try {
        await Promise.all([pump(child.stdout), pump(child.stderr)]);
        const exitCode = await child.exited;
        if (timedOut)
          throw new ToolExecutionError('bash', `command timed out after ${input.timeoutMs}ms`);
        if (signal.aborted) return tail;
        if (exitCode !== 0) {
          // Mirror the tool: a non-zero exit is a failed job carrying its text.
          throw new ToolExecutionError('bash', tail.trim() || `exit ${exitCode}`);
        }
        return tail;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
    { ownerId: session.getAgentId?.() ?? undefined },
  );

  return {
    output: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    jobId,
  };
}

async function runBashImpl(
  sessionId: string,
  command: string,
  cwd?: string,
  timeoutMs?: number,
  env?: Record<string, string>,
  pty?: boolean,
  detach?: boolean,
): Promise<BashResult> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  if (detach) {
    return runDetachedBash({
      entry,
      tool: tools.bash,
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(env !== undefined ? { env } : {}),
    });
  }
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
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
      ...(pty ? { pty: true } : {}),
    },
    'bash',
    { throwOnError: false },
  );
  const info = (details ?? {}) as {
    exitCode?: unknown;
    timedOut?: unknown;
    meta?: { truncation?: unknown };
    async?: { jobId?: unknown };
  };
  // Bash reports its spill artifact in a trailing footer rather than the meta
  // block; lift it out so callers get a real artifact:// link.
  const { text: output, artifactId } = stripRawOutputArtifactNotice(text);
  const base = toTruncationInfo(info.meta?.truncation);
  const truncation =
    base === undefined && artifactId === undefined
      ? undefined
      : {
          ...(base ?? {
            direction: 'tail' as const,
            truncatedBy: 'lines' as const,
            totalLines: 0,
            totalBytes: 0,
          }),
          ...(artifactId ? { artifactId } : {}),
        };
  return {
    output,
    exitCode: typeof info.exitCode === 'number' ? info.exitCode : 0,
    timedOut: info.timedOut === true,
    truncated: truncation !== undefined,
    ...(truncation ? { truncation } : {}),
    ...(typeof info.async?.jobId === 'string' ? { jobId: info.async.jobId } : {}),
  };
}

/**
 * Map the SDK's `TruncationMeta` to the contract's TruncationInfo. Returns
 * undefined when the tool did not truncate, so callers can spread it.
 */
function toTruncationInfo(raw: unknown): TruncationInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const meta = raw as Record<string, unknown>;
  const direction = meta.direction;
  const truncatedBy = meta.truncatedBy;
  if (direction !== 'head' && direction !== 'tail' && direction !== 'middle') return undefined;
  if (truncatedBy !== 'lines' && truncatedBy !== 'bytes' && truncatedBy !== 'middle') {
    return undefined;
  }
  const range = (value: unknown): { start: number; end: number } | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const r = value as { start?: unknown; end?: unknown };
    return typeof r.start === 'number' && typeof r.end === 'number'
      ? { start: r.start, end: r.end }
      : undefined;
  };
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const info: TruncationInfo = {
    direction,
    truncatedBy,
    totalLines: num(meta.totalLines) ?? 0,
    totalBytes: num(meta.totalBytes) ?? 0,
  };
  const shown = range(meta.shownRange);
  if (shown) info.shownRange = shown;
  const head = range(meta.headRange);
  if (head) info.headRange = head;
  const tail = range(meta.tailRange);
  if (tail) info.tailRange = tail;
  const elided = num(meta.elidedLines);
  if (elided !== undefined) info.elidedLines = elided;
  const next = num(meta.nextOffset);
  if (next !== undefined) info.nextOffset = next;
  if (typeof meta.artifactId === 'string' && meta.artifactId) info.artifactId = meta.artifactId;
  return info;
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
  timeoutMs?: number,
  reset?: boolean,
): Promise<CellResult> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Like bash, cell failures arrive as error results carrying the traceback
  // as text; only a thrown ToolError (no backend) becomes a 500.
  const { text, details } = await runTool(
    tools.eval,
    entry,
    {
      language,
      code,
      ...(title !== undefined ? { title } : {}),
      ...(timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {}),
      ...(reset ? { reset: true } : {}),
    },
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const noop = language === 'py' ? 'pass' : 'void 0;';
  await runTool(tools.eval, entry, { language, code: noop, reset: true }, 'eval');
  return { ok: true };
}

async function getTodosImpl(sessionId: string): Promise<TodoPhase[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.todo, entry, { op: 'view' }, 'todo');
  return mapTodoPhases((details as { phases?: SdkTodoPhase[] } | undefined)?.phases);
}

async function applyTodoOpImpl(
  sessionId: string,
  op: string,
  payload?: unknown,
): Promise<TodoPhase[]> {
  const entry = await ensureEntry(sessionId);
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
  const entry = await ensureEntry(sessionId);
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
): Promise<{ content: string; truncated: boolean; truncation?: TruncationInfo }> {
  const entry = await ensureEntry(sessionId);
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
  const slice = sliceLinesByRange(text, range);
  if (!slice.truncated) return slice;
  // Paging hint for range reads: the next window after the one just served.
  const totalLines = text.split('\n').length;
  const shownStart = rangeStartOf(range) ?? 1;
  return {
    ...slice,
    truncation: {
      direction: 'head',
      truncatedBy: 'lines',
      totalLines,
      totalBytes: text.length,
      shownRange: { start: shownStart, end: shownStart + slice.content.split('\n').length - 1 },
      nextOffset: shownStart + slice.content.split('\n').length,
    },
  };
}

/** First line of a `N`/`N-M`/`-N` range string (1-indexed), when parseable. */
function rangeStartOf(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const single = /^(\d+)$/.exec(range.trim());
  if (single) return Number(single[1]);
  const window = /^(\d*)-/.exec(range.trim());
  if (!window) return undefined;
  return window[1] ? Number(window[1]) : undefined;
}

// ---------------------------------------------------------------------------
// LSP (via BUILTIN_TOOLS.lsp execute; formatted text parsed back to structs).
// ---------------------------------------------------------------------------

/** Throw when the lsp tool reports a hard failure instead of a result. */
function throwIfLspError(text: string): void {
  const line = text.trimStart().split('\n', 1)[0] ?? '';
  if (/^(error:|lsp error:|no language server found)/i.test(line)) {
    // A missing language server is a caller condition (per-session/cwd config),
    // not a Grove fault; classify before falling back to a tool failure.
    throw toInvalidRequestError(text) ?? new ToolExecutionError('lsp', text);
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(
    tools.lsp,
    entry,
    { action: 'diagnostics', file, ...lspTimeout(timeoutMs) },
    'lsp',
  );
  throwIfLspError(text);
  const diagnostics = parseDiagnostics(text);
  if (diagnostics.length === 0) {
    // Empty text means either "no diagnostics" or "no language server"; only the
    // status tells them apart, and answering 200 with no server hides a real
    // misconfiguration (symbols already refuses in that case).
    const status = await lspStatusImpl(sessionId);
    if (!status.ok) throw new InvalidRequestError('No language server configured for this session');
  }
  return diagnostics;
}

async function lspDefinitionImpl(
  sessionId: string,
  file: string,
  line: number,
  symbol: string,
): Promise<LspLocation[]> {
  const entry = await ensureEntry(sessionId);
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
  const entry = await ensureEntry(sessionId);
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
  const entry = await ensureEntry(sessionId);
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
  const entry = await ensureEntry(sessionId);
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
/**
 * Raw LSP request: forwards the TUI's own parameter object to the lsp tool, so
 * every action the SDK supports (references, rename, code_actions, reload, …)
 * works without the backend re-deriving per-action shapes. Returns the tool's
 * text output plus its structured details.
 */
export async function lspRequestImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<{ text: string; details: Record<string, unknown> | undefined }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  return runTool(tools.lsp, entry, params, 'lsp');
}

/** Raw debug request, same rationale as {@link lspRequestImpl}. */
export async function debugRequestImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<{ text: string; details: Record<string, unknown> | undefined }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  return runTool(tools.debug, entry, params, 'debug');
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: 'launch',
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: 'attach',
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugBreakpointParams(target), 'debug');
  return { id: trackBreakpoint(sessionId, target) };
}

async function debugRemoveBreakpointImpl(sessionId: string, id: number): Promise<{ ok: boolean }> {
  const target = takeBreakpoint(sessionId, id);
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugRemoveBreakpointParams(target), 'debug');
  breakpointRegs.get(sessionId)?.delete(id);
  return { ok: true };
}

async function debugContinueImpl(sessionId: string): Promise<{ state: string }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Timeouts arrive as normal outcomes (state + timedOut in details), not
  // throws, so {state} always surfaces.
  const { details } = await runTool(tools.debug, entry, { action: 'continue' }, 'debug', {
    throwOnError: false,
  });
  const state = debugDetails(details, 'debug').state;
  return { state: typeof state === 'string' ? state : 'running' };
}

async function debugStepImpl(
  sessionId: string,
  kind: 'over' | 'in' | 'out',
): Promise<{ state: string }> {
  const action = kind === 'in' ? 'step_in' : kind === 'out' ? 'step_out' : 'step_over';
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.debug, entry, { action }, 'debug', {
    throwOnError: false,
  });
  const state = debugDetails(details, 'debug').state;
  return { state: typeof state === 'string' ? state : 'running' };
}

async function debugPauseImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: 'pause' }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

async function debugEvaluateImpl(
  sessionId: string,
  expression: string,
  frameId?: number,
): Promise<{ result: string }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(
    tools.debug,
    entry,
    {
      action: 'evaluate',
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.debug, entry, { action: 'threads' }, 'debug');
  return (debugDetails(details, 'debug').threads ?? []).map((thread) => ({
    id: typeof thread.id === 'number' ? thread.id : Number(thread.id ?? 0),
    name: typeof thread.name === 'string' ? thread.name : String(thread.name ?? ''),
  }));
}

async function debugStackImpl(sessionId: string, levels?: number): Promise<DebugStackFrame[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: 'stack_trace',
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    {
      action: 'scopes',
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
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(
    tools.debug,
    entry,
    { action: 'variables', variable_ref: ref },
    'debug',
  );
  return (debugDetails(details, 'debug').variables ?? []).map((variable) => ({
    name: typeof variable.name === 'string' ? variable.name : '',
    value: typeof variable.value === 'string' ? variable.value : String(variable.value ?? ''),
  }));
}

async function debugOutputImpl(sessionId: string): Promise<{ text: string }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(tools.debug, entry, { action: 'output' }, 'debug');
  const output = debugDetails(details, 'debug').output;
  return { text: typeof output === 'string' ? output : text };
}

async function debugTerminateImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: 'terminate' }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

async function debugSessionsImpl(sessionId: string): Promise<{ id: string; state: string }[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.debug, entry, { action: 'sessions' }, 'debug');
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
    globFiles: (input) => globFilesImpl(input.sessionId, input.pattern, input.limit),
    grepFiles: (input) =>
      grepFilesImpl(input.sessionId, input.pattern, input.path, input.caseSensitive, input.skip),
    browserAction: (input) => browserActionImpl(input.sessionId, input.params),
    computerAction: (input) => computerActionImpl(input.sessionId, input.params),
    securityScan: async (input) => {
      const entry = await ensureEntry(input.sessionId);
      const tools = await builtTools(entry, input.sessionId);
      return runTool(tools.security, entry, input.params, 'security_scan', {
        throwOnError: false,
      });
    },
    listJobs: (input) => listJobsImpl(input.sessionId),
    cancelJob: (input) => cancelJobImpl(input.sessionId, input.id),
    writeFile: (input) => writeFileImpl(input.sessionId, input.path, input.content),
    editFile: (input) => editFileImpl(input.sessionId, input.path, input.tag, input.input),
    runBash: (input) =>
      runBashImpl(
        input.sessionId,
        input.command,
        input.cwd,
        input.timeoutMs,
        input.env,
        input.pty,
        input.async,
      ),
    runCell: (input) =>
      runCellImpl(
        input.sessionId,
        input.language,
        input.code,
        input.title,
        input.timeoutMs,
        input.reset,
      ),
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
    lspRequest: (input) => lspRequestImpl(input.sessionId, input.params),
    debugRequest: (input) => debugRequestImpl(input.sessionId, input.params),
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
