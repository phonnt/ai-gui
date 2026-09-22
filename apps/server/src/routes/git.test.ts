import { describe, expect, test } from 'bun:test';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import { gitDiffRoute, gitStatusRoute } from './git.js';

const status = {
  branch: 'main',
  detached: false,
  entries: [{ status: 'M', path: 'a.txt' }],
  insertions: 1,
  deletions: 0,
};

function fakeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    gitStatus: async () => status,
    gitDiff: async (_sessionId: string, path: string) => ({ text: `diff of ${path}` }),
    ...overrides,
  } as unknown as AgentRuntime;
}

describe('git routes', () => {
  test('status answers the working-tree state', async () => {
    expect(await gitStatusRoute(fakeRuntime(), 's1')).toEqual({ status });
  });

  test('diff answers the text for a path', async () => {
    expect(await gitDiffRoute(fakeRuntime(), 's1', 'a.txt')).toEqual({ text: 'diff of a.txt' });
  });

  test('diff without a path is a request error', async () => {
    const err: unknown = await gitDiffRoute(fakeRuntime(), 's1', undefined).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });
});
