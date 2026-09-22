import { type DebugStackFrame, type DebugThread, ToolExecutionError } from '@grove/agent-runtime';

import {
  breakpointRegs,
  breakpointSeqs,
  builtTools,
  type DebugBreakpointTarget,
  type DebugDetails,
  ensureEntry,
  runTool,
} from './core';
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

export function trackBreakpoint(sessionId: string, target: DebugBreakpointTarget): number {
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

export function takeBreakpoint(sessionId: string, id: number): DebugBreakpointTarget {
  const target = breakpointRegs.get(sessionId)?.get(id);
  if (!target) throw new ToolExecutionError('debug', `unknown breakpoint id: ${id}`);
  return target;
}

export function debugDetails(
  result: Record<string, unknown> | undefined,
  tool: string,
): DebugDetails {
  if (!result || typeof result !== 'object')
    throw new ToolExecutionError(tool, 'missing result details');
  return result as DebugDetails;
}

export function snapshotSession(details: DebugDetails): string {
  const id = details.snapshot?.id;
  if (typeof id !== 'string' || !id)
    throw new ToolExecutionError('debug', 'missing session snapshot');
  return id;
}

export async function debugLaunchImpl(
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

export async function debugAttachImpl(
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

export async function debugBreakpointImpl(
  sessionId: string,
  target: DebugBreakpointTarget,
): Promise<{ id: number }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugBreakpointParams(target), 'debug');
  return { id: trackBreakpoint(sessionId, target) };
}

export async function debugRemoveBreakpointImpl(
  sessionId: string,
  id: number,
): Promise<{ ok: boolean }> {
  const target = takeBreakpoint(sessionId, id);
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, buildDebugRemoveBreakpointParams(target), 'debug');
  breakpointRegs.get(sessionId)?.delete(id);
  return { ok: true };
}

export async function debugContinueImpl(sessionId: string): Promise<{ state: string }> {
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

export async function debugStepImpl(
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

export async function debugPauseImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: 'pause' }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

export async function debugEvaluateImpl(
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

export async function debugThreadsImpl(sessionId: string): Promise<DebugThread[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.debug, entry, { action: 'threads' }, 'debug');
  return (debugDetails(details, 'debug').threads ?? []).map((thread) => ({
    id: typeof thread.id === 'number' ? thread.id : Number(thread.id ?? 0),
    name: typeof thread.name === 'string' ? thread.name : String(thread.name ?? ''),
  }));
}

export async function debugStackImpl(
  sessionId: string,
  levels?: number,
): Promise<DebugStackFrame[]> {
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

export async function debugScopesImpl(
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

export async function debugVariablesImpl(
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

export async function debugOutputImpl(sessionId: string): Promise<{ text: string }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(tools.debug, entry, { action: 'output' }, 'debug');
  const output = debugDetails(details, 'debug').output;
  return { text: typeof output === 'string' ? output : text };
}

export async function debugTerminateImpl(sessionId: string): Promise<{ ok: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  await runTool(tools.debug, entry, { action: 'terminate' }, 'debug', {
    throwOnError: false,
  });
  return { ok: true };
}

export async function debugSessionsImpl(
  sessionId: string,
): Promise<{ id: string; state: string }[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.debug, entry, { action: 'sessions' }, 'debug');
  return (debugDetails(details, 'debug').sessions ?? []).map((session) => ({
    id: typeof session.id === 'string' ? session.id : String(session.id ?? ''),
    state: typeof session.status === 'string' ? session.status : '',
  }));
}

/** Assemble the SessionTools surface over the per-web-session tool cache. */
