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

export function markGroup(color: string, opts: { scale?: number; shadow?: boolean } = {}): string {
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
  opts: { size?: number; defs?: string; pad?: number; title?: string } = {},
): string {
  const pad = opts.pad ?? 0;
  const box = MARK_VIEWBOX + pad * 2;
  const size = opts.size ?? box;
  const viewBox = pad ? shadowViewBox() : `0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`;
  const defs = opts.defs ? `<defs>${opts.defs}</defs>` : '';
  // Biome lints .svg files and rejects an SVG with no accessible name, so every
  // generated asset carries one (a rasterizer ignores it).
  const title = `<title>${opts.title ?? 'Grove'}</title>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="${viewBox}" role="img">${title}${defs}${body}</svg>\n`
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
  'app-icon.svg': svgDoc(tile(markGroup(MARK_EMBER, { scale: 0.62, shadow: true }), 7.2), {
    size: 1024,
    defs: SHADOW_DEF,
  }),
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
