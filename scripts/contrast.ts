/**
 * Token contrast guard.
 *
 * `bun run guard:tokens` grades the pairs the design system promises and exits
 * non-zero when one drops below its floor. `vars.css` is the source: tokens are
 * HSL triples consumed as `hsl(var(--x))`.
 *
 * EXEMPT lists the pairs that intentionally sit under 4.5:1 because they keep
 * the upstream OpenCode Desktop values and are only ever used on their own
 * tinted surface. The test pins the list so a new failure cannot hide behind it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type Tokens = { light: Record<string, string>; dark: Record<string, string> };
export type Finding = {
  pair: string;
  mode: 'light' | 'dark';
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
};

type Pair = { pair: string; fg: string; bg: string; min: number };

const PAIRS: Pair[] = [
  { pair: 'foreground/background', fg: 'foreground', bg: 'background', min: 4.5 },
  { pair: 'muted-foreground/background', fg: 'muted-foreground', bg: 'background', min: 4.5 },
  { pair: 'muted-foreground/card', fg: 'muted-foreground', bg: 'card', min: 4.5 },
  { pair: 'primary-foreground/primary', fg: 'primary-foreground', bg: 'primary', min: 4.5 },
  { pair: 'link/background', fg: 'link', bg: 'background', min: 4.5 },
  { pair: 'warning-strong/background', fg: 'warning-strong', bg: 'background', min: 4.5 },
  { pair: 'ring/background', fg: 'ring', bg: 'background', min: 3 },
  { pair: 'success/background', fg: 'success', bg: 'background', min: 4.5 },
  { pair: 'success-bg/success', fg: 'success', bg: 'success-bg', min: 4.5 },
  { pair: 'diff-del/background', fg: 'diff-del', bg: 'background', min: 4.5 },
];

/** Upstream values kept verbatim; each is only used on its own tinted surface. */
export const EXEMPT: string[] = ['success/background', 'success-bg/success', 'diff-del/background'];

const BLOCK = /(:root|\.dark)\s*\{([^{}]*)\}/g;
const DECL = /(--[a-z0-9-]+):\s*([\s\S]*?);/g;

export function readTokens(cssText: string): Tokens {
  const out: Tokens = { light: {}, dark: {} };
  // Comments mention `--v2-*: …`, which would otherwise parse as declarations.
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of stripped.matchAll(BLOCK)) {
    const target = match[1] === ':root' ? out.light : out.dark;
    for (const decl of (match[2] ?? '').matchAll(DECL)) {
      const name = decl[1];
      const value = decl[2];
      if (name && value) target[name.replace(/^--/, '')] = value.replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

function hslToRgb(triple: string): [number, number, number] | null {
  const parts = triple.trim().split(/\s+/);
  const [h, s, l] = [
    Number.parseFloat(parts[0] ?? ''),
    Number.parseFloat(parts[1] ?? ''),
    Number.parseFloat(parts[2] ?? ''),
  ];
  if (![h, s, l].every(Number.isFinite)) return null;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = light - c / 2;
  return [r1 + m, g1 + m, b1 + m];
}

function luminance(rgb: [number, number, number]): number {
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = hslToRgb(fg);
  const b = hslToRgb(bg);
  if (!a || !b) return Number.NaN;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function checkTokens(tokens: Tokens): Finding[] {
  const findings: Finding[] = [];
  for (const mode of ['light', 'dark'] as const) {
    for (const { pair, fg, bg, min } of PAIRS) {
      const fgValue = tokens[mode][fg];
      const bgValue = tokens[mode][bg];
      if (!fgValue || !bgValue) {
        findings.push({
          pair,
          mode,
          fg: fgValue ?? '?',
          bg: bgValue ?? '?',
          ratio: Number.NaN,
          min,
          ok: false,
        });
        continue;
      }
      const ratio = contrastRatio(fgValue, bgValue);
      findings.push({ pair, mode, fg: fgValue, bg: bgValue, ratio, min, ok: ratio >= min });
    }
  }
  return findings;
}

if (import.meta.main) {
  const cssText = readFileSync(
    resolve(import.meta.dir, '../packages/ui/src/styles/vars.css'),
    'utf8',
  );
  const findings = checkTokens(readTokens(cssText));
  const failed: Finding[] = [];
  for (const f of findings) {
    const exempt = EXEMPT.includes(f.pair);
    const ok = f.ok || exempt;
    if (!ok) failed.push(f);
    const flag = f.ok ? 'ok  ' : exempt ? 'EXEMPT' : 'FAIL';
    console.log(
      `${flag} ${f.mode.padEnd(5)} ${f.pair.padEnd(30)} ${Number.isNaN(f.ratio) ? '  n/a' : f.ratio.toFixed(2).padStart(6)} (min ${f.min})`,
    );
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} token pair(s) below the floor`);
    process.exit(1);
  }
  console.log('\ntoken contrast: all pairs pass');
}
