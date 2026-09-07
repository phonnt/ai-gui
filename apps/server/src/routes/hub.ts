import type { HubOps } from '@ai-gui/agent-runtime';
import { HubJobsCancelSchema, HubSpawnSchema, HubSteerSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/hub/agents → { agents }. */
export async function hubRosterRoute(hub: HubOps): Promise<{ agents: unknown }> {
  return { agents: await hub.hubRoster() };
}

/** POST /api/hub/agents/:id/steer { text } → { ok: true }. */
export async function hubSteerRoute(
  hub: HubOps,
  id: string,
  body: unknown,
): Promise<{ ok: boolean }> {
  const parsed = HubSteerSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await hub.hubSteer({ id, text: parsed.data.text });
  return { ok: true };
}

/** POST /api/hub/agents/:id/revive → { revived, revivable, transcript? }. */
export async function hubReviveRoute(
  hub: HubOps,
  id: string,
): Promise<{ revived: boolean; revivable: boolean; transcript?: string }> {
  return hub.hubRevive({ id });
}

/** POST /api/hub/agents/:id/kill → { killed }. */
export async function hubKillRoute(hub: HubOps, id: string): Promise<{ killed: boolean }> {
  return hub.hubKill({ id });
}

/** GET /api/hub/jobs → { jobs }. */
export async function hubJobsRoute(hub: HubOps): Promise<{ jobs: unknown }> {
  return { jobs: await hub.jobsList() };
}

/** POST /api/hub/jobs/cancel { ids? } → { cancelled }. */
export async function hubJobsCancelRoute(
  hub: HubOps,
  body: unknown,
): Promise<{ cancelled: unknown }> {
  const parsed = HubJobsCancelSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return hub.jobsCancel({ ...(parsed.data.ids !== undefined ? { ids: parsed.data.ids } : {}) });
}

/** POST /api/hub/spawn { sessionId, agent?, task, context?, outputSchema? } → { agentId }. */
export async function hubSpawnRoute(hub: HubOps, body: unknown): Promise<{ agentId: string }> {
  const parsed = HubSpawnSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return hub.taskSpawn({
    sessionId: parsed.data.sessionId,
    ...(parsed.data.agent !== undefined ? { agent: parsed.data.agent } : {}),
    task: parsed.data.task,
    ...(parsed.data.context !== undefined ? { context: parsed.data.context } : {}),
    ...(parsed.data.outputSchema !== undefined ? { outputSchema: parsed.data.outputSchema } : {}),
  });
}
