import { describe, expect, test } from 'bun:test';
import { contextLevel } from './context-usage';

describe('contextLevel', () => {
  test('escalates early when the token threshold bites before the percentage one', () => {
    // 1M window: 150k is 15% of the window, so warning arrives at 15%, not 50%.
    expect(contextLevel(14.9, 1_000_000)).toBe('normal');
    expect(contextLevel(15, 1_000_000)).toBe('warning');
    expect(contextLevel(27, 1_000_000)).toBe('purple');
    expect(contextLevel(50, 1_000_000)).toBe('error');
  });

  test('keeps the percentage ladder when the window makes it bite first', () => {
    // 200k window: 50% (100k) is below the 150k warning threshold.
    expect(contextLevel(49, 200_000)).toBe('normal');
    expect(contextLevel(50, 200_000)).toBe('warning');
    expect(contextLevel(70, 200_000)).toBe('purple');
    expect(contextLevel(90, 200_000)).toBe('error');
  });

  test('falls back to percentages when the window is unknown', () => {
    expect(contextLevel(49, 0)).toBe('normal');
    expect(contextLevel(50, 0)).toBe('warning');
    expect(contextLevel(95, Number.NaN)).toBe('error');
  });

  test('treats non-positive usage as normal', () => {
    expect(contextLevel(0, 1_000_000)).toBe('normal');
    expect(contextLevel(-5, 1_000_000)).toBe('normal');
  });
});
