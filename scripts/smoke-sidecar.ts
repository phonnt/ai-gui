#!/usr/bin/env bun
// Runs the compiled sidecar and asserts /api/health answers. Guards the two
// packaging regressions that compile hides: missing native addon and a new
// unbundled dynamic import.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'apps/desktop/binaries';
// Absolute: spawn() resolves a relative command against `cwd`, which is set to DIR below.
const BIN = resolve(DIR, 'ai-gui-server-aarch64-apple-darwin');
const PORT = '8907';

if (!existsSync(BIN)) {
  console.error(`missing sidecar: run \`bun run build:desktop\` first (${BIN})`);
  process.exit(1);
}

const child = spawn(BIN, { cwd: DIR, env: { ...process.env, AI_GUI_PORT: PORT } });
let stderr = '';
child.stderr.on('data', (chunk: Buffer) => {
  stderr += chunk.toString();
});

const deadline = Date.now() + 10_000;
let ok = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    const json = (await res.json()) as { ok?: boolean };
    if (res.ok && json.ok === true) {
      ok = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await Bun.sleep(150);
}

// Creating a session forces the native addon + SDK runtime to load — the two
// regressions a plain health check would miss.
let sessionOk = false;
if (ok) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: process.cwd() }),
    });
    const json = (await res.json()) as { session?: { id?: string } };
    sessionOk = typeof json.session?.id === 'string';
  } catch {
    sessionOk = false;
  }
}

child.kill('SIGTERM');
if (!ok || !sessionOk) {
  console.error(`sidecar smoke failed (health=${ok} session=${sessionOk})\n${stderr}`);
  process.exit(1);
}
console.log('sidecar smoke OK (health + session)');
