import type { AgentRuntime } from '@ai-gui/agent-runtime';
import {
  SessionModelStateSchema,
  SetModelSchema,
  SetThinkingSchema,
  SwitchModelSchema,
} from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/stats → cumulative tokens/cost/context for the session. */
export async function getStatsRoute(runtime: AgentRuntime, sessionId: string): Promise<unknown> {
  return runtime.getSessionStats(sessionId);
}

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
  // Two forms: an explicit provider/model pair, or a `/switch` selector that
  // the SDK resolves (fuzzy id, provider/id, @role, :level).
  const switched = SwitchModelSchema.safeParse(body ?? {});
  if (switched.success) {
    try {
      return {
        current: await runtime.switchSessionModel({ sessionId, selector: switched.data.selector }),
      };
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
  }
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
