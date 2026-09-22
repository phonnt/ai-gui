import {
  type ConflictEntry,
  type ConflictSide,
  SessionNotFoundError,
  type TodoPhase,
  ToolExecutionError,
} from '@grove/agent-runtime';
import { SessionManager } from '@oh-my-pi/pi-coding-agent';
import type { EvalPreludeDefinition } from '@oh-my-pi/pi-coding-agent/eval/preludes';
import type { TodoPhase as SdkTodoPhase, Tool, ToolSession } from '@oh-my-pi/pi-coding-agent/tools';
import {
  type ApprovalMode,
  denyError,
  formatApprovalPrompt,
  resolveApproval,
} from '@oh-my-pi/pi-coding-agent/tools/approval';
import { getConflictHistory } from '@oh-my-pi/pi-coding-agent/tools/conflict-detect';
import { toInvalidRequestError, toPathNotFoundError } from '../client-errors.js';
import { settingsGet, settingsSnapshot } from '../settings.js';
import {
  buildToolSession,
  buildToolSessionSettings,
  liveAuthFor,
  liveModelFor,
  liveRegistryFor,
  liveSettingsFor,
  liveSettingsGetterFor,
  type ToolSessionHandle,
} from '../tools-session.js';

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

export type BuiltToolsFactory = (entry: SessionEntry, sessionId: string) => Promise<BuiltTools>;

let toolTableFactory: BuiltTablesFactoryOrUndefined | undefined;

type BuiltTablesFactoryOrUndefined = BuiltToolsFactory;

/** The tool table is wired in the assembler (`tools.ts`); core only asks for it. */
export function setToolTableFactory(factory: BuiltToolsFactory): void {
  toolTableFactory = factory;
}

export async function builtTools(entry: SessionEntry, sessionId: string): Promise<BuiltTools> {
  if (!toolTableFactory) throw new Error('tool table factory not registered');
  return toolTableFactory(entry, sessionId);
}

export interface BuiltTools {
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

export interface SessionEntry {
  id: string;
  handle: ToolSessionHandle;
  built: BuiltTools | null;
  building: Promise<BuiltTools> | null;
  seq: number;
}

export const entries = new Map<string, SessionEntry>();

/** Out-of-turn approval round-trip (installed by the SDK adapter). */

export interface ApprovalBridge {
  requestApproval(sessionId: string, toolName: string, prompt: string): Promise<boolean>;
}

export let approvalBridge: ApprovalBridge | undefined;
/**
 * Journal-path resolver supplied by the runtime. The SDK assigns a session's
 * file lazily (first persisted message), so the path must be re-read instead
 * of captured once — it anchors the artifact directory.
 */

export let sessionFileResolver: ((sessionId: string) => string | null) | undefined;

export function setSessionFileResolver(
  resolver: ((sessionId: string) => string | null) | undefined,
): void {
  sessionFileResolver = resolver;
}

export function setApprovalBridge(bridge: ApprovalBridge | undefined): void {
  approvalBridge = bridge;
}

export const cwdRegs = new Map<string, string>();

export const fileRegs = new Map<string, string | null>();

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

export async function ensureEntry(sessionId: string): Promise<SessionEntry> {
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

export interface ToolTextResult {
  text: string;
  details: Record<string, unknown> | undefined;
}

export function normalizeApprovalMode(value: unknown): ApprovalMode {
  if (value === 'always-ask' || value === 'write' || value === 'yolo') return value;
  // Absent keeps OMP's documented default (yolo); anything else unrecognised is
  // a typo, and silently reading it as yolo would disable every approval prompt.
  return value === undefined ? 'yolo' : 'always-ask';
}

/**
 * Mirror effective approval config (mode, per-tool policies, bash patterns)
 * from global/project settings into the handle's isolated settings, so
 * out-of-turn tools resolve exactly like in-turn ones.
 */

export async function syncApprovalSettings(entry: SessionEntry): Promise<void> {
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

export function resultText(result: {
  content?: Array<{ type?: unknown; text?: unknown }>;
}): string {
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

export async function checkToolApproval(
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

export async function runTool(
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

export interface ToolRawResult {
  content?: Array<{ type?: unknown; text?: unknown }>;
  isError?: unknown;
  details?: unknown;
}

export interface ReadDetails {
  isDirectory?: unknown;
  resolvedPath?: unknown;
  truncation?: { truncated?: unknown };
  displayContent?: { text?: unknown };
}

export function entrySession(entry: SessionEntry): ToolSession {
  return entry.handle.session;
}

export function mapTodoPhases(phases: SdkTodoPhase[] | undefined): TodoPhase[] {
  return (phases ?? []).map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map((task) => ({
      content: task.content,
      status: task.status,
      ...(task.blocker !== undefined ? { blocker: task.blocker } : {}),
    })),
  }));
}

export const jobTails = new Map<string, string>();

export function refreshToolSessionSettings(entry: SessionEntry, sessionId: string): void {
  const live = liveSettingsGetterFor(sessionId)?.();
  if (!live) return;
  try {
    entry.handle.session.settings = buildToolSessionSettings(settingsSnapshot(live));
  } catch {
    /* keep the previous settings when the live session cannot be snapshotted */
  }
}

export const preludeCache = new Map<
  string,
  { browser?: EvalPreludeDefinition; computer?: EvalPreludeDefinition }
>();

export interface DebugDetails {
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

export const breakpointRegs = new Map<string, Map<number, DebugBreakpointTarget>>();
export const breakpointSeqs = new Map<string, number>();

export interface DebugBreakpointTarget {
  file?: string;
  line?: number;
  fn?: string;
  condition?: string;
}
