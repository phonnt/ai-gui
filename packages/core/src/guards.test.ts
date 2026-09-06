import { describe, expect, test } from 'bun:test';
import { canMutateWhileStreaming, requireSessionId } from './guards';

describe('canMutateWhileStreaming', () => {
  test('blocks fork/clear-style ops while streaming', () => {
    expect(canMutateWhileStreaming(true)).toBe(false);
    expect(canMutateWhileStreaming(false)).toBe(true);
  });
});

describe('requireSessionId', () => {
  test('passes valid ids through, throws on missing/blank', () => {
    expect(() => requireSessionId('abc')).not.toThrow();
    expect(() => requireSessionId(undefined)).toThrow();
    expect(() => requireSessionId('')).toThrow();
  });
});
