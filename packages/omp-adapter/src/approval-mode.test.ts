import { describe, expect, test } from 'bun:test';
import { normalizeApprovalMode } from './tools';

describe('normalizeApprovalMode', () => {
  test('keeps the three documented values', () => {
    expect(normalizeApprovalMode('always-ask')).toBe('always-ask');
    expect(normalizeApprovalMode('write')).toBe('write');
    expect(normalizeApprovalMode('yolo')).toBe('yolo');
  });

  test("an absent value keeps OMP's documented yolo default", () => {
    expect(normalizeApprovalMode(undefined)).toBe('yolo');
  });

  test('a typo fails closed instead of disabling every prompt', () => {
    expect(normalizeApprovalMode('alwais-ask')).toBe('always-ask');
    expect(normalizeApprovalMode(42)).toBe('always-ask');
    expect(normalizeApprovalMode(null)).toBe('always-ask');
  });
});
