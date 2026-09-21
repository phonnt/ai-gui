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
      recognized: true,
    });
  });

  test('a clean report blocks nothing', () => {
    expect(summarizeAudit({})).toEqual({
      total: 0,
      blocking: 0,
      bySeverity: {},
      recognized: true,
    });
  });

  test('an unrecognised shape is reported, not silently ignored', () => {
    // Older/newer bun shapes must surface as `unknown` severities instead of
    // counting as zero advisories.
    expect(summarizeAudit({ weird: 'not-an-array' }).recognized).toBe(false);
    expect(summarizeAudit({ pkg: [{ noSeverityField: true }] }).recognized).toBe(false);
    expect(summarizeAudit(null).recognized).toBe(false);
    // The wrapper the plan assumed: parseable JSON, none of our severities.
    expect(summarizeAudit({ advisories: { a: { severity: 'critical' } } })).toEqual({
      total: 0,
      blocking: 0,
      bySeverity: {},
      recognized: false,
    });
  });
});
