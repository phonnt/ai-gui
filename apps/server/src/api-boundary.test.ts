import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Boots the real server and drives the bare `/api` path, which has no route of
// its own. Regression: the auth guard and the static exclusion must agree that
// `/api` is API surface — otherwise it skips the guard and gets served as SPA.
setDefaultTimeout(30_000);

const TOKEN = 'test-token-bare-api';
const SERVER_DIR = join(import.meta.dir, '..');
const ENTRY = join(import.meta.dir, 'index.ts');
const SPA_MARKER = '<!doctype html><title>spa</title>';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address && typeof address === 'object') {
        probe.close(() => resolve(address.port));
      } else {
        probe.close(() => reject(new Error('no port')));
      }
    });
  });
}

describe('bare /api guard/static boundary', () => {
  let child: ChildProcess | undefined;
  let port = 0;
  let dist = '';
  let stderr = '';

  beforeAll(async () => {
    dist = await mkdtemp(join(tmpdir(), 'ai-gui-dist-'));
    await writeFile(join(dist, 'index.html'), SPA_MARKER);
    port = await freePort();
    child = spawn(process.execPath, [ENTRY], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        AI_GUI_PORT: String(port),
        AI_GUI_TOKEN: TOKEN,
        AI_GUI_WEB_DIST: dist,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
          headers: { 'x-ai-gui-token': TOKEN },
        });
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server did not start\n${stderr}`);
      await Bun.sleep(100);
    }
  });

  afterAll(async () => {
    child?.kill('SIGKILL');
    if (dist) await rm(dist, { recursive: true, force: true });
  });

  test('bare /api requires auth when a token is set', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api`);
    expect(res.status).toBe(401);
  });

  test('bare /api is never served statically', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api`, {
      headers: { 'x-ai-gui-token': TOKEN },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('spa');
  });

  test('the SPA still serves a non-api root', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('spa');
  });
});
