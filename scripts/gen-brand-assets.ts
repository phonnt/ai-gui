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
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type Browser, chromium, type Page } from '@playwright/test';
import { $ } from 'bun';
import {
  MARK_BRANCHES,
  MARK_EMBER,
  MARK_EMBER_DARK,
  MARK_STROKE_WIDTH,
  MARK_VIEWBOX,
} from '../packages/ui/src/brand/mark';

const ROOT = process.cwd();
const BRAND_DIR = join(ROOT, 'assets/brand');
const WEB_PUBLIC = join(ROOT, 'apps/web/public');

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

  // ICO needs real PNG payloads; stage them in the OS temp dir, never in the repo.
  const tmp = await mkdtemp(join(tmpdir(), 'grove-brand-'));
  const icoEntries: { size: number; png: Uint8Array }[] = [];
  for (const size of [16, 32, 48]) {
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

async function buildDesktopIcons(): Promise<void> {
  const appIconSvg = SOURCES['app-icon.svg'] ?? '';
  const png = join(BRAND_DIR, 'app-icon-1024.png');
  await renderPng(appIconSvg, 1024, png);
  await closeRenderer();

  // Tauri's own rasterizer must not be trusted with feDropShadow: hand it the
  // PNG Chromium already rendered, and it only has to slice sizes.
  await $`bun run tauri icon ${resolve(png)}`.cwd(join(ROOT, 'apps/desktop'));

  // `tauri icon` also emits android/ and ios/ sets. Grove ships macOS arm64 and
  // Windows x64 only (docs/desktop-release.md), so those are dead weight.
  const iconsDir = join(ROOT, 'apps/desktop/src-tauri/icons');
  await rm(join(iconsDir, 'android'), { recursive: true, force: true });
  await rm(join(iconsDir, 'ios'), { recursive: true, force: true });
  console.log('brand: regenerated apps/desktop/src-tauri/icons/');
}

async function main(): Promise<void> {
  try {
    await writeSources();
    await buildWebAssets();
    await buildDesktopIcons();
  } finally {
    await closeRenderer();
  }
  console.log('brand: done');
}

if (import.meta.main) {
  await main();
}
