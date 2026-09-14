import { describe, expect, test } from 'bun:test';
import type { AgentRuntime, GoalState, SetGoalInput } from '@ai-gui/agent-runtime';
import { OperationNotSupportedError } from '@ai-gui/agent-runtime';
import { errorToStatus, HttpError } from './errors';
import { getGoalRoute, goalActionRoute } from './goal';

const state: GoalState = {
  enabled: true,
  goal: { id: 'g1', objective: 'Ship it', status: 'active', tokenBudget: 50000, tokensUsed: 1200 },
};

/** Minimal mock runtime: only goal ops behave; everything else is unreachable. */
function mockRuntime(overrides?: Partial<AgentRuntime>): AgentRuntime {
  return {
    kind: 'sdk',
    getGoal: async () => state,
    setGoal: async (input: SetGoalInput) => ({
      enabled: true,
      goal: {
        id: 'g1',
        objective: input.objective,
        status: 'active',
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
        tokensUsed: 0,
      },
    }),
    pauseGoal: async () => ({ ...state, enabled: false }),
    resumeGoal: async () => state,
    dropGoal: async () => ({ enabled: false, goal: null }),
    ...overrides,
  } as unknown as AgentRuntime;
}

describe('goal routes (runtime-agnostic contract)', () => {
  test('get returns the runtime state untouched', async () => {
    expect(await getGoalRoute(mockRuntime(), 's1')).toEqual({ goal: state });
  });

  test('set forwards objective and budget', async () => {
    const res = (await goalActionRoute(mockRuntime(), 's1', {
      action: 'set',
      objective: 'Refactor auth',
      tokenBudget: 10000,
    })) as { goal: GoalState };
    expect(res.goal.goal?.objective).toBe('Refactor auth');
    expect(res.goal.goal?.tokenBudget).toBe(10000);
  });

  test('pause/resume/drop dispatch', async () => {
    const rt = mockRuntime();
    expect(
      ((await goalActionRoute(rt, 's1', { action: 'pause' })) as { goal: GoalState }).goal.enabled,
    ).toBe(false);
    expect(
      ((await goalActionRoute(rt, 's1', { action: 'resume' })) as { goal: GoalState }).goal.enabled,
    ).toBe(true);
    expect(
      ((await goalActionRoute(rt, 's1', { action: 'drop' })) as { goal: GoalState }).goal.goal,
    ).toBeNull();
  });

  test('set without objective and unknown actions are 400', async () => {
    const rt = mockRuntime();
    await expect(goalActionRoute(rt, 's1', { action: 'set' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(goalActionRoute(rt, 's1', { action: 'dance' })).rejects.toBeInstanceOf(HttpError);
  });

  test('unsupported runtime ops surface as 501', async () => {
    const rt = mockRuntime({
      getGoal: async () => {
        throw new OperationNotSupportedError('goal');
      },
    });
    try {
      await getGoalRoute(rt, 's1');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OperationNotSupportedError);
      expect(errorToStatus(err)).toBe(501);
    }
  });
});
