import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { ModeActionSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/modes → { modes }. */
export async function getModesRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ modes: unknown }> {
  const modes = await runtime.getSessionModes(sessionId);
  return { modes };
}

/** POST /api/sessions/:id/modes { mode, enabled?, value? } → { modes }. */
export async function modeActionRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ modes: unknown }> {
  const parsed = ModeActionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const { mode, enabled, value } = parsed.data;
  switch (mode) {
    case 'plan':
    case 'vibe':
    case 'advisor':
    case 'fast': {
      if (enabled === undefined) throw new HttpError(400, `${mode} needs enabled true/false`);
      const setters = {
        plan: runtime.setPlanMode.bind(runtime),
        vibe: runtime.setVibeMode.bind(runtime),
        advisor: runtime.setAdvisorMode.bind(runtime),
        fast: runtime.setFastMode.bind(runtime),
      } as const;
      const modes = await setters[mode]({ sessionId, enabled });
      return { modes };
    }
    case 'steering':
    case 'followUp':
    case 'interrupt': {
      if (mode === 'interrupt' && value !== 'immediate' && value !== 'wait') {
        throw new HttpError(400, 'interrupt needs value immediate|wait');
      }
      if (mode !== 'interrupt' && value !== 'all' && value !== 'one-at-a-time') {
        throw new HttpError(400, `${mode} needs value all|one-at-a-time`);
      }
      const modes = await runtime.setQueueModes({
        sessionId,
        ...(mode === 'steering' && value !== undefined
          ? { steering: value as 'all' | 'one-at-a-time' }
          : {}),
        ...(mode === 'followUp' && value !== undefined
          ? { followUp: value as 'all' | 'one-at-a-time' }
          : {}),
        ...(mode === 'interrupt' && value !== undefined
          ? { interrupt: value as 'immediate' | 'wait' }
          : {}),
      });
      return { modes };
    }
  }
}
