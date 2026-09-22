import { describe, expect, test } from 'bun:test';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import { getThinkingRoute, setThinkingRoute } from './model.js';

const withGet = (level: string) =>
  ({ getThinkingLevel: async () => level }) as unknown as AgentRuntime;

describe('thinking route', () => {
  test('GET returns the level the model runs with', async () => {
    expect(await getThinkingRoute(withGet('medium'), 's1')).toEqual({ thinking: 'medium' });
  });

  test('GET propagates the runtime error for an unknown session', async () => {
    const runtime = {
      getThinkingLevel: async () => {
        throw new Error('session not found: nope');
      },
    } as unknown as AgentRuntime;
    const err: unknown = await getThinkingRoute(runtime, 'nope').catch((e) => e);
    expect((err as Error).message).toContain('session not found');
  });

  test('POST rejects a level the schema refuses without calling the runtime', async () => {
    let called = false;
    const runtime = {
      setThinkingLevel: async () => {
        called = true;
        return 'medium';
      },
    } as unknown as AgentRuntime;
    const err: unknown = await setThinkingRoute(runtime, 's1', { level: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect(called).toBe(false);
  });
});
