import { describe, expect, test } from 'bun:test';
import { createLogCache, servesFromCache } from './log-cache.js';

/**
 * `logs` in the process plane spawns a render worker per call (~10-20s in the
 * audit). The UI polls it while following a tail, so the tail is cached for a
 * moment and served by cursor: the same bytes are never rendered twice.
 */
describe('log cache', () => {
  test('serves the whole tail on a cold read and slices it by cursor afterwards', () => {
    const now = { at: 1_000 };
    const cache = createLogCache({ ttlMs: 2_000, now: () => now.at });

    expect(cache.read('s:web', undefined)).toBeNull();

    cache.put('s:web', 'alpha\nbeta\n');

    expect(cache.read('s:web', undefined)).toEqual({ text: 'alpha\nbeta\n', cursor: 11 });
    expect(cache.read('s:web', 6)).toEqual({ text: 'beta\n', cursor: 11 });
    expect(cache.read('s:web', 11)).toEqual({ text: '', cursor: 11 });
  });

  test('expires so a stopped process stops answering from cache', () => {
    const now = { at: 1_000 };
    const cache = createLogCache({ ttlMs: 2_000, now: () => now.at });
    cache.put('s:web', 'alpha\n');

    now.at = 3_001;

    expect(cache.read('s:web', undefined)).toBeNull();
  });

  test('a cursor past the end answers empty rather than replaying the tail', () => {
    const cache = createLogCache({ ttlMs: 2_000, now: () => 0 });
    cache.put('s:web', 'alpha\n');

    expect(cache.read('s:web', 99)).toEqual({ text: '', cursor: 6 });
  });
});

describe('servesFromCache', () => {
  test('caches a plain tail read but never a follow', () => {
    expect(servesFromCache('logs', { name: 'web' })).toBe(true);
    expect(servesFromCache('logs', { name: 'web', follow: true })).toBe(false);
  });

  test('leaves every other process op to the SDK', () => {
    expect(servesFromCache('ps', {})).toBe(false);
    expect(servesFromCache('stop', { name: 'web' })).toBe(false);
  });
});
