import { describe, expect, test } from 'bun:test';
import { summarizeAudit } from './audit';

describe('summarizeAudit', () => {
  // Shape produced by `bun audit --json`: package name -> advisories.
  test('counts severities and blocks on high and critical', () => {
    const report = {
      'adm-zip': [{ severity: 'high' }, { severity: 'moderate' }],
      sharp: [{ severity: 'critical' }, { severity: 'low' }],
    };
    expect(summarizeAudit(report)).toEqual({
      total: 4,
      blocking: 2,
      bySeverity: { high: 1, moderate: 1, critical: 1, low: 1 },
    });
  });

  test('a clean report blocks nothing', () => {
    expect(summarizeAudit({})).toEqual({ total: 0, blocking: 0, bySeverity: {} });
  });

  test('an unrecognised shape is reported, not silently ignored', () => {
    // Older/newer bun shapes must surface as `unknown` severities instead of
    // counting as zero advisories.
    expect(summarizeAudit({ weird: 'not-an-array' })).toEqual({
      total: 0,
      blocking: 0,
      bySeverity: {},
    });
    expect(summarizeAudit({ pkg: [{ noSeverityField: true }] })).toEqual({
      total: 1,
      blocking: 0,
      bySeverity: { unknown: 1 },
    });
    expect(summarizeAudit(null)).toEqual({ total: 0, blocking: 0, bySeverity: {} });
  });
});
