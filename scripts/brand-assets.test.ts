import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { MARK_BRANCHES, MARK_VIEWBOX } from '../packages/ui/src/brand/mark';

const PUBLIC = 'apps/web/public';

/** Painted bounding box of the mark in the 32-unit space (the nodes dominate). */
function paintedExtent(): { width: number; height: number } {
  const xs = MARK_BRANCHES.flatMap((b) => [b.dot.cx - b.dot.r, b.dot.cx + b.dot.r]);
  const ys = MARK_BRANCHES.flatMap((b) => [b.dot.cy - b.dot.r, b.dot.cy + b.dot.r]);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

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
      const [w = 0, h = 0] = icon.sizes.split('x').map(Number);
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

  // The OG mark is a rasterized slot, so its painted size can only be pinned by
  // measuring pixels. Chromium is already a devDependency (e2e + the generator).
  test('og.png paints the mark at the size the spec asks for', async () => {
    const b64 = Buffer.from(await Bun.file(`${PUBLIC}/og.png`).arrayBuffer()).toString('base64');
    const browser = await chromium.launch();
    let bbox: { width: number; height: number };
    try {
      const page = await browser.newPage();
      bbox = await page.evaluate(async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0);
        const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let minX = canvas.width;
        let maxX = -1;
        let minY = canvas.height;
        let maxY = -1;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const r = px[i] ?? 0;
            const g = px[i + 1] ?? 0;
            const b = px[i + 2] ?? 0;
            // Ember only: bright red, mid green, low blue. Excludes the shadow.
            if (r > 200 && g > 60 && g < 160 && b < 90) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { width: maxX - minX + 1, height: maxY - minY + 1 };
      }, b64);
    } finally {
      await browser.close();
    }

    const extent = paintedExtent();
    // The spec sizes the mark as if it sat in a 32-unit viewBox at 160px; the
    // shadow padding must not shrink it.
    const expected = {
      width: (extent.width / MARK_VIEWBOX) * 160,
      height: (extent.height / MARK_VIEWBOX) * 160,
    };
    expect(Math.abs(bbox.width - expected.width)).toBeLessThanOrEqual(3);
    expect(Math.abs(bbox.height - expected.height)).toBeLessThanOrEqual(3);
  });
});
