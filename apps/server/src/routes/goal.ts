import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { GoalActionSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/goal → { goal }. */
export async function getGoalRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ goal: unknown }> {
  const goal = await runtime.getGoal(sessionId);
  return { goal };
}

/**
 * POST /api/sessions/:id/goal { action, objective?, tokenBudget? } → { goal }.
 * `budget` adjusts the running goal in place; `set` creates or replaces it.
 */
export async function goalActionRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ goal: unknown }> {
  const parsed = GoalActionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const { action, objective, tokenBudget } = parsed.data;
  switch (action) {
    case 'set': {
      if (!objective) throw new HttpError(400, 'objective is required to set a goal');
      const goal = await runtime.setGoal({
        sessionId,
        objective,
        ...(tokenBudget !== undefined && tokenBudget !== null ? { tokenBudget } : {}),
      });
      return { goal };
    }
    case 'budget': {
      const goal = await runtime.setGoalBudget({
        sessionId,
        ...(tokenBudget !== null && tokenBudget !== undefined ? { tokenBudget } : {}),
      });
      return { goal };
    }
    case 'pause': {
      const goal = await runtime.pauseGoal(sessionId);
      return { goal };
    }
    case 'resume': {
      const goal = await runtime.resumeGoal(sessionId);
      return { goal };
    }
    case 'drop': {
      const goal = await runtime.dropGoal(sessionId);
      return { goal };
    }
  }
}
