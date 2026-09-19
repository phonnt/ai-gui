#!/usr/bin/env bun
// Boots the server from source and exercises the route surface, so a change
// that only breaks at runtime (a missing module, an unwired route, a contract
// mismatch) fails the gate instead of the first user request.
//
// `bun run check` runs typecheck/lint/test, none of which import the server
// entry: a bad runtime import once passed the gate and crashed on startup.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = '8908';
const BASE = `http://127.0.0.1:${PORT}`;
// Isolated agent dir: the smoke run must not read or write real sessions,
// settings or credentials.
const AGENT_DIR = mkdtempSync(join(tmpdir(), 'ai-gui-smoke-agent-'));
const WORK_DIR = mkdtempSync(join(tmpdir(), 'ai-gui-smoke-cwd-'));

const failures: string[] = [];
const child = spawn('bun', ['run', 'apps/server/src/index.ts'], {
  env: { ...process.env, AI_GUI_PORT: PORT, PI_CODING_AGENT_DIR: AGENT_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});
child.stderr.on('data', (chunk: Buffer) => {
  serverLog += chunk.toString();
});

/** GET/POST a JSON route and report a non-2xx or unparsable body. */
async function hit(
  label: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}${path}`, init);
    const text = await res.text();
    if (!res.ok) {
      failures.push(`${label} → HTTP ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    failures.push(`${label} → ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function expectArray(label: string, body: Record<string, unknown> | null, key: string): void {
  if (!body) return;
  const value = body[key];
  if (!Array.isArray(value)) {
    failures.push(`${label} → expected \`${key}\` to be an array, got ${typeof value}`);
  }
}

function expectObject(label: string, body: Record<string, unknown> | null, key: string): void {
  if (!body) return;
  const value = body[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(`${label} → expected \`${key}\` to be an object, got ${typeof value}`);
  }
}

// Readiness: the process must answer /api/health before we probe anything.
const deadline = Date.now() + 30_000;
let up = false;
while (Date.now() < deadline) {
  if (child.exitCode !== null) break;
  try {
    const res = await fetch(`${BASE}/api/health`);
    const json = (await res.json()) as { ok?: boolean };
    if (res.ok && json.ok === true) {
      up = true;
      break;
    }
  } catch {
    /* not listening yet */
  }
  await Bun.sleep(150);
}

if (up) {
  // Global read-only surfaces (no provider calls, no state mutation).
  expectArray('GET /api/settings', await hit('GET /api/settings', '/api/settings'), 'entries');
  expectArray('GET /api/sessions', await hit('GET /api/sessions', '/api/sessions'), 'sessions');
  expectArray('GET /api/models', await hit('GET /api/models', '/api/models'), 'models');
  expectArray(
    'GET /api/model-roles',
    await hit('GET /api/model-roles', '/api/model-roles'),
    'roles',
  );
  expectArray('GET /api/plugins', await hit('GET /api/plugins', '/api/plugins'), 'plugins');
  expectArray(
    'GET /api/extensions',
    await hit('GET /api/extensions', '/api/extensions'),
    'extensions',
  );
  expectArray('GET /api/themes', await hit('GET /api/themes', '/api/themes'), 'themes');

  // Session-scoped surfaces: creating one in the temp cwd exercises the
  // adapter's session construction (the SDK runtime load) plus every read
  // path the UI opens on mount.
  const created = await hit('POST /api/sessions', '/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd: WORK_DIR }),
  });
  const sessionId =
    created && typeof created.session === 'object' && created.session !== null
      ? (created.session as { id?: unknown }).id
      : undefined;
  if (typeof sessionId !== 'string' || !sessionId) {
    failures.push(
      `POST /api/sessions → no session id in ${JSON.stringify(created)?.slice(0, 200)}`,
    );
  } else {
    const scoped = [
      ['workspace', 'workspace'],
      ['tools', 'tools'],
      ['skills', 'skills'],
      ['jobs', 'jobs'],
      ['plan', 'planFilePath'],
      ['messages', 'messages'],
    ] as const;
    for (const [path, key] of scoped) {
      const label = `GET /api/sessions/:id/${path}`;
      const body = await hit(label, `/api/sessions/${sessionId}/${path}`);
      if (key === 'workspace') {
        // /workspace answers the workspace itself, not an envelope.
        if (body && typeof body.cwd !== 'string') {
          failures.push(
            `${label} → expected a cwd string, got ${JSON.stringify(body)?.slice(0, 120)}`,
          );
        }
      } else if (key === 'planFilePath') {
        if (body && typeof body[key] !== 'string') {
          failures.push(`${label} → expected \`${key}\` to be a string`);
        }
      } else expectArray(label, body, key);
    }
    // Modes and stats answer with objects; memory reports its backend.
    const modes = await hit('GET /api/sessions/:id/modes', `/api/sessions/${sessionId}/modes`);
    expectObject('GET /api/sessions/:id/modes', modes, 'modes');
    const stats = await hit('GET /api/sessions/:id/stats', `/api/sessions/${sessionId}/stats`);
    expectObject('GET /api/sessions/:id/stats', stats, 'tokens');
    const memory = await hit('GET /api/sessions/:id/memory', `/api/sessions/${sessionId}/memory`);
    if (memory && typeof memory.backend !== 'string') {
      failures.push('GET /api/sessions/:id/memory → expected a backend id');
    }

    await hit('DELETE /api/sessions/:id', `/api/sessions/${sessionId}`, { method: 'DELETE' });
  }
} else if (child.exitCode === null) {
  failures.push('server never answered /api/health within 30s');
} else {
  failures.push(`server exited early with code ${child.exitCode}`);
}

child.kill('SIGTERM');
rmSync(AGENT_DIR, { recursive: true, force: true });
rmSync(WORK_DIR, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`server smoke failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  if (serverLog.trim()) console.error(`server output:\n${serverLog}`);
  process.exit(1);
}
console.log('server smoke OK (health + global routes + session routes)');
