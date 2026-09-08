import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { SessionModelStateSchema, SetModelSchema, SetThinkingSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/model → { models, current, thinking }. */
export async function getModelRoute(runtime: AgentRuntime, sessionId: string): Promise<unknown> {
  const state = await runtime.getSessionModels(sessionId);
  const parsed = SessionModelStateSchema.safeParse(state);
  if (!parsed.success) throw new HttpError(500, 'model state failed validation');
  return parsed.data;
}

/** POST /api/sessions/:id/model { provider, modelId } → { current }. */
export async function setModelRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ current: unknown }> {
  const parsed = SetModelSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const current = await runtime.setSessionModel({
    sessionId,
    provider: parsed.data.provider,
    modelId: parsed.data.modelId,
  });
  return { current };
}

/** POST /api/sessions/:id/thinking { level } → { thinking }. */
export async function setThinkingRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ thinking: string }> {
  const parsed = SetThinkingSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const thinking = await runtime.setThinkingLevel({ sessionId, level: parsed.data.level });
  return { thinking };
}
