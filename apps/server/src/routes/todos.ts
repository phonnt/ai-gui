import type { SessionTools } from '@grove/agent-runtime';
import { TodoOpSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/todos → { phases }. */
export async function getTodosRoute(
  tools: SessionTools,
  sessionId: string,
): Promise<{ phases: unknown }> {
  return { phases: await tools.getTodos({ sessionId }) };
}

/** POST /api/sessions/:id/todos { op, payload? } → { phases }. */
export async function applyTodoOpRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<{ phases: unknown }> {
  const parsed = TodoOpSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return {
    phases: await tools.applyTodoOp({
      sessionId,
      op: parsed.data.op,
      ...(parsed.data.payload !== undefined ? { payload: parsed.data.payload } : {}),
    }),
  };
}
