import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Run an export render inside a temp dir and hand the path back.
 *
 * The route that streams the document deletes the dir once the download is
 * written, but a render that *throws* never reaches the route — so the failure
 * path cleans up here, and repeated attempts cannot pile up empty
 * `grove-export-*` dirs in `$TMPDIR`.
 */
export async function writeTempExport(
  write: (path: string) => Promise<unknown>,
): Promise<{ path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'grove-export-'));
  const path = join(dir, 'session.html');
  try {
    await write(path);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return { path };
}
