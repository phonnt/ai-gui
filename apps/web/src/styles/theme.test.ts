import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GLOBALS = readFileSync(resolve(import.meta.dir, 'globals.css'), 'utf8');
const VARS = readFileSync(
  resolve(import.meta.dir, '../../../../packages/ui/src/styles/vars.css'),
  'utf8',
);

/** Body of the first `@theme inline { ... }` block, or '' when absent. */
function themeBlock(css: string): string {
  const start = css.indexOf('@theme inline {');
  if (start === -1) return '';
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end);
}

/** Custom properties declared in a selector block (`:root` / `.dark`). */
function tokenBlock(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const out = new Map<string, string>();
  if (start === -1) return out;
  const end = css.indexOf('\n}', start);
  // Values can wrap across lines (biome lineWidth), so split on `;` not on `\n`.
  for (const decl of css.slice(start, end).split(';')) {
    const m = decl.match(/(--[a-z0-9-]+):\s*([\s\S]+)/);
    if (m?.[1] && m[2]) out.set(m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  return out;
}

describe('theme layer contract', () => {
  test('every colour utility maps to a token defined in both modes', () => {
    const theme = themeBlock(GLOBALS);
    const mappings = [...theme.matchAll(/--color-([a-z0-9-]+):\s*hsl\(var\((--[a-z0-9-]+)\)\)/g)];
    expect(mappings.length).toBeGreaterThan(20);

    const light = tokenBlock(VARS, ':root');
    const dark = tokenBlock(VARS, '.dark');
    const missing = mappings
      .map((match) => match[2])
      .filter((token): token is string => typeof token === 'string')
      .filter((token) => !light.has(token) || !dark.has(token));

    expect(missing).toEqual([]);
  });

  test('type ramp, weights and radius come from the theme block', () => {
    const theme = themeBlock(GLOBALS);
    for (const token of [
      '--text-meta',
      '--text-small',
      '--text-body',
      '--text-title',
      '--text-hero',
      '--text-body--line-height',
      '--text-body--letter-spacing',
      '--font-weight-regular',
      '--font-weight-strong',
      '--font-sans',
    ]) {
      expect(theme).toContain(`${token}:`);
    }
    expect(theme).toContain('--radius-sm: 4px');
    expect(theme).toContain('--radius-md: 6px');
    expect(theme).toContain('--radius-lg: 8px');
    expect(theme).toContain('--radius-xl: 10px');
  });

  test('elevation tokens exist for both colour schemes', () => {
    const light = tokenBlock(VARS, ':root');
    const dark = tokenBlock(VARS, '.dark');
    for (const token of [
      '--elevation-raised',
      '--elevation-floating',
      '--elevation-overlay',
      '--elevation-control',
    ]) {
      expect(light.get(token)).toBeTruthy();
      expect(dark.get(token)).toBeTruthy();
      expect(dark.get(token)).not.toBe(light.get(token));
    }
    expect(dark.get('--elevation-raised')).toContain('255 255 255');
  });
});
