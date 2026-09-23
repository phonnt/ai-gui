import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeTempExport } from './export-temp.js';

/**
 * The export writes a document into a temp dir and hands the path to the route.
 * The route deletes the dir once the download finishes, but a *failed* render
 * never reaches the route, so the writer has to clean up after itself — the
 * sibling `exportHtml` does the same.
 */
describe('writeTempExport', () => {
  test('hands back a path the caller owns once the write succeeds', async () => {
    const { path } = await writeTempExport(async (target) => {
      writeFileSync(target, '<html>ok</html>');
    });

    expect(readFileSync(path, 'utf8')).toBe('<html>ok</html>');

    // caller owns it (the route removes the dir)
    const { rm } = await import('node:fs/promises');
    await rm(dirname(path), { recursive: true, force: true });
  });

  test('a failing render leaves no temp dir behind', async () => {
    const seen = { dir: '' };
    const err: unknown = await writeTempExport(async (target) => {
      seen.dir = dirname(target);
      throw new Error('render exploded');
    }).catch((e) => e);

    expect((err as Error).message).toBe('render exploded');
    expect(seen.dir).not.toBe('');
    expect(existsSync(seen.dir)).toBe(false);
  });
});
