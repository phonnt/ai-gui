import {
  type HubAgentDto,
  HubInboxResponseSchema,
  type HubJobDto,
  HubJobsCancelResponseSchema,
  HubJobsResponseSchema,
  HubKillResponseSchema,
  type HubMessageDto,
  HubReviveResponseSchema,
  HubRosterResponseSchema,
  type HubSendDto,
  type HubSendResponseDto,
  HubSendResponseSchema,
  HubSpawnResponseSchema,
  type HubTranscriptEntryDto,
  HubTranscriptResponseSchema,
  type HubWaitDto,
  HubWaitResponseSchema,
  OkSchema,
} from '@grove/protocol';

import { call, type Result, unwrapEnvelope, withJson } from './core';

export type HubAgent = HubAgentDto;

export type HubJob = HubJobDto;

export interface SpawnInput {
  sessionId: string;
  agent?: string;
  task: string;
  context?: string;
  outputSchema?: unknown;
}

export interface HubReviveResult {
  revived: boolean;
  revivable: boolean;
}

export function hubAgentPath(id: string, suffix = ''): string {
  return `/api/hub/agents/${encodeURIComponent(id)}${suffix}`;
}

/** GET /api/hub/agents → {agents}. */

export function listHubAgents(): Promise<Result<HubAgent[]>> {
  return unwrapEnvelope(call('/api/hub/agents', HubRosterResponseSchema), 'agents');
}

/** POST /api/hub/agents/:id/steer {text} → {ok}. Steer uses the same prompt path. */

export function steerHubAgent(id: string, text: string): Promise<Result<{ ok: true }>> {
  return call(hubAgentPath(id, '/steer'), OkSchema, withJson('POST', { text }));
}

/** POST /api/hub/agents/:id/revive → {revived, revivable}. */

export function reviveHubAgent(id: string): Promise<Result<HubReviveResult>> {
  return call(hubAgentPath(id, '/revive'), HubReviveResponseSchema, withJson('POST', {}));
}

/** POST /api/hub/agents/:id/kill → {killed}. */

export function killHubAgent(id: string): Promise<Result<{ killed: boolean }>> {
  return call(hubAgentPath(id, '/kill'), HubKillResponseSchema, withJson('POST', {}));
}

/** GET /api/hub/agents/:id/transcript → read-only agent transcript rows. */

export function getHubTranscript(
  id: string,
  limit?: number,
): Promise<Result<HubTranscriptEntryDto[]>> {
  const qs = limit !== undefined ? `?limit=${limit}` : '';
  return unwrapEnvelope(
    call<{ entries: HubTranscriptEntryDto[] }>(
      hubAgentPath(id, `/transcript${qs}`),
      HubTranscriptResponseSchema,
    ),
    'entries',
  );
}

/** POST /api/hub/messages {from,to,text} → delivery receipt. */

export function sendHubMessage(input: HubSendDto): Promise<Result<HubSendResponseDto>> {
  return call('/api/hub/messages', HubSendResponseSchema, withJson('POST', input));
}

/** GET /api/hub/agents/:id/inbox[?peek=true] → mailbox contents. */

export function getHubInbox(id: string, peek?: boolean): Promise<Result<HubMessageDto[]>> {
  const qs = peek ? '?peek=true' : '';
  return unwrapEnvelope(
    call<{ messages: HubMessageDto[] }>(hubAgentPath(id, `/inbox${qs}`), HubInboxResponseSchema),
    'messages',
  );
}

/** POST /api/hub/agents/:id/wait {from?,timeoutMs} → next message or null. */

export function waitHubMessage(
  id: string,
  input: HubWaitDto,
): Promise<Result<HubMessageDto | null>> {
  return unwrapEnvelope(
    call<{ message: HubMessageDto | null }>(
      hubAgentPath(id, '/wait'),
      HubWaitResponseSchema,
      withJson('POST', input),
    ),
    'message',
  );
}

/** GET /api/hub/jobs → {jobs}. */

export function listHubJobs(): Promise<Result<HubJob[]>> {
  return unwrapEnvelope(call('/api/hub/jobs', HubJobsResponseSchema), 'jobs');
}

/** POST /api/hub/jobs/cancel {ids?} → {cancelled}. Omitted ids cancels all. */

export function cancelHubJobs(ids?: string[]): Promise<Result<{ cancelled: string[] }>> {
  return call(
    '/api/hub/jobs/cancel',
    HubJobsCancelResponseSchema,
    withJson('POST', ids === undefined ? {} : { ids }),
  );
}

/** POST /api/hub/spawn {agent?, task, context?, outputSchema?} → {agentId}. */

export function spawnHubAgent(input: SpawnInput): Promise<Result<{ agentId: string }>> {
  const body: Record<string, unknown> = { sessionId: input.sessionId, task: input.task };
  if (input.agent !== undefined && input.agent.trim().length > 0) body.agent = input.agent;
  if (input.context !== undefined && input.context.trim().length > 0) body.context = input.context;
  if (input.outputSchema !== undefined) body.outputSchema = input.outputSchema;
  return call('/api/hub/spawn', HubSpawnResponseSchema, withJson('POST', body));
}
// ---------------------------------------------------------------------------
// P4 Settings plane (SDK-direct, server-cwd scope; secrets never leave the
// server). Shapes validated against @grove/protocol schemas.
// ---------------------------------------------------------------------------
