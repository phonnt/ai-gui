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
});
