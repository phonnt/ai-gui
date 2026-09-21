import { describe, expect, test } from 'bun:test';
import { RuntimeUnavailableError } from '@grove/agent-runtime';
import { withDeadline } from './deadline';

describe('withDeadline', () => {
  test('passes a settling result through untouched', async () => {
    expect(await withDeadline(Promise.resolve('ok'), 50, () => new Error('late'))).toBe('ok');
  });

  test('rejects with the caller error when the work never settles', async () => {
    const never = new Promise<string>(() => {});
    const error = await withDeadline(
      never,
      20,
      () => new RuntimeUnavailableError('daemon broker did not answer'),
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(RuntimeUnavailableError);
  });

  test('propagates a rejection without waiting for the deadline', async () => {
    const started = Date.now();
    const error = await withDeadline(
      Promise.reject(new Error('boom')),
      5_000,
      () => new Error('late'),
    ).catch((err: unknown) => err);
    expect((error as Error).message).toBe('boom');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
