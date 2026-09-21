import type { HubOps } from '@grove/agent-runtime';
import { ProcessActionSchema } from '@grove/protocol';
import { errorToStatus, HttpError } from './errors.js';

/**
 * POST /api/sessions/:id/process { op, … } → one supervised-process call.
 *
 * The SDK owns launch semantics (readiness probes, PTY, restart policy), so
 * this is a passthrough with the session's own gate: `launch.enabled`.
 */
export async function processActionRoute(
  hub: HubOps,
  sessionId: string,
  body: unknown,
): Promise<{ text: string; details?: Record<string, unknown> }> {
  const parsed = ProcessActionSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(
      400,
      `invalid process action: ${parsed.error.issues[0]?.message ?? 'bad body'}`,
    );
  }
  try {
    return await hub.processAction({ sessionId, params: parsed.data });
  } catch (err) {
    // Typed runtime errors carry their own status (disabled -> 400, unknown
    // session -> 404); everything else is a genuine server fault.
    const message = err instanceof Error ? err.message : String(err);
    throw new HttpError(errorToStatus(err), message);
  }
}
