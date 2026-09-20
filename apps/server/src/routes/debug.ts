import type { SessionTools } from '@grove/agent-runtime';
import { DebugRequestSchema } from '@grove/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/** Wire field → SDK tool field for the fields whose names differ. */
function toSdkParams(data: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (key === 'frameId') params.frame_id = value;
    else if (key === 'fn') params.function = value;
    else params[key] = value;
  }
  return params;
}

/** POST /api/sessions/:id/debug { action, ...params } → { result }. */
export async function debugRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  body: unknown,
): Promise<{ result: unknown }> {
  const parsed = DebugRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const data = parsed.data;
  switch (data.action) {
    case 'launch': {
      if (!data.program) throw new HttpError(400, 'program is required for launch');
      return {
        result: await tools.debugLaunch({
          sessionId,
          program: resolveSessionPath(cwd, data.program, roots),
          ...(data.args !== undefined ? { args: data.args } : {}),
          ...(data.cwd !== undefined ? { cwd: resolveSessionPath(cwd, data.cwd, roots) } : {}),
          ...(data.adapter !== undefined ? { adapter: data.adapter } : {}),
        }),
      };
    }
    case 'attach': {
      return {
        result: await tools.debugAttach({
          sessionId,
          ...(data.pid !== undefined ? { pid: data.pid } : {}),
          ...(data.port !== undefined ? { port: data.port } : {}),
          ...(data.host !== undefined ? { host: data.host } : {}),
          ...(data.adapter !== undefined ? { adapter: data.adapter } : {}),
          ...(data.cwd !== undefined ? { cwd: resolveSessionPath(cwd, data.cwd, roots) } : {}),
        }),
      };
    }
    case 'set_breakpoint': {
      if (!data.fn && (data.file === undefined || data.line === undefined)) {
        throw new HttpError(400, 'breakpoint requires file+line or fn');
      }
      return {
        result: await tools.debugBreakpoint({
          sessionId,
          ...(data.file !== undefined ? { file: resolveSessionPath(cwd, data.file, roots) } : {}),
          ...(data.line !== undefined ? { line: data.line } : {}),
          ...(data.fn !== undefined ? { fn: data.fn } : {}),
          ...(data.condition !== undefined ? { condition: data.condition } : {}),
        }),
      };
    }
    case 'remove_breakpoint': {
      if (data.id === undefined) throw new HttpError(400, 'id is required for unbreak');
      return { result: await tools.debugRemoveBreakpoint({ sessionId, id: data.id }) };
    }
    case 'continue': {
      return { result: await tools.debugContinue({ sessionId }) };
    }
    case 'step_over':
      return { result: await tools.debugStep({ sessionId, kind: 'over' }) };
    case 'step_in':
      return { result: await tools.debugStep({ sessionId, kind: 'in' }) };
    case 'step_out':
      return { result: await tools.debugStep({ sessionId, kind: 'out' }) };
    case 'pause': {
      return { result: await tools.debugPause({ sessionId }) };
    }
    case 'evaluate': {
      if (!data.expression) throw new HttpError(400, 'expression is required for evaluate');
      return {
        result: await tools.debugEvaluate({
          sessionId,
          expression: data.expression,
          ...(data.frameId !== undefined ? { frameId: data.frameId } : {}),
        }),
      };
    }
    case 'threads': {
      return { result: await tools.debugThreads({ sessionId }) };
    }
    case 'stack_trace': {
      return {
        result: await tools.debugStack({
          sessionId,
          ...(data.levels !== undefined ? { levels: data.levels } : {}),
        }),
      };
    }
    case 'scopes': {
      return {
        result: await tools.debugScopes({
          sessionId,
          ...(data.frameId !== undefined ? { frameId: data.frameId } : {}),
        }),
      };
    }
    case 'variables': {
      if (data.ref === undefined) throw new HttpError(400, 'ref is required for variables');
      return { result: await tools.debugVariables({ sessionId, ref: data.ref }) };
    }
    case 'output': {
      return { result: await tools.debugOutput({ sessionId }) };
    }
    case 'terminate': {
      return { result: await tools.debugTerminate({ sessionId }) };
    }
    case 'sessions':
      return { result: await tools.debugSessions({ sessionId }) };
    default: {
      // SDK-only actions (instruction/data breakpoints, disassemble, memory,
      // modules, loaded_sources, custom_request) pass through verbatim.
      const params = toSdkParams(data);
      return { result: await tools.debugRequest({ sessionId, params }) };
    }
  }
}
