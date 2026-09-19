import type { HubOps } from '@ai-gui/agent-runtime';
import {
  HubJobsCancelSchema,
  HubSendSchema,
  HubSpawnSchema,
  HubSteerSchema,
  HubWaitSchema,
} from '@ai-gui/protocol';
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

/** GET /api/hub/agents/:id/transcript?limit → { entries }. */
export async function hubTranscriptRoute(
  hub: HubOps,
  id: string,
  limit?: number,
): Promise<{ entries: unknown }> {
  return { entries: await hub.hubTranscript({ id, ...(limit !== undefined ? { limit } : {}) }) };
}

/** POST /api/hub/messages { from, to, text } → { outcome, error? }. */
export async function hubSendRoute(
  hub: HubOps,
  body: unknown,
): Promise<{ outcome: string; error?: string }> {
  const parsed = HubSendSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return hub.hubSend(parsed.data);
}

/** GET /api/hub/agents/:id/inbox?peek → { messages }. */
export async function hubInboxRoute(
  hub: HubOps,
  id: string,
  peek?: boolean,
): Promise<{ messages: unknown }> {
  return { messages: await hub.hubInbox({ id, ...(peek !== undefined ? { peek } : {}) }) };
}

/** POST /api/hub/agents/:id/wait { from?, timeoutMs } → { message }. */
export async function hubWaitRoute(
  hub: HubOps,
  id: string,
  body: unknown,
): Promise<{ message: unknown }> {
  const parsed = HubWaitSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return {
    message: await hub.hubWait({
      id,
      ...(parsed.data.from !== undefined ? { from: parsed.data.from } : {}),
      timeoutMs: parsed.data.timeoutMs,
    }),
  };
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
