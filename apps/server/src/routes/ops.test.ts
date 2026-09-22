import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import { moveSessionRoute } from './ops.js';

const runtime = { moveSession: async () => ({ ok: true }) } as unknown as AgentRuntime;

describe('move route', () => {
  test('rejects a directory that does not exist and does not create it', async () => {
    const target = join(tmpdir(), `grove-move-${Date.now()}`);
    const err: unknown = await moveSessionRoute(runtime, 's1', { cwd: target }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).message).toContain('directory does not exist');
    expect(existsSync(target)).toBe(false);
  });

  test('accepts an existing directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grove-move-ok-'));
    expect(await moveSessionRoute(runtime, 's1', { cwd: dir })).toEqual({ ok: true });
  });

  test('still rejects an empty cwd through the schema', async () => {
    const err: unknown = await moveSessionRoute(runtime, 's1', { cwd: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
  });
});
