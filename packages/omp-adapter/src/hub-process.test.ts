import { describe, expect, test } from 'bun:test';
import { InvalidRequestError, RuntimeUnavailableError } from '@grove/agent-runtime';
import { withDeadline } from './deadline.js';
import { mapProcessError, unknownProcessTarget } from './hub.js';

describe('process plane failure contract', () => {
  test('a wedged broker turns into a bounded, actionable 503', async () => {
    const wedged = new Promise<never>(() => {});
    const err: unknown = await withDeadline(wedged, 20, () =>
      unknownProcessTarget('/tmp/ws'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(RuntimeUnavailableError);
    expect((err as Error).message).toContain('did not answer within 20s');
    expect((err as Error).message).toContain('/tmp/ws');
    expect((err as Error).message).toContain('~/.omp/run/daemons');
  });

  test('SDK broker faults map to 503 instead of a 500', () => {
    const err = mapProcessError(new Error('connect ENOENT /tmp/x/broker.sock'), '/tmp/ws');
    expect(err).toBeInstanceOf(RuntimeUnavailableError);
    expect(err.message).toContain('daemon broker unavailable');
  });

  test('caller mistakes stay 400s', () => {
    const err = mapProcessError(new InvalidRequestError('Unknown daemon nope'), '/tmp/ws');
    expect(err).toBeInstanceOf(InvalidRequestError);
    expect(err).not.toBeInstanceOf(RuntimeUnavailableError);
  });

  test('an unexpected error keeps its type (falls through to 500)', () => {
    const original = new TypeError('boom');
    expect(mapProcessError(original, '/tmp/ws')).toBe(original);
  });
});
