import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkTokens, contrastRatio, EXEMPT, readTokens } from './contrast';

const VARS = resolve(import.meta.dir, '../packages/ui/src/styles/vars.css');

const css = `
:root { --background: 0 0% 100%; --foreground: 0 0% 9%; }
.dark { --background: 0 0% 9%; --foreground: 0 0% 98%; }
`;

describe('token contrast guard', () => {
  test('parses both theme blocks', () => {
    const tokens = readTokens(css);
    expect(tokens.light.background).toBe('0 0% 100%');
    expect(tokens.dark.foreground).toBe('0 0% 98%');
  });

  test('matches the WCAG reference ratios', () => {
    expect(contrastRatio('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 0);
    expect(contrastRatio('0 0% 100%', '0 0% 100%')).toBeCloseTo(1, 1);
  });

  test('flags a pair below its floor', () => {
    const findings = checkTokens({
      light: { background: '0 0% 100%', foreground: '0 0% 60%' },
      dark: {},
    });
    expect(findings.find((f) => f.pair === 'foreground/background')?.ok).toBe(false);
  });

  test('every graded pair resolves in both themes', () => {
    const tokens = readTokens(readFileSync(VARS, 'utf8'));
    const unresolved = checkTokens(tokens).filter((f) => Number.isNaN(f.ratio));
    expect(unresolved).toEqual([]);
  });

  test('the real token file fails only on the documented exemptions', () => {
    const findings = checkTokens(readTokens(readFileSync(VARS, 'utf8')));
    const failures = findings.filter((f) => !f.ok).map((f) => f.pair);
    expect([...new Set(failures)].filter((pair) => !EXEMPT.includes(pair))).toEqual([]);
  });

  test('exemptions stay exactly the three upstream values', () => {
    expect([...EXEMPT].sort()).toEqual([
      'diff-del/background',
      'success-bg/success',
      'success/background',
    ]);
  });
});
