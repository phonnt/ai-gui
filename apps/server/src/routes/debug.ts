import type { SessionTools } from '@ai-gui/agent-runtime';
import { DebugRequestSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/** POST /api/sessions/:id/debug { action, ...params } → { result }. */
export async function debugRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
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
          program: resolveSessionPath(cwd, data.program),
          ...(data.args !== undefined ? { args: data.args } : {}),
          ...(data.cwd !== undefined ? { cwd: resolveSessionPath(cwd, data.cwd) } : {}),
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
          ...(data.cwd !== undefined ? { cwd: resolveSessionPath(cwd, data.cwd) } : {}),
        }),
      };
    }
    case 'breakpoint': {
      if (!data.fn && (data.file === undefined || data.line === undefined)) {
        throw new HttpError(400, 'breakpoint requires file+line or fn');
      }
      return {
        result: await tools.debugBreakpoint({
          sessionId,
          ...(data.file !== undefined ? { file: resolveSessionPath(cwd, data.file) } : {}),
          ...(data.line !== undefined ? { line: data.line } : {}),
          ...(data.fn !== undefined ? { fn: data.fn } : {}),
          ...(data.condition !== undefined ? { condition: data.condition } : {}),
        }),
      };
    }
    case 'unbreak': {
      if (data.id === undefined) throw new HttpError(400, 'id is required for unbreak');
      return { result: await tools.debugRemoveBreakpoint({ sessionId, id: data.id }) };
    }
    case 'continue': {
      return { result: await tools.debugContinue({ sessionId }) };
    }
    case 'step': {
      return {
        result: await tools.debugStep({ sessionId, kind: data.kind ?? 'over' }),
      };
    }
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
    case 'stack': {
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
    case 'sessions': {
      return { result: await tools.debugSessions({ sessionId }) };
    }
  }
}
