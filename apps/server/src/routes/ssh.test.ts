import { describe, expect, test } from 'bun:test';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import { addSshHostRoute, listSshHostsRoute, removeSshHostRoute } from './ssh.js';

function fakeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    listSshHosts: async () => ['probe'],
    addSshHost: async () => undefined,
    removeSshHost: async () => undefined,
    ...overrides,
  } as unknown as AgentRuntime;
}

describe('ssh routes', () => {
  test('lists hosts for a scope', async () => {
    const body = await listSshHostsRoute(fakeRuntime(), '/cwd', 'user');
    expect(body).toEqual({ hosts: ['probe'] });
  });

  test('add answers with the new list', async () => {
    const added: unknown[] = [];
    const runtime = fakeRuntime({
      listSshHosts: async () => (added.length > 0 ? ['probe'] : []),
      addSshHost: async (input) => {
        added.push(input);
      },
    });

    const body = await addSshHostRoute(runtime, '/cwd', {
      scope: 'user',
      name: 'probe',
      host: '10.0.0.5',
    });

    expect(body).toEqual({ hosts: ['probe'] });
    expect(added).toEqual([{ cwd: '/cwd', scope: 'user', name: 'probe', host: '10.0.0.5' }]);
  });

  test('a bad body is a request error, not a crash', async () => {
    const err: unknown = await addSshHostRoute(fakeRuntime(), '/cwd', { scope: 'nope' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });

  test('removing answers with the remaining hosts', async () => {
    const body = await removeSshHostRoute(fakeRuntime(), '/cwd', {
      scope: 'project',
      name: 'gone',
    });
    expect(body).toEqual({ hosts: ['probe'] });
  });
});
