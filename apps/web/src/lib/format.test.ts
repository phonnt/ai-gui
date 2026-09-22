import { describe, expect, test } from 'bun:test';
import { formatBytes, formatCount, formatDuration } from './format';

describe('formatCount', () => {
  test('keeps small counts exact and abbreviates thousands and millions', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1.0k');
    expect(formatCount(12_400)).toBe('12.4k');
    expect(formatCount(999_999)).toBe('1000.0k');
    expect(formatCount(1_000_000)).toBe('1.00M');
    expect(formatCount(2_500_000)).toBe('2.50M');
  });
});

describe('formatBytes', () => {
  test('crosses each unit at 1024 and labels the unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(12_400)).toBe('12.1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(3_000_000)).toBe('2.9 MB');
  });
});

describe('formatDuration', () => {
  test('formats durations the way the transcript shows them', () => {
    expect(formatDuration(45)).toBe('45ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(90_000)).toBe('1m30s');
  });
});
