# Grove Logo System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Grove brand mark as code — a single geometry source of truth, a deterministic asset generator, and the mark wired into web, desktop and docs.

**Architecture:** Geometry lives in `packages/ui/src/brand/mark.ts` as pure constants and one parametric function; the React component and the asset generator both import it, so committed assets cannot drift from the app. The generator rasterizes SVG through Playwright's Chromium (already a devDependency) instead of a new rasterizer dependency, writes the ICO container by hand, and hands a pre-rendered 1024 PNG to `tauri icon` so the ember drop shadow is baked by the engine the design was verified in.

**Tech Stack:** Bun ≥ 1.3.14, TypeScript strict, React 19, Tailwind v4 (`@theme inline`), Biome, `bun test`, Playwright Chromium, `@tauri-apps/cli`.

**Spec:** `docs/superpowers/specs/2026-09-24-grove-logo-design.md`

**Two deliberate deviations from the spec's §11 order:**

1. The brand colour token (Task 4) lands **before** the component (Task 5). The spec lists the token inside §8 next to the component; the component's `text-mark-ember` class does not exist until the token does, so the token has to come first or Task 5 ships a dead utility.
2. `apps/desktop/app-icon.svg` is **deleted**, not overwritten. Spec §6.3 says to replace the placeholder; the placeholder is unreferenced (nothing in `tauri.conf.json`, `scripts/` or CI reads it) and keeping a second copy of the 1024 source would duplicate the generator's output. The single source is `assets/brand/app-icon.svg`.

## Global Constraints

- Bun only — no Node, no npm/pnpm/yarn lockfiles, no new `.js` files, TypeScript `strict` (with `noUncheckedIndexedAccess`).
- `bun run check` (typecheck + lint + test + smoke:server) MUST be green before every commit. Biome: 2-space indent, single quotes, 100 cols, semicolons.
- Conventional Commits, one logical change per commit, stage only the files the task names.
- **Mark geometry (verbatim from the spec):** `viewBox 0 0 32 32`; stroke width `4.2`; node radius `3.8`; tip radius `R = 9.7`; start radius `r0 = 1.5 + 0.3·w`; branch base angles `θ = −90° + k·120°`; offsets `start −14°`, `control1 −26°` at `r0 + 0.42·(R−r0)`, `control2 +10°` at `r0 + 0.78·(R−r0)`, `tip +16°` at `R`; node centre at `(θ+16°, R)`. Outer bound `R + 3.8 + 4.2/2 = 15.6` (must stay ≤ 15.7).
- **Colours (lowercase, because Biome's CSS formatter lowercases hex):** ember `#f54e00`, ember-dark `#ff7a3d`, graphite `#1c1c1c`, ink `#171717`, white `#ffffff`, parchment `#f7f7f4`, hairline `#cdcdc9`; shadow `#7a2200` at `0.65`.
- **Shadow rule:** `feDropShadow dx=0 dy=2.6 stdDeviation=2.4`, applied to the whole mark in ONE `<g>`. Used only on app icon, OG, avatar and rasterized lockups. NEVER on favicons and NEVER on the in-app mark.
- No new runtime dependencies. Playwright (`@playwright/test`, root devDependency) and `@tauri-apps/cli` (apps/desktop devDependency) are already installed.
- Every inline SVG in `.tsx` MUST carry `aria-label` + a `<title>` child — Biome's `a11y/noSvgWithoutTitle` is enabled and fails `bun run check`.
- Brand colours are NOT oc-2 tokens: do not add them to `packages/ui/src/styles/vars.css` and do not expect `bun run guard:tokens` to cover them.

## Review Focus

1. **A rasterizer silently dropping `feDropShadow`** — someone regenerates assets with a different tool and the shadow vanishes without any error. Expect: the mark keeps its ember shadow at ≥32px.
2. **Theme switch picking the wrong ember step** — a caller renders the light `#f54e00` on a dark surface (or vice versa). Expect: the mark uses `#f54e00` on light and `#ff7a3d` on dark, in the sidebar header and the landing.
3. **A malformed `favicon.ico`** — the hand-written ICO container is wrong and browsers fall back to no icon. Expect: the tab shows the graphite tile in Chrome and Safari.
4. **`tauri icon` regeneration dropping the Windows Store logos** — the desktop bundle loses `Square*Logo.png`/`StoreLogo.png`. Expect: `bun run smoke:bundle` stays green and the icons dir keeps the full set.
5. **Odd or fractional `size` on `Mark`** — a caller passes `size={18}` or `size={13.5}`. Expect: the mark scales cleanly (viewBox-driven) and stays centred, never clipped.

---

### Task 1: Mark geometry module

**Files:**
- Create: `packages/ui/src/brand/mark.ts`
- Test: `packages/ui/src/brand/mark.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MARK_VIEWBOX: 32`, `MARK_STROKE_WIDTH: 4.2`, `MARK_DOT_RADIUS: 3.8`, `MARK_TIP_RADIUS: 9.7`, `MARK_EMBER: '#f54e00'`, `MARK_EMBER_DARK: '#ff7a3d'`, `MARK_OUTER_BOUND: number`, `interface MarkBranch { path: string; dot: { cx: number; cy: number; r: number } }`, `markStartRadius(strokeWidth?: number): number`, `markBranches(strokeWidth?: number): MarkBranch[]`, `MARK_BRANCHES: MarkBranch[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/brand/mark.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  MARK_BRANCHES,
  MARK_DOT_RADIUS,
  MARK_OUTER_BOUND,
  MARK_TIP_RADIUS,
  MARK_VIEWBOX,
} from './mark';

const CENTRE = MARK_VIEWBOX / 2;
// Path numbers are rounded to 2 decimals, so a rotation comparison needs slack.
const EPS = 0.03;

function points(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  return [
    CENTRE + dx * Math.cos(rad) - dy * Math.sin(rad),
    CENTRE + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
}

describe('mark geometry', () => {
  test('draws exactly three branches', () => {
    expect(MARK_BRANCHES).toHaveLength(3);
  });

  test('puts every terminal node on the tip radius', () => {
    for (const { dot } of MARK_BRANCHES) {
      const r = Math.hypot(dot.cx - CENTRE, dot.cy - CENTRE);
      expect(Math.abs(r - MARK_TIP_RADIUS)).toBeLessThanOrEqual(EPS);
      expect(dot.r).toBe(MARK_DOT_RADIUS);
    }
  });

  test('rotates branch 1 by 120° and 240° to get branches 2 and 3', () => {
    const first = MARK_BRANCHES[0];
    expect(first).toBeDefined();
    if (!first) return;

    const base = points(first.path);
    for (const [index, branch] of MARK_BRANCHES.slice(1).entries()) {
      const expected: number[] = [];
      for (let p = 0; p < base.length; p += 2) {
        expected.push(...rotate(base[p] ?? 0, base[p + 1] ?? 0, 120 * (index + 1)));
      }
      const actual = points(branch.path);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((value, i) => {
        expect(Math.abs(value - (expected[i] ?? 0))).toBeLessThanOrEqual(EPS);
      });
    }
  });

  test('fits inside the 32-unit box with margin to spare', () => {
    expect(MARK_OUTER_BOUND).toBeLessThanOrEqual(15.7);
    expect(CENTRE - MARK_OUTER_BOUND).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/brand/mark.test.ts`
Expected: FAIL — `Cannot find module './mark'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/brand/mark.ts`:

```ts
/**
 * Grove brand mark — geometry source of truth.
 *
 * A6 "Branch pinwheel": three identical branches rotated 120° around the
 * centre, each ending in a filled node. The React component and the asset
 * generator both read these constants, so the committed assets and the app
 * cannot drift apart.
 *
 * Spec: docs/superpowers/specs/2026-09-24-grove-logo-design.md §3.
 */

export const MARK_VIEWBOX = 32;
export const MARK_STROKE_WIDTH = 4.2;
export const MARK_DOT_RADIUS = 3.8;
export const MARK_TIP_RADIUS = 9.7;

/** Ember, per mode. Lowercase to match Biome's CSS formatter output. */
export const MARK_EMBER = '#f54e00';
export const MARK_EMBER_DARK = '#ff7a3d';

/** Base angles in degrees, screen space (−90° is up). */
const BRANCH_ANGLES = [-90, 30, 150] as const;
const START_DEG = -14;
const CONTROL1_DEG = -26;
const CONTROL2_DEG = 10;
const TIP_DEG = 16;
const CONTROL1_RATIO = 0.42;
const CONTROL2_RATIO = 0.78;

export interface MarkBranch {
  /** Cubic bezier for the branch stroke. */
  path: string;
  /** Terminal node, same 0..32 space. */
  dot: { cx: number; cy: number; r: number };
}

const round2 = (n: number): number => Number(n.toFixed(2));

function polar(deg: number, radius: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [round2(16 + radius * Math.cos(rad)), round2(16 + radius * Math.sin(rad))];
}

/** Distance from the centre where a branch leaves the middle. */
export function markStartRadius(strokeWidth = MARK_STROKE_WIDTH): number {
  return 1.5 + 0.3 * strokeWidth;
}

export function markBranches(strokeWidth = MARK_STROKE_WIDTH): MarkBranch[] {
  const r0 = markStartRadius(strokeWidth);
  const span = MARK_TIP_RADIUS - r0;
  return BRANCH_ANGLES.map((theta) => {
    const [x0, y0] = polar(theta + START_DEG, r0);
    const [x1, y1] = polar(theta + CONTROL1_DEG, r0 + span * CONTROL1_RATIO);
    const [x2, y2] = polar(theta + CONTROL2_DEG, r0 + span * CONTROL2_RATIO);
    const [x3, y3] = polar(theta + TIP_DEG, MARK_TIP_RADIUS);
    return {
      path: `M${x0} ${y0} C${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`,
      dot: { cx: x3, cy: y3, r: MARK_DOT_RADIUS },
    };
  });
}

export const MARK_BRANCHES: MarkBranch[] = markBranches();

/** Farthest point of the drawn mark from the centre, stroke and node included. */
export const MARK_OUTER_BOUND = MARK_TIP_RADIUS + MARK_DOT_RADIUS + MARK_STROKE_WIDTH / 2;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test packages/ui/src/brand/mark.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/brand/mark.ts packages/ui/src/brand/mark.test.ts
git commit -m "feat(brand): add mark geometry source of truth"
```

---

### Task 2: Asset generator + source SVGs

**Files:**
- Create: `scripts/gen-brand-assets.ts`
- Create (generated): `assets/brand/{mark,mark-dark,mark-shadow,mark-shadow-dark,mark-mono-black,mark-mono-white,favicon,app-icon}.svg`
- Modify: `package.json` (add the `brand` script)
- Modify: `packages/ui/src/brand/mark.test.ts` (add the asset drift guard)

**Interfaces:**
- Consumes: `MARK_BRANCHES`, `MARK_STROKE_WIDTH`, `MARK_VIEWBOX`, `MARK_EMBER`, `MARK_EMBER_DARK` from Task 1.
- Produces: `bun run brand`; helper functions used again in Tasks 3, 6 and 7 — `markGroup(color: string, opts?: { scale?: number; shadow?: boolean }): string`, `SHADOW_DEF: string`, `SHADOW_PAD: 4`, `shadowViewBox(): string`, `svgDoc(body: string, opts?: { size?: number; defs?: string; pad?: number }): string`, `GRAPHITE: '#1c1c1c'`, `renderPng(svgText: string, size: number, outPath: string): Promise<void>`, `closeRenderer(): Promise<void>`.

- [ ] **Step 1: Write the failing drift guard**

Append to `packages/ui/src/brand/mark.test.ts` (keep the existing imports, add `MARK_BRANCHES` usage from Task 1):

```ts
test('the committed mark.svg matches the geometry module', async () => {
  const file = Bun.file(new URL('../../../../assets/brand/mark.svg', import.meta.url));
  expect(await file.exists()).toBe(true);
  const svg = await file.text();

  for (const branch of MARK_BRANCHES) {
    expect(svg).toContain(`d="${branch.path}"`);
    expect(svg).toContain(`cx="${branch.dot.cx}" cy="${branch.dot.cy}" r="${branch.dot.r}"`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/brand/mark.test.ts`
Expected: FAIL — `expect(received).toBe(true)` because `assets/brand/mark.svg` does not exist.

- [ ] **Step 3: Write the generator**

Create `scripts/gen-brand-assets.ts`:

```ts
/**
 * Generates every Grove brand asset from the geometry source of truth.
 *
 * Rasterization runs through Playwright's Chromium: it is the engine the
 * shadow was designed and verified in, and it is already a devDependency.
 * SVG goes through Chromium (never through resvg/sharp) so `feDropShadow`
 * cannot be silently dropped.
 *
 * Spec: docs/superpowers/specs/2026-09-24-grove-logo-design.md §6–§7.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import {
  MARK_BRANCHES,
  MARK_EMBER,
  MARK_EMBER_DARK,
  MARK_STROKE_WIDTH,
  MARK_VIEWBOX,
} from '../packages/ui/src/brand/mark';

const ROOT = process.cwd();
const BRAND_DIR = join(ROOT, 'assets/brand');

export const GRAPHITE = '#1c1c1c';
const INK = '#171717';
const WHITE = '#ffffff';

/** Ember drop shadow (S2). Applied to the whole mark in one group. */
export const SHADOW_DEF =
  '<filter id="mark-shadow" x="-50%" y="-50%" width="200%" height="200%">' +
  '<feDropShadow dx="0" dy="2.6" stdDeviation="2.4" flood-color="#7a2200" flood-opacity="0.65"/>' +
  '</filter>';

export function markGroup(
  color: string,
  opts: { scale?: number; shadow?: boolean } = {},
): string {
  const paths = MARK_BRANCHES.map((b) => `<path d="${b.path}"/>`).join('');
  const dots = MARK_BRANCHES.map(
    (b) => `<circle cx="${b.dot.cx}" cy="${b.dot.cy}" r="${b.dot.r}"/>`,
  ).join('');
  const transform = opts.scale
    ? ` transform="translate(16 16) scale(${opts.scale}) translate(-16 -16)"`
    : '';
  const filter = opts.shadow ? ' filter="url(#mark-shadow)"' : '';
  return (
    `<g${transform}${filter}>` +
    `<g fill="none" stroke="${color}" stroke-width="${MARK_STROKE_WIDTH}" stroke-linecap="round">${paths}</g>` +
    `<g fill="${color}">${dots}</g>` +
    '</g>'
  );
}

/**
 * User units of breathing room the ember shadow needs. `feDropShadow dy 2.6
 * std 2.4` throws ink ~5 units below the mark's own bbox, so a 0 0 32 32
 * viewport clips it. Standalone shadowed assets and the OG mark use the
 * padded box; the app icon does not need it (its mark is scaled to 0.62
 * inside the tile, so the shadow lands inside the 32-unit frame).
 */
export const SHADOW_PAD = 4;

export function shadowViewBox(): string {
  const box = MARK_VIEWBOX + SHADOW_PAD * 2;
  return `${-SHADOW_PAD} ${-SHADOW_PAD} ${box} ${box}`;
}

export function svgDoc(
  body: string,
  opts: { size?: number; defs?: string; pad?: number } = {},
): string {
  const pad = opts.pad ?? 0;
  const box = MARK_VIEWBOX + pad * 2;
  const size = opts.size ?? box;
  const viewBox = pad ? shadowViewBox() : `0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`;
  const defs = opts.defs ? `<defs>${opts.defs}</defs>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="${viewBox}">${defs}${body}</svg>\n`
  );
}

/** Graphite tile + mark. `radius` is in the 32-unit space. */
function tile(mark: string, radius: number, background = GRAPHITE): string {
  return `<rect width="${MARK_VIEWBOX}" height="${MARK_VIEWBOX}" rx="${radius}" fill="${background}"/>${mark}`;
}

const SOURCES: Record<string, string> = {
  'mark.svg': svgDoc(markGroup(MARK_EMBER)),
  'mark-dark.svg': svgDoc(markGroup(MARK_EMBER_DARK)),
  'mark-shadow.svg': svgDoc(markGroup(MARK_EMBER, { shadow: true }), {
    defs: SHADOW_DEF,
    pad: SHADOW_PAD,
  }),
  'mark-shadow-dark.svg': svgDoc(markGroup(MARK_EMBER_DARK, { shadow: true }), {
    defs: SHADOW_DEF,
    pad: SHADOW_PAD,
  }),
  'mark-mono-black.svg': svgDoc(markGroup(INK)),
  'mark-mono-white.svg': svgDoc(markGroup(WHITE)),
  // Favicons need a slightly rounder relative corner than a 1024 icon: at 16px
  // 7.2/32 reads square.
  'favicon.svg': svgDoc(tile(markGroup(MARK_EMBER, { scale: 0.62 }), 7.4)),
  'app-icon.svg': svgDoc(
    tile(markGroup(MARK_EMBER, { scale: 0.62, shadow: true }), 7.2),
    { size: 1024, defs: SHADOW_DEF },
  ),
};

let browser: Browser | undefined;
let page: Page | undefined;

export async function renderPng(svgText: string, size: number, outPath: string): Promise<void> {
  if (!browser) browser = await chromium.launch();
  if (!page) page = await browser.newPage();
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>` +
      `html,body{margin:0;padding:0;background:transparent}` +
      `svg{display:block;width:${size}px;height:${size}px}</style>${svgText}`,
  );
  await mkdir(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, omitBackground: true });
}

export async function closeRenderer(): Promise<void> {
  await page?.close();
  await browser?.close();
  page = undefined;
  browser = undefined;
}

async function writeSources(): Promise<void> {
  await mkdir(BRAND_DIR, { recursive: true });
  for (const [name, contents] of Object.entries(SOURCES)) {
    await Bun.write(join(BRAND_DIR, name), contents);
  }
  console.log(`brand: wrote ${Object.keys(SOURCES).length} source SVGs to assets/brand/`);
}

async function main(): Promise<void> {
  try {
    await writeSources();
  } finally {
    await closeRenderer();
  }
  console.log('brand: done');
}

if (import.meta.main) {
  await main();
}
```

`resolve` from `node:path` is deliberately NOT imported here — Task 6 adds it when it needs an absolute path for `tauri icon`.

- [ ] **Step 4: Add the `brand` script and run the generator**

In `package.json`, add to `"scripts"` (keep alphabetical neighbours, no trailing comma issues):

```json
"brand": "bun scripts/gen-brand-assets.ts",
```

Run: `bun run brand`
Expected: `brand: wrote 8 source SVGs to assets/brand/` then `brand: done`, and `assets/brand/` contains the 8 SVGs.

- [ ] **Step 5: Run the drift guard**

Run: `bun test packages/ui/src/brand/mark.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Prove the generator is idempotent**

```bash
bun run brand && shasum assets/brand/*.svg | shasum
bun run brand && shasum assets/brand/*.svg | shasum
```

Expected: the two digests are identical.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen-brand-assets.ts package.json assets/brand packages/ui/src/brand/mark.test.ts
git commit -m "feat(brand): generate source SVGs from the mark geometry"
```

---

### Task 3: Web favicons, PWA manifest and `index.html` wiring

**Files:**
- Modify: `scripts/gen-brand-assets.ts` (add web outputs + the ICO writer)
- Create (generated): `apps/web/public/{favicon.svg,favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png,icon-maskable-512.png,manifest.webmanifest}`
- Modify: `apps/web/index.html`
- Test: `scripts/brand-assets.test.ts`

**Interfaces:**
- Consumes: `markGroup`, `svgDoc`, `renderPng`, `GRAPHITE`, `SHADOW_DEF` from Task 2; `MARK_EMBER` from Task 1.
- Produces: `buildWebAssets(): Promise<void>`, `icoFromPngs(entries: { size: number; png: Uint8Array }[]): Uint8Array`.

- [ ] **Step 1: Write the failing contract test**

Create `scripts/brand-assets.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';

const PUBLIC = 'apps/web/public';

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('web brand assets', () => {
  test('manifest declares the Grove identity', async () => {
    const manifest = await Bun.file(`${PUBLIC}/manifest.webmanifest`).json();
    expect(manifest.name).toBe('Grove');
    expect(manifest.short_name).toBe('Grove');
    expect(manifest.theme_color).toBe('#1c1c1c');
  });

  test('every manifest icon exists at the size it declares', async () => {
    const manifest = await Bun.file(`${PUBLIC}/manifest.webmanifest`).json();
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const path = `${PUBLIC}${icon.src}`;
      expect(existsSync(path)).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      const actual = pngSize(Buffer.from(await Bun.file(path).arrayBuffer()));
      expect(actual).toEqual({ width: w, height: h });
    }
  });

  test('favicon.ico is a valid container listing 16, 32 and 48', async () => {
    const buf = Buffer.from(await Bun.file(`${PUBLIC}/favicon.ico`).arrayBuffer());
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
    expect(buf.readUInt16LE(4)).toBe(3);
    for (const i of [0, 1, 2]) {
      const entry = 6 + i * 16;
      expect(buf.readUInt8(entry)).toBe([16, 32, 48][i] ?? 0);
      expect(buf.readUInt8(entry + 1)).toBe([16, 32, 48][i] ?? 0);
      expect(buf.readUInt16LE(entry + 4)).toBe(1);
      expect(buf.readUInt16LE(entry + 6)).toBe(32);
      const offset = buf.readUInt32LE(entry + 12);
      const length = buf.readUInt32LE(entry + 8);
      expect(buf.subarray(offset + 1, offset + 4).toString('ascii')).toBe('PNG');
      expect(offset + length).toBeLessThanOrEqual(buf.length);
    }
  });

  test('apple-touch-icon is 180 square', async () => {
    const buf = Buffer.from(await Bun.file(`${PUBLIC}/apple-touch-icon.png`).arrayBuffer());
    expect(pngSize(buf)).toEqual({ width: 180, height: 180 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/brand-assets.test.ts`
Expected: FAIL — `ENOENT`/`expect(received).toBe(true)` because `manifest.webmanifest` does not exist.

- [ ] **Step 3: Add the web outputs to the generator**

In `scripts/gen-brand-assets.ts`, add above `main()`:

```ts
const WEB_PUBLIC = join(ROOT, 'apps/web/public');

/** ICO container holding PNG payloads (no dependency needed). */
export function icoFromPngs(entries: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((entry, i) => {
    const at = i * 16;
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    dir.writeUInt8(0, at + 2);
    dir.writeUInt8(0, at + 3);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(entry.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => Buffer.from(e.png))]);
}

async function buildWebAssets(): Promise<void> {
  await mkdir(WEB_PUBLIC, { recursive: true });

  const faviconSvg = SOURCES['favicon.svg'] ?? '';
  await Bun.write(join(WEB_PUBLIC, 'favicon.svg'), faviconSvg);

  // Maskable: full-bleed square, mark inside the 80% safe zone.
  const maskableSvg = svgDoc(
    `<rect width="${MARK_VIEWBOX}" height="${MARK_VIEWBOX}" fill="${GRAPHITE}"/>` +
      markGroup(MARK_EMBER, { scale: 0.55 }),
  );
  // iOS masks the corners itself, so the touch icon is full-bleed too.
  const touchSvg = svgDoc(
    `<rect width="${MARK_VIEWBOX}" height="${MARK_VIEWBOX}" fill="${GRAPHITE}"/>` +
      markGroup(MARK_EMBER, { scale: 0.62 }),
  );

  await renderPng(touchSvg, 180, join(WEB_PUBLIC, 'apple-touch-icon.png'));
  await renderPng(faviconSvg, 192, join(WEB_PUBLIC, 'icon-192.png'));
  await renderPng(faviconSvg, 512, join(WEB_PUBLIC, 'icon-512.png'));
  await renderPng(maskableSvg, 512, join(WEB_PUBLIC, 'icon-maskable-512.png'));

  const tmp = join(ROOT, '.brand-tmp');
  const icoSizes = [16, 32, 48];
  const icoEntries: { size: number; png: Uint8Array }[] = [];
  for (const size of icoSizes) {
    const out = join(tmp, `favicon-${size}.png`);
    await renderPng(faviconSvg, size, out);
    icoEntries.push({ size, png: await Bun.file(out).bytes() });
  }
  await Bun.write(join(WEB_PUBLIC, 'favicon.ico'), icoFromPngs(icoEntries));
  await rm(tmp, { recursive: true, force: true });

  const manifest = {
    name: 'Grove',
    short_name: 'Grove',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0f0f',
    theme_color: GRAPHITE,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  await Bun.write(
    join(WEB_PUBLIC, 'manifest.webmanifest'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log('brand: wrote web favicons, PWA icons and manifest');
}
```

Add `rm` to the `node:fs/promises` import at the top of the file, and call `await buildWebAssets();` inside `main()` after `writeSources()`. `SOURCES['app-icon.svg']` is read in Task 6, not here.

- [ ] **Step 4: Run the generator and the test**

```bash
bun run brand
bun test scripts/brand-assets.test.ts
```

Expected: generator prints both write lines; the test passes with 4 tests.

- [ ] **Step 5: Wire `apps/web/index.html`**

Replace the `<head>` block so it reads:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" sizes="any" href="/favicon.ico" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#1c1c1c" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Grove</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Verify the favicon visually at 16px**

Run: `bun run dev:web`, open the printed URL, and look at the browser tab.
Expected: the tab shows the graphite tile with the ember mark; no shadow smudge, no blur. Also open `http://localhost:5173/icon-192.png` and confirm it renders.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen-brand-assets.ts scripts/brand-assets.test.ts apps/web/public apps/web/index.html
git commit -m "feat(brand): ship web favicons, PWA icons and manifest"
```

---

### Task 4: Brand colour token

**Files:**
- Modify: `apps/web/src/styles/globals.css`
- Modify: `packages/ui/src/brand/mark.test.ts` (add the CSS drift guard)

**Interfaces:**
- Consumes: `MARK_EMBER`, `MARK_EMBER_DARK` from Task 1.
- Produces: the CSS variable `--mark-ember` (light and dark) and the Tailwind utility `text-mark-ember` / `bg-mark-ember` for Task 5.

- [ ] **Step 1: Write the failing drift guard**

Append to `packages/ui/src/brand/mark.test.ts`:

```ts
test('the web brand colour token mirrors the mark constants', async () => {
  const css = await Bun.file(
    new URL('../../../../apps/web/src/styles/globals.css', import.meta.url),
  ).text();
  const rootAt = css.indexOf(':root {');
  const darkAt = css.indexOf('.dark {');
  expect(rootAt).toBeGreaterThan(-1);
  expect(darkAt).toBeGreaterThan(-1);
  const root = css.slice(rootAt, css.indexOf('}', rootAt));
  const dark = css.slice(darkAt, css.indexOf('}', darkAt));
  expect(root).toContain(`--mark-ember: ${MARK_EMBER};`);
  expect(dark).toContain(`--mark-ember: ${MARK_EMBER_DARK};`);
});
```

Add `MARK_EMBER` and `MARK_EMBER_DARK` to the existing import from `./mark`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/ui/src/brand/mark.test.ts`
Expected: FAIL — `expect(received).toBeGreaterThan(-1)` because `:root {` is not in `globals.css` yet.

- [ ] **Step 3: Add the token**

In `apps/web/src/styles/globals.css`, insert directly above `@theme inline {`:

```css
/* Brand mark colour, one ember step per mode. Values mirror MARK_EMBER /
 * MARK_EMBER_DARK in packages/ui/src/brand/mark.ts — the drift guard lives in
 * packages/ui/src/brand/mark.test.ts. Brand colours stay out of the oc-2
 * token set on purpose (see docs/superpowers/specs/2026-09-24-grove-logo-design.md §4). */
:root {
  --mark-ember: #f54e00;
}

.dark {
  --mark-ember: #ff7a3d;
}
```

And inside `@theme inline {`, next to the other colour mappings (after `--color-agent-writer: …`):

```css
  --color-mark-ember: var(--mark-ember);
```

- [ ] **Step 4: Run the test and the formatter**

```bash
bun test packages/ui/src/brand/mark.test.ts
bun run format
```

Expected: 6 tests pass; `format` leaves the file unchanged (Biome already lowercased the hex).

- [ ] **Step 5: Verify both modes visually**

Run: `bun run dev:web`, open the app, toggle the theme (the app's theme control), and inspect any element that will host the mark. Until Task 5 lands, verify with devtools: `getComputedStyle(document.documentElement).getPropertyValue('--mark-ember')` returns `#f54e00` in light and `#ff7a3d` with the dark class applied.
Expected: the two different ember steps.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles/globals.css packages/ui/src/brand/mark.test.ts
git commit -m "feat(brand): add the ember mark colour token"
```

---

### Task 5: `Mark` component and in-app placement

**Files:**
- Create: `packages/ui/src/components/mark.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/web/src/features/sessions/SessionSidebar.tsx` (the `✦` badge in the header, ~line 204)
- Modify: `apps/web/src/app/router.tsx` (the `✦` badge on the landing, ~line 80)

**Interfaces:**
- Consumes: `MARK_BRANCHES`, `MARK_STROKE_WIDTH`, `MARK_VIEWBOX` from Task 1; `text-mark-ember` from Task 4.
- Produces: `Mark({ size = 16, title = 'Grove', className }: { size?: number; title?: string; className?: string })`.

**No unit test:** this repo has zero `.test.tsx` files — UI changes are verified against the running surface, and a DOM test here could only assert path text, which the geometry tests in Task 1 already cover.

- [ ] **Step 1: Write the component**

Create `packages/ui/src/components/mark.tsx`:

```tsx
import { MARK_BRANCHES, MARK_STROKE_WIDTH, MARK_VIEWBOX } from '../brand/mark';
import { cn } from '../utils';

/**
 * Grove mark — A6 branch pinwheel. Draws with `currentColor` so the caller
 * picks the ember step (`text-mark-ember` flips per theme in apps/web).
 * Geometry: packages/ui/src/brand/mark.ts.
 */
export function Mark({
  size = 16,
  title = 'Grove',
  className,
}: {
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      role="img"
      aria-label={title}
      className={cn('shrink-0', className)}
    >
      <title>{title}</title>
      <g fill="none" stroke="currentColor" strokeWidth={MARK_STROKE_WIDTH} strokeLinecap="round">
        {MARK_BRANCHES.map((branch) => (
          <path key={branch.path} d={branch.path} />
        ))}
      </g>
      <g fill="currentColor">
        {MARK_BRANCHES.map((branch) => (
          <circle key={branch.path} cx={branch.dot.cx} cy={branch.dot.cy} r={branch.dot.r} />
        ))}
      </g>
    </svg>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add (keeping the alphabetical order of the list):

```ts
export { Mark } from './components/mark';
```

- [ ] **Step 3: Replace the sidebar placeholder**

In `apps/web/src/features/sessions/SessionSidebar.tsx`, replace:

```tsx
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-body font-strong text-primary-foreground">
          ✦
        </span>
```

with:

```tsx
        <span className="flex size-6 items-center justify-center">
          <Mark size={16} className="text-mark-ember" />
        </span>
```

Add `Mark` to the existing `@grove/ui` import in that file.

- [ ] **Step 4: Replace the landing placeholder**

In `apps/web/src/app/router.tsx`, replace:

```tsx
          <span className="flex size-12 items-center justify-center rounded-md bg-primary text-title font-strong text-primary-foreground">
            ✦
          </span>
```

with:

```tsx
          <span className="flex size-12 items-center justify-center">
            <Mark size={32} className="text-mark-ember" />
          </span>
```

Add `Mark` to the existing `@grove/ui` import in that file.

- [ ] **Step 5: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean — in particular no `a11y/noSvgWithoutTitle` diagnostic from the new component.

- [ ] **Step 6: Verify on the running surface**

Run: `bun run dev:web` and open the app.
Expected, in both light and dark theme: the sidebar header shows the ember pinwheel at 16px where `✦` used to be, the landing shows it at 32px, the mark is flat (no shadow, no tile), and it is visually centred in its 24px/48px slot.

Then exercise the odd-size case: temporarily change the landing mark to `size={18}` and then to `size={13.5}`, and confirm each stays centred and unclipped (the viewBox drives the scale). Set it back to `size={32}` before committing.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/mark.tsx packages/ui/src/index.ts apps/web/src/features/sessions/SessionSidebar.tsx apps/web/src/app/router.tsx
git commit -m "feat(brand): add Mark component and place it in the app"
```

---

### Task 6: Desktop app icon and Tauri icon set

**Files:**
- Modify: `scripts/gen-brand-assets.ts` (render the 1024 PNG and call `tauri icon`)
- Create (generated): `assets/brand/app-icon-1024.png`
- Modify (generated): `apps/desktop/src-tauri/icons/*`
- Delete: `apps/desktop/app-icon.svg` (superseded placeholder; nothing references it)

**Interfaces:**
- Consumes: `SOURCES['app-icon.svg']`, `renderPng`, `closeRenderer` from Task 2.
- Produces: `buildDesktopIcons(): Promise<void>`.

- [ ] **Step 1: Extend the generator**

In `scripts/gen-brand-assets.ts`, add `import { resolve } from 'node:path'` (extend the existing `node:path` import) and `import { $ } from 'bun'`, then add:

```ts
async function buildDesktopIcons(): Promise<void> {
  const appIconSvg = SOURCES['app-icon.svg'] ?? '';
  const png = join(BRAND_DIR, 'app-icon-1024.png');
  await renderPng(appIconSvg, 1024, png);
  await closeRenderer();

  // Tauri's own rasterizer must not be trusted with feDropShadow: hand it the
  // PNG Chromium already rendered, and it only has to slice sizes.
  await $`bun run tauri icon ${resolve(png)}`.cwd(join(ROOT, 'apps/desktop'));
  console.log('brand: regenerated apps/desktop/src-tauri/icons/');
}
```

Call `await buildDesktopIcons();` in `main()` after `buildWebAssets()`.

- [ ] **Step 2: Run it and inspect the output**

```bash
bun run brand
ls apps/desktop/src-tauri/icons
```

Expected: `icon.icns`, `icon.ico`, `icon.png`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, the `Square*Logo.png` set and `StoreLogo.png` are all present and freshly written.

- [ ] **Step 3: Confirm the shadow survived rasterization**

Read `assets/brand/app-icon-1024.png` as an image.
Expected: graphite tile, ember pinwheel with a visible ember shadow under the branches — not a flat mark, not a black halo.

- [ ] **Step 4: Remove the superseded placeholder**

```bash
git rm apps/desktop/app-icon.svg
```

- [ ] **Step 5: Verify the packaged bundle still passes**

Run: `bun run build:desktop && bun run smoke:bundle`
Expected: both green; the bundle smoke test still finds the sidecar and the main binary, and the icons dir kept the Windows Store logos.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-brand-assets.ts assets/brand/app-icon-1024.png apps/desktop/src-tauri/icons
git commit -m "feat(brand): generate the desktop icon set from the mark"
```

---

### Task 7: OG image, avatar and README mark

**Files:**
- Modify: `scripts/gen-brand-assets.ts` (OG template + avatar)
- Create (generated): `apps/web/public/og.png`, `assets/brand/avatar-512.png`
- Modify: `README.md`

**Interfaces:**
- Consumes: `markGroup`, `SHADOW_DEF`, `renderPng`, `closeRenderer`, `SOURCES['app-icon.svg']`.
- Produces: `buildSocialAssets(): Promise<void>`.

- [ ] **Step 1: Extend the generator**

In `scripts/gen-brand-assets.ts`, add:

```ts
async function buildSocialAssets(): Promise<void> {
  const appIconSvg = SOURCES['app-icon.svg'] ?? '';
  await renderPng(appIconSvg, 512, join(BRAND_DIR, 'avatar-512.png'));

  const inter = Buffer.from(
    await Bun.file(join(ROOT, 'apps/web/public/fonts/InterVariable.woff2')).arrayBuffer(),
  ).toString('base64');
  const mark = markGroup(MARK_EMBER_DARK, { shadow: true });
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter}) format("woff2-variations");font-weight:100 900}` +
    `*{margin:0;box-sizing:border-box}` +
    `body{width:1200px;height:630px;background:#0f0f0f;color:#fafafa;font-family:Inter;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px}` +
    `.row{display:flex;align-items:center;gap:28px}` +
    `.row span{font-size:72px;font-weight:530;letter-spacing:-0.02em}` +
    `p{font-size:28px;font-weight:400;color:#a1a19f;max-width:900px;text-align:center}` +
    `</style></head><body><div class="row">` +
    `<svg width="160" height="160" viewBox="${shadowViewBox()}">` +
    `<defs>${SHADOW_DEF}</defs>${mark}</svg>` +
    `<span>Grove</span></div>` +
    `<p>Web UI with the full capability set of the OMP TUI</p></body></html>`;

  if (!browser) browser = await chromium.launch();
  if (!page) page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(html);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path: join(WEB_PUBLIC, 'og.png') });
  await closeRenderer();
  console.log('brand: wrote og.png and avatar-512.png');
}
```

Call `await buildSocialAssets();` in `main()` after `buildDesktopIcons()`.

- [ ] **Step 2: Run it and inspect both images**

```bash
bun run brand
```

Read `apps/web/public/og.png` and `assets/brand/avatar-512.png` as images.
Expected: the OG is 1200×630, dark `#0f0f0f`, ember-dark pinwheel with its shadow at the left of the wordmark, "Grove" in Inter (not a fallback serif/sans), tagline below in grey. The avatar is the graphite tile at 512.

- [ ] **Step 3: Add the mark to the README**

Insert at the very top of `README.md`, above `# Grove`:

```html
<p align="center">
  <img src="assets/brand/mark.svg" width="72" alt="Grove mark" />
</p>

```

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-brand-assets.ts apps/web/public/og.png assets/brand/avatar-512.png README.md
git commit -m "feat(brand): add the social image, avatar and README mark"
```

---

### Task 8: Docs and the final gate

**Files:**
- Modify: `docs/design-system.md` (new "Brand mark" section)
- Modify: `AGENTS.md` (Key Directories)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Document the brand mark**

In `docs/design-system.md`, add a section after the "Grove App Decisions" list:

```markdown
## Brand mark (Grove logo)

Mark: **A6 branch pinwheel** — three branches rotated 120°, one hue, no container. Source of
truth for geometry and colour: `packages/ui/src/brand/mark.ts`. Spec:
`docs/superpowers/specs/2026-09-24-grove-logo-design.md`.

- **In the UI the mark is flat**: `currentColor` + `text-mark-ember`, no tile, no shadow.
- **Brand colours are not oc-2 tokens** — `#f54e00` (light) / `#ff7a3d` (dark) live in
  `apps/web/src/styles/globals.css` as `--mark-ember`, deliberately outside the token guard.
- **The ember drop shadow** (`feDropShadow dy 2.6 std 2.4 #7a2200 @0.65`) exists only on assets
  ≥ 32px: app icon, OG, avatar. Never on favicons, never in the UI.
- **Assets are generated**: `bun run brand` writes `assets/brand/*.svg`, the web favicons/PWA
  icons/manifest and `og.png`, then hands a 1024 PNG to `tauri icon`. Never hand-edit a file
  under `assets/brand/` or `apps/web/public/`.
```

- [ ] **Step 2: Point the repo guide at the assets**

In `AGENTS.md`, add to the Key Directories list (after the `tests/` line):

```markdown
- `assets/brand/` — brand mark nguồn (SVG + PNG sinh ra từ `packages/ui/src/brand/mark.ts`); sinh lại bằng `bun run brand`, không sửa tay.
```

- [ ] **Step 3: Full gate**

Run: `bun run check`
Expected: green (typecheck + lint + test + smoke:server). If lint flags the generated `.svg`/`.webmanifest`, fix the generator output, not the generated file.

- [ ] **Step 4: Idempotency + clean tree**

```bash
bun run brand && git status --porcelain
```

Expected: empty output — regenerating changes nothing.

- [ ] **Step 5: Final visual pass**

Run: `bun run dev:web` and walk the surfaces: tab favicon, sidebar header mark, landing mark, both themes; then `bun run build:desktop` and open the built app to check the dock icon.
Expected: every surface matches the approved summary screen (mark flat in UI, graphite tile in OS surfaces, ember shadow only on the app icon and OG).

- [ ] **Step 6: Commit**

```bash
git add docs/design-system.md AGENTS.md
git commit -m "docs(brand): document the mark, its tokens and the asset pipeline"
```
