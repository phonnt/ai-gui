import type { AgentRuntime } from '@grove/agent-runtime';
import { ResolveConflictsSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/conflicts → { conflicts }. */
export async function conflictsRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ conflicts: unknown }> {
  return { conflicts: await runtime.listConflicts(sessionId) };
}

/** POST /api/sessions/:id/conflicts/resolve { ids, side } → { remaining }. */
export async function resolveConflictsRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ remaining: number }> {
  const parsed = ResolveConflictsSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const remaining = await runtime.resolveConflicts({
    sessionId,
    ids: parsed.data.ids,
    side: parsed.data.side,
  });
  return { remaining };
}
