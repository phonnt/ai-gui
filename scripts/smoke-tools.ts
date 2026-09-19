#!/usr/bin/env bun
// Spawns a compiled sidecar and probes the HTTP tool surface (session →
// write → read → edit → bash). This is the full-parity gate: it proves the
// core tools work on the host OS without needing the GUI.
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export interface ToolResult {
  tool: string;
  ok: boolean;
  detail: string;
}

const PROBE_FILE = 'ai-gui-smoke-tools.tmp.txt';
const PROBE_CONTENT = 'hello windows\n';

async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Exercises the tool surface against a running sidecar and reports per-tool
 * outcome. Every step is independent: one failing tool does not stop the rest.
 */
export async function runToolProbe(
  baseUrl: string,
): Promise<{ ok: boolean; results: ToolResult[] }> {
  const results: ToolResult[] = [];
  const pass = (tool: string, detail = 'ok') => results.push({ tool, ok: true, detail });
  const fail = (tool: string, detail: string) => results.push({ tool, ok: false, detail });

  const cwd = tmpdir();
  let sessionId: string | undefined;
  try {
    const created = await post(baseUrl, '/api/sessions', { cwd });
    const json = (await created.json()) as { session?: { id?: string } };
    sessionId = json.session?.id;
    if (!created.ok || !sessionId) {
      fail('session', `status ${created.status}`);
      return { ok: false, results };
    }
    pass('session', sessionId);
  } catch (e) {
    fail('session', e instanceof Error ? e.message : String(e));
    return { ok: false, results };
  }

  let tag: string | undefined;
  try {
    const res = await post(baseUrl, `/api/sessions/${sessionId}/files`, {
      path: PROBE_FILE,
      content: PROBE_CONTENT,
    });
    const json = (await res.json()) as { tag?: string };
    tag = json.tag;
    res.ok && tag ? pass('write', `tag ${tag}`) : fail('write', `status ${res.status}`);
  } catch (e) {
    fail('write', e instanceof Error ? e.message : String(e));
  }

  try {
    const res = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/files?path=${encodeURIComponent(PROBE_FILE)}`,
    );
    const json = (await res.json()) as { file?: { text?: string } };
    res.ok && json.file?.text?.includes('hello')
      ? pass('read')
      : fail('read', `status ${res.status}`);
  } catch (e) {
    fail('read', e instanceof Error ? e.message : String(e));
  }

  try {
    const res = await post(baseUrl, `/api/sessions/${sessionId}/edit`, {
      path: PROBE_FILE,
      tag,
      // hashline grammar (`PUT N.=M:` + inserted lines); edit.mode is pinned
      // to hashline by the adapter. Replaces line 1 with identical content.
      input: `PUT 1.=1:\n+${PROBE_CONTENT.trimEnd()}`,
    });
    const json = (await res.json()) as { applied?: boolean };
    res.ok && json.applied === true
      ? pass('edit')
      : fail('edit', `status ${res.status} applied=${json.applied}`);
  } catch (e) {
    fail('edit', e instanceof Error ? e.message : String(e));
  }

  try {
    const res = await post(baseUrl, `/api/sessions/${sessionId}/bash`, { command: 'echo ok' });
    const json = (await res.json()) as { output?: string; exitCode?: number };
    res.ok && json.output?.includes('ok')
      ? pass('bash', `exit ${json.exitCode}`)
      : fail('bash', `status ${res.status}`);
  } catch (e) {
    fail('bash', e instanceof Error ? e.message : String(e));
  }

  await unlink(join(cwd, PROBE_FILE)).catch(() => {});
  return { ok: results.every((r) => r.ok), results };
}

async function waitForHealth(base: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(200);
  }
  return false;
}

async function main(): Promise<void> {
  const binary = process.argv[2];
  if (!binary) {
    console.error('usage: bun scripts/smoke-tools.ts <sidecar-binary>');
    process.exit(2);
  }
  const binPath = resolve(binary);
  // ponytail: fixed probe port; move to a free-port lookup if CI ever runs
  // two probes concurrently.
  const port = 8909;
  const child = spawn(binPath, {
    cwd: dirname(binPath),
    env: { ...process.env, AI_GUI_PORT: String(port) },
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  if (!(await waitForHealth(base, 20_000))) {
    console.error(`sidecar not ready\n${stderr}`);
    child.kill();
    process.exit(1);
  }

  const { ok, results } = await runToolProbe(base);
  child.kill();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.tool}: ${r.detail}`);
  if (!ok) {
    console.error(stderr);
    process.exit(1);
  }
  console.log('tool probe OK');
}

if (import.meta.main) await main();
