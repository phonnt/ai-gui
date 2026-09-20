import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { CreateSessionSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions → { sessions }. */
export async function listSessionsRoute(runtime: AgentRuntime): Promise<{ sessions: unknown }> {
  const sessions = await runtime.listSessions();
  return { sessions };
}

/** POST /api/sessions { cwd? } → { session }. */
export async function createSessionRoute(
  runtime: AgentRuntime,
  body: unknown,
): Promise<{ session: unknown }> {
  const parsed = CreateSessionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const session = await runtime.createSession({
    ...(parsed.data.cwd ? { cwd: parsed.data.cwd } : {}),
  });
  return { session };
}
