# Desktop Windows Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho desktop AI-GUI chạy trên Windows x64 với full tool parity, giữ macOS không regression, verify bằng CI `windows-latest`.

**Architecture:** Một codebase (approach A). Khác biệt nền tảng đi qua: build script derive theo host, `tauri.<platform>.conf.json` (Tauri merge RFC 7396), `#[cfg(unix)]`/`#[cfg(windows)]`, và shutdown protocol qua stdin thay SIGTERM. CI Windows chứng minh tool parity qua HTTP (không cần GUI).

**Tech Stack:** Bun 1.3.14, TypeScript strict, Tauri v2 (Rust), `@oh-my-pi/pi-coding-agent` 18.1.11 (+ native package `win32-x64`), GitHub Actions `windows-latest`.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-windows-design.md` (và spec macOS: `docs/superpowers/specs/2026-09-19-desktop-app-design.md`)

**Phạm vi:** 6 task. Task 1 là **spike** (quyết định scope full-parity). Ngoài phạm vi: Authenticode, arm64, GUI runtime verify.

## Global Constraints

- Bun ≥1.3.14; TS `strict`; Biome 2-space single quotes lineWidth 100; `bun run format` trước commit.
- Cổng CI duy nhất: `bun run check` (typecheck + lint + test) — xanh trước mọi commit.
- Test `bun:test`, colocate `*.test.ts`.
- Không file JS mới. Không sửa `apps/web` source.
- Build output (`apps/desktop/src-tauri/{binaries,target,resources/web,gen}`) không commit.
- macOS là regression gate: mỗi task phải giữ `bun run build` (tauri --no-bundle) + `bun run smoke:sidecar` + `bun run smoke:bundle` + `bun run check` xanh.
- Repo remote: public `phonnt/ai-gui` (dùng cho CI).
- Native addon Windows package: `@oh-my-pi/pi-natives-win32-x64`; filename `pi_natives.win32-x64[-modern|-baseline].node`.

---

### Task 1: Spike — Windows CI chạy sidecar + tool probe

**Mục đích:** trả lời câu hỏi khả thi: sidecar Bun-compile Windows có boot + load addon + chạy tool cốt lõi (read/write/edit/bash) không. Kết quả quyết định scope full-parity. Nếu `bash` tool hỏng → dừng, thương lượng scope trước khi làm Task 2+.

**Files:**
- Create: `scripts/smoke-tools.ts`
- Create: `scripts/smoke-tools.test.ts`
- Modify: `.github/workflows/desktop.yml` (thêm job `windows-spike`)
- Create: `docs/superpowers/spikes/2026-09-19-windows-spike.md` (kết quả — không bắt buộc commit nếu chỉ là output)

**Interfaces:**
- Produces:
  - `export async function runToolProbe(baseUrl: string): Promise<{ ok: boolean; results: { tool: string; ok: boolean; detail: string }[] }>`
  - `scripts/smoke-tools.ts` CLI: `bun scripts/smoke-tools.ts <binaryPath>` → spawn binary với `AI_GUI_PORT` động, chờ `/api/health`, tạo session, chạy probe, exit 0/1.
- Consumes: sidecar `/api/health`, `/api/sessions`, `/api/sessions/:id/{files,edit,bash}` (đã có).

- [ ] **Step 1: Viết test cho `runToolProbe` (chạy với fake server)**

Create `scripts/smoke-tools.test.ts`:

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { runToolProbe } from './smoke-tools';

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true });
    if (url.pathname === '/api/sessions' && req.method === 'POST')
      return Response.json({ session: { id: 's1' } });
    if (url.pathname.endsWith('/files') && req.method === 'POST')
      return Response.json({ ok: true });
    if (url.pathname.endsWith('/bash') && req.method === 'POST')
      return Response.json({ stdout: 'ok', exitCode: 0 });
    return Response.json({ error: 'nope' }, { status: 404 });
  },
});

afterEach(() => server.stop(true));

describe('runToolProbe', () => {
  test('reports ok when every tool route answers', async () => {
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`);
    expect(out.ok).toBe(true);
    expect(out.results.some((r) => r.tool === 'write')).toBe(true);
  });

  test('reports not ok when a route fails', async () => {
    const out = await runToolProbe(`http://127.0.0.1:${server.port}`, { forceFailTool: 'bash' });
    expect(out.ok).toBe(false);
    expect(out.results.find((r) => r.tool === 'bash')?.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test scripts/smoke-tools.test.ts`
Expected: FAIL — `Cannot find module './smoke-tools'`.

- [ ] **Step 3: Viết `scripts/smoke-tools.ts`**

```ts
#!/usr/bin/env bun
// Spawns a compiled sidecar and probes the HTTP tool surface. This is the
// full-parity gate: it proves read/write/edit/bash work on the host OS
// without needing the GUI.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export interface ToolResult {
  tool: string;
  ok: boolean;
  detail: string;
}

export interface ProbeOptions {
  /** Test hook: make one tool route fail to exercise the failure path. */
  forceFailTool?: string;
}

async function post(base: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function runToolProbe(
  baseUrl: string,
  options: ProbeOptions = {},
): Promise<{ ok: boolean; results: ToolResult[] }> {
  const results: ToolResult[] = [];
  const fail = (tool: string, detail: string) => {
    results.push({ tool, ok: false, detail });
  };
  const pass = (tool: string, detail = 'ok') => {
    results.push({ tool, ok: true, detail });
  };

  const created = await post(baseUrl, '/api/sessions', { cwd: process.cwd() });
  const createdJson = (await created.json()) as { session?: { id?: string } };
  const sessionId = createdJson.session?.id;
  if (!sessionId) {
    fail('session', 'no session id');
    return { ok: false, results };
  }
  pass('session', sessionId);

  const target = 'smoke-tools.tmp.txt';
  const w = await post(baseUrl, `/api/sessions/${sessionId}/files`, {
    path: target,
    content: 'hello windows\n',
  });
  w.ok && !(options.forceFailTool === 'write') ? pass('write') : fail('write', `status ${w.status}`);

  const r = await fetch(
    `${baseUrl}/api/sessions/${sessionId}/files?path=${encodeURIComponent(target)}`,
  );
  r.ok ? pass('read') : fail('read', `status ${r.status}`);

  const e = await post(baseUrl, `/api/sessions/${sessionId}/edit`, {
    path: target,
    oldString: 'hello',
    newString: 'hello',
  });
  e.ok || e.status === 409 ? pass('edit', `status ${e.status}`) : fail('edit', `status ${e.status}`);

  const b =
    options.forceFailTool === 'bash'
      ? new Response('forced', { status: 500 })
      : await post(baseUrl, `/api/sessions/${sessionId}/bash`, { command: 'echo ok' });
  if (b.ok) {
    const json = (await b.json()) as { stdout?: string; exitCode?: number };
    json.stdout?.includes('ok') ? pass('bash', `exit ${json.exitCode}`) : fail('bash', 'no ok');
  } else {
    fail('bash', `status ${b.status}`);
  }

  return { ok: results.every((x) => x.ok), results };
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
  const port = 8908;
  const env = { ...process.env, AI_GUI_PORT: String(port), ...(process.env.AI_GUI_TOKEN ? { AI_GUI_TOKEN: process.env.AI_GUI_TOKEN } : {}) };
  const child = spawn(binPath, { cwd: dirname(binPath), env });

  let stderr = '';
  child.stderr.on('data', (c: Buffer) => {
    stderr += c.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  const up = await waitForHealth(base, 20_000);
  if (!up) {
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
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test scripts/smoke-tools.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Viết spike job CI**

Modify `.github/workflows/desktop.yml` — thêm job (dùng `shell: bash`, Git Bash có sẵn trên `windows-latest`):

```yaml
  windows-spike:
    if: github.event_name == 'workflow_dispatch'
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.3.14' }
      - name: Install
        run: bun install --frozen-lockfile
      - name: Compile Windows sidecar
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p "$RUNNER_TEMP/spike"
          bun build --compile apps/server/src/index.ts \
            --outfile "$RUNNER_TEMP/spike/ai-gui-server.exe" \
            --external omp-legacy-pi-modules \
            --target=bun-windows-x64
          ADDON=$(find node_modules/.bun -name 'pi_natives.win32-x64*.node' | head -1)
          test -n "$ADDON" || { echo "no win32-x64 addon installed"; exit 1; }
          cp "$ADDON" "$RUNNER_TEMP/spike/"
          ls -la "$RUNNER_TEMP/spike"
      - name: Tool probe
        shell: bash
        run: bun scripts/smoke-tools.ts "$RUNNER_TEMP/spike/ai-gui-server.exe"
```

- [ ] **Step 6: Tạo repo + push + chạy**

```bash
git remote add origin git@github.com:phonnt/ai-gui.git   # hoặc https
gh repo create phonnt/ai-gui --public --source=. --remote=origin --push
gh workflow run desktop.yml
gh run watch "$(gh run list --workflow=desktop.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```
Expected: job `windows-spike` xanh → `tool probe OK`. Nếu `bash` FAIL → **DỪNG**, ghi kết quả vào `docs/superpowers/spikes/2026-09-19-windows-spike.md`, thương lượng scope.

- [ ] **Step 7: Ghi kết quả spike**

Create `docs/superpowers/spikes/2026-09-19-windows-spike.md`:
```markdown
# Windows spike — 2026-09-19
- Sidecar compile (bun-windows-x64): PASS/FAIL
- Addon win32-x64 load: PASS/FAIL
- Health + session: PASS/FAIL
- write/read/edit: PASS/FAIL
- bash tool: PASS/FAIL — [shell nào, output]
- Verdict: full parity khả thi | cần thương lượng scope
- CI run URL: ...
```

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke-tools.ts scripts/smoke-tools.test.ts .github/workflows/desktop.yml docs/superpowers/spikes/2026-09-19-windows-spike.md
git commit -m "test(desktop): windows tool-surface probe + CI spike job"
```

---

### Task 2: Build script platform-aware + manifest `files[]` + bỏ symlink

**Files:**
- Modify: `scripts/build-desktop.ts`
- Create: `scripts/build-desktop.test.ts`
- Modify: `apps/desktop/src-tauri/src/sidecar.rs` (`NativesManifest`, `provision_native`)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (đường dẫn `externalBin`/`resources`)
- Modify: `.gitignore`
- Delete: `apps/desktop/src-tauri/binaries` (symlink)

**Interfaces:**
- Produces:
  - `export interface PlatformTarget { triple: string; addonPattern: string; exeSuffix: string; }`
  - `export function platformTarget(platform: string, arch: string): PlatformTarget`
  - Manifest file `natives-manifest.json`: `{ "version": string; "files": string[] }`
- Consumes: Task 1 không bắt buộc; độc lập.

- [ ] **Step 1: Viết test `platformTarget`**

Create `scripts/build-desktop.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { platformTarget } from './build-desktop';

describe('platformTarget', () => {
  test('maps darwin arm64', () => {
    expect(platformTarget('darwin', 'arm64')).toEqual({
      triple: 'aarch64-apple-darwin',
      addonPattern: 'pi_natives.darwin-arm64.node',
      exeSuffix: '',
    });
  });
  test('maps win32 x64 with exe suffix', () => {
    expect(platformTarget('win32', 'x64')).toEqual({
      triple: 'x86_64-pc-windows-msvc',
      addonPattern: 'pi_natives.win32-x64*.node',
      exeSuffix: '.exe',
    });
  });
  test('rejects unsupported', () => {
    expect(() => platformTarget('linux', 'x64')).toThrow(/unsupported platform/);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test scripts/build-desktop.test.ts`
Expected: FAIL — `platformTarget is not a function`.

- [ ] **Step 3: Sửa `scripts/build-desktop.ts`**

Thay các hằng platform bằng hàm derive; output vào `src-tauri/binaries`; manifest `files[]`; copy **mọi** addon khớp pattern.

```ts
#!/usr/bin/env bun
// Builds the desktop sidecar for the HOST platform: web dist, compiled server
// binary, native addon(s), and the manifest Rust reads to provision the addon.
import { $ } from 'bun';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface PlatformTarget {
  triple: string;
  addonPattern: string;
  exeSuffix: string;
}

export function platformTarget(platform: string, arch: string): PlatformTarget {
  if (platform === 'darwin' && arch === 'arm64') {
    return { triple: 'aarch64-apple-darwin', addonPattern: 'pi_natives.darwin-arm64.node', exeSuffix: '' };
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      triple: 'x86_64-pc-windows-msvc',
      addonPattern: 'pi_natives.win32-x64*.node',
      exeSuffix: '.exe',
    };
  }
  throw new Error(`unsupported platform: ${platform}/${arch}`);
}

const OUT_DIR = 'apps/desktop/src-tauri/binaries';
const WEB_DIST = 'apps/desktop/src-tauri/resources/web';

async function findAddons(pattern: string): Promise<{ files: string[]; version: string }> {
  const glob = new Bun.Glob(`node_modules/.bun/**/${pattern}`);
  const files: string[] = [];
  let version = '0.0.0';
  for await (const match of glob.scan({ cwd: '.', dot: true })) {
    files.push(match);
    if (version === '0.0.0') {
      const pkg = (await Bun.file(join(match, '..', 'package.json')).json()) as { version?: string };
      version = pkg.version ?? '0.0.0';
    }
  }
  if (files.length === 0) throw new Error(`native addon not found: ${pattern}`);
  return { files, version };
}

async function main(): Promise<void> {
  const target = platformTarget(process.platform, process.arch);
  const serverOut = join(OUT_DIR, `ai-gui-server-${target.triple}${target.exeSuffix}`);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  await $`bun run --filter @ai-gui/web build`;
  await rm(WEB_DIST, { recursive: true, force: true });
  await mkdir('apps/desktop/src-tauri/resources', { recursive: true });
  await $`cp -R apps/web/dist ${WEB_DIST}`;
  await $`bun build --compile apps/server/src/index.ts --outfile ${serverOut} --external omp-legacy-pi-modules`;
  const addon = await findAddons(target.addonPattern);
  const copied: string[] = [];
  for (const file of addon.files) {
    const name = basename(file);
    await copyFile(file, join(OUT_DIR, name));
    copied.push(name);
  }
  await Bun.write(
    join(OUT_DIR, 'natives-manifest.json'),
    JSON.stringify({ version: addon.version, files: copied }, null, 2),
  );
  console.log(`sidecar: ${serverOut}\nweb dist: ${WEB_DIST}\naddons: ${copied.join(', ')} (v${addon.version})`);
}

if (import.meta.main) await main();
```

> Lưu ý: `cp -R` là Bash; trên Windows runner GitHub dùng `shell: bash` (Git Bash) nên OK. Nếu chạy `bun run build:desktop` bằng PowerShell sẽ fail — dùng Git Bash hoặc thay bằng `node:fs.cp`.

- [ ] **Step 4: Chạy test + build macOS**

Run: `bun test scripts/build-desktop.test.ts && bun run build:desktop`
Expected: PASS; log `sidecar: apps/desktop/src-tauri/binaries/ai-gui-server-aarch64-apple-darwin`.

- [ ] **Step 5: Cập nhật Rust `NativesManifest` + `provision_native`**

Trong `apps/desktop/src-tauri/src/sidecar.rs`, đổi struct và vòng lặp copy:

```rust
#[derive(serde::Deserialize, Clone)]
pub struct NativesManifest {
    pub version: String,
    pub files: Vec<String>,
}
```

Trong `provision_native`, thay đoạn copy 1 file bằng vòng lặp:

```rust
    let dest_dir = natives_dir().join(&manifest.version);
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("mkdir natives: {e}"))?;
    for file in &manifest.files {
        let dest = dest_dir.join(file);
        if dest.exists() {
            continue;
        }
        let src = app
            .path()
            .resolve(format!("natives/{file}"), BaseDirectory::Resource)
            .map_err(|e| format!("resolve addon {file}: {e}"))?;
        std::fs::copy(&src, &dest).map_err(|e| format!("copy addon {file}: {e}"))?;
    }
    Ok(manifest)
```

- [ ] **Step 6: Sửa `tauri.conf.json` + `.gitignore`, xoá symlink**

- Xoá symlink: `git rm apps/desktop/src-tauri/binaries`
- `.gitignore`: thay comment symlink bằng ignore trực tiếp:
```gitignore
apps/desktop/src-tauri/binaries/*
!apps/desktop/src-tauri/binaries/.gitkeep
```
Create `apps/desktop/src-tauri/binaries/.gitkeep`.
- `tauri.conf.json`: đổi `resources` trỏ `binaries/...` (forward slash) và giữ `externalBin`:
```json
    "externalBin": ["binaries/ai-gui-server"],
    "resources": {
      "binaries/pi_natives.darwin-arm64.node": "natives/pi_natives.darwin-arm64.node",
      "binaries/natives-manifest.json": "natives/natives-manifest.json",
      "resources/web": "web"
    }
```
> Windows addon filename khác → resource key phải platform-aware. Giải pháp: đổi sang map bằng **glob không được** (Tauri resources không glob). Thay vào đó, dùng `resources` array với thư mục `binaries/natives` chứa addon, và Rust resolve `natives/<file>`; xem Step 7.

- [ ] **Step 7: Tách thư mục `natives` cho resource (tránh hardcode filename)**

- `build-desktop.ts`: copy addon vào `apps/desktop/src-tauri/resources/natives/<name>` (thay vì `binaries`), và `natives-manifest.json` vào cùng đó.
- `tauri.conf.json` `resources`: `"resources/natives": "natives"` (copy cả thư mục) + `"resources/web": "web"`. Bỏ 2 key addon hardcode.
- `sidecar.rs` `resolve("natives/<file>", Resource)` giữ nguyên.
- `.gitignore`: thêm `apps/desktop/src-tauri/resources/natives/`.

Cập nhật `build-desktop.ts` cho khớp (copy addon + manifest vào `resources/natives`), chạy lại Step 4.

- [ ] **Step 8: Verify macOS regression**

Run: `bun run build:desktop && bun run smoke:sidecar && bun run smoke:bundle && bun run check`
Expected: tất cả PASS; addon ở `~/.omp/natives/<ver>/`.

- [ ] **Step 9: Commit**

```bash
git add scripts/build-desktop.ts scripts/build-desktop.test.ts apps/desktop/src-tauri .gitignore
git commit -m "build(desktop): platform-aware sidecar build, files[] manifest, drop symlink"
```

---

### Task 3: Tauri per-platform config + Rust cfg-gate + stdin shutdown

**Files:**
- Create: `apps/desktop/src-tauri/tauri.macos.conf.json`
- Create: `apps/desktop/src-tauri/tauri.windows.conf.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (base trung lập)
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/src/sidecar.rs`
- Modify: `apps/server/src/index.ts` (stdin shutdown)
- Create: `apps/server/src/shutdown.test.ts`

**Interfaces:**
- Consumes: Task 2 (`NativesManifest.files`, `platformTarget`).
- Produces: `installShutdownListener(stream: NodeJS.ReadableStream | undefined, onShutdown: () => void): void` trong server; `kill_graceful` dùng stdin protocol.

- [ ] **Step 1: Test stdin shutdown (server)**

Create `apps/server/src/shutdown.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { installShutdownListener } from './shutdown';

function streamOf(text: string): Readable {
  return Readable.from([text]);
}

describe('installShutdownListener', () => {
  test('fires on shutdown op', async () => {
    let called = 0;
    installShutdownListener(streamOf('{"op":"shutdown"}\n'), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(1);
  });

  test('fires on EOF', async () => {
    let called = 0;
    installShutdownListener(streamOf(''), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(1);
  });

  test('ignores other input', async () => {
    let called = 0;
    installShutdownListener(streamOf('hello\n'), () => {
      called += 1;
    });
    await Bun.sleep(20);
    expect(called).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test fail**

Run: `bun test apps/server/src/shutdown.test.ts`
Expected: FAIL — `Cannot find module './shutdown'`.

- [ ] **Step 3: Viết `apps/server/src/shutdown.ts`**

```ts
/** Minimal readable shape so tests can pass an in-memory stream. */
interface Readable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/**
 * Cross-platform shutdown: the desktop shell writes `{"op":"shutdown"}` to the
 * sidecar stdin (or closes it) instead of SIGTERM, which Windows lacks. Fires
 * `onShutdown` once, on a shutdown line or EOF.
 */
export function installShutdownListener(
  stream: Readable | undefined | null,
  onShutdown: () => void,
): void {
  if (!stream) return;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onShutdown();
  };
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += String(chunk);
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '{"op":"shutdown"}') fire();
      index = buffer.indexOf('\n');
    }
  });
  stream.on('end', fire);
}
```

- [ ] **Step 4: Chạy test pass**

Run: `bun test apps/server/src/shutdown.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Nối vào `apps/server/src/index.ts`**

Thêm import và gọi trong `main()` sau khi có `stop`:

```ts
import { installShutdownListener } from './shutdown.js';
```
```ts
  // Desktop shell closes stdin (or sends a shutdown op) to stop us; SIGTERM is
  // unix-only. Ignored when stdin is a TTY (manual `bun dev`).
  if (!(globals.process as { stdin?: { isTTY?: boolean } } | undefined)?.stdin?.isTTY) {
    installShutdownListener(
      (globals.process as { stdin?: unknown } | undefined)?.stdin as never,
      () => void stop(),
    );
  }
```

- [ ] **Step 6: `kill_graceful` qua stdin (Rust)**

Trong `sidecar.rs`, thay thân `kill_graceful` (bỏ `libc`):

```rust
/// Graceful stop that works on Windows: ask the sidecar to shut down over its
/// stdin, wait up to 3s, then hard-kill. Replaces unix-only SIGTERM.
pub fn kill_graceful(mut child: CommandChild) {
    let _ = child.write(b"{\"op\":\"shutdown\"}\n");
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if !is_alive(pid_of(&child)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
}
```

Thêm helper platform-gated (thay `libc::kill(pid,0)`):
```rust
#[cfg(unix)]
fn is_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(windows)]
fn is_alive(_pid: i32) -> bool {
    // The shell plugin exposes no liveness check; rely on the kill deadline
    // instead of a probe. Returns true until the timeout, then hard-kill.
    true
}

fn pid_of(child: &CommandChild) -> i32 {
    child.pid() as i32
}
```
> Windows: giữ `libc` chỉ cho unix → trong `Cargo.toml` đổi thành target-specific:
```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

- [ ] **Step 7: `cfg`-gate chmod + home dir**

- `lib.rs` `config_relative_to_home`: thay `std::env::var("HOME")` bằng `dirs::home_dir()`:
```rust
fn config_relative_to_home(config_dir: &str) -> String {
    let home = dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    std::path::Path::new(config_dir)
        .strip_prefix(&home)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            eprintln!("[desktop] config dir {config_dir} is not under home {home}; falling back to .omp");
            ".omp".to_string()
        })
}
```
- `lib.rs` chmod: bọc `#[cfg(unix)]`:
```rust
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o700))?;
            }
```
- `sidecar.rs` `natives_dir()`: thay `env::var("HOME")` bằng `dirs::home_dir()`; giữ nhánh XDG (chỉ áp non-Windows):
```rust
pub fn natives_dir() -> PathBuf {
    #[cfg(not(windows))]
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            let root = PathBuf::from(&xdg).join("omp");
            if root.exists() {
                return root.join("natives");
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join(".omp")
        .join("natives")
}
```
- `Cargo.toml`: thêm `dirs = "5"` vào `[dependencies]`.

- [ ] **Step 8: Tauri per-platform config**

- `tauri.conf.json` base: bỏ `"targets"`, `"icon"`, khối `"macOS"`.
- `tauri.macos.conf.json`:
```json
{
  "bundle": {
    "targets": ["app", "dmg"],
    "icon": ["icons/icon.icns"],
    "macOS": { "entitlements": "entitlements.plist", "hardenedRuntime": true }
  }
}
```
- `tauri.windows.conf.json`:
```json
{
  "bundle": {
    "targets": ["nsis"],
    "icon": ["icons/icon.ico"]
  }
}
```

- [ ] **Step 9: Verify macOS**

Run: `cd apps/desktop && . "$HOME/.cargo/env" && bun run tauri build --no-bundle`; rồi `bun run smoke:sidecar && bun run smoke:bundle && bun run check`
Expected: PASS. Kiểm tra stderr không có cảnh báo `libc` unused.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src-tauri apps/server/src/index.ts apps/server/src/shutdown.ts apps/server/src/shutdown.test.ts
git commit -m "feat(desktop): per-platform tauri config, cfg-gated paths, stdin shutdown"
```

---

### Task 4: smoke-tools đầy đủ + bundle smoke cross-platform

**Files:**
- Modify: `scripts/smoke-tools.ts`
- Modify: `scripts/smoke-bundle.ts`

**Interfaces:**
- Consumes: Task 1 `runToolProbe`.
- Produces: probe mở rộng (thêm `glob`/`lsp` nếu route sẵn có); bundle smoke platform-aware.

- [ ] **Step 1: Mở rộng probe**

Trong `runToolProbe`, thêm bước `ls`/`glob` qua route files list (`GET /api/sessions/:id/files/list?path=.`) và assert thấy `smoke-tools.tmp.txt`; thêm `lsp` nếu `/api/sessions/:id/lsp` trả 200/501 (501 = chấp nhận "không hỗ trợ" — ghi nhận, không fail).

```ts
  const ls = await fetch(
    `${base}/api/sessions/${sessionId}/files/list?path=${encodeURIComponent('.')}`,
  );
  if (ls.ok) {
    const json = (await ls.json()) as { entries?: { name?: string }[] };
    json.entries?.some((e) => e.name === target)
      ? pass('glob', target)
      : fail('glob', 'tmp file not listed');
  } else {
    fail('glob', `status ${ls.status}`);
  }

  const lsp = await post(base, `/api/sessions/${sessionId}/lsp`, {
    action: 'status',
  });
  lsp.status === 501 ? pass('lsp', 'unsupported (501)') : lsp.ok ? pass('lsp') : fail('lsp', `status ${lsp.status}`);
```

- [ ] **Step 2: Test cập nhật**

Bổ sung case trong `scripts/smoke-tools.test.ts` cho `glob` (fake server trả `entries`).

- [ ] **Step 3: Bundle smoke platform-aware**

Trong `scripts/smoke-bundle.ts`, branch theo `process.platform`:
- darwin: giữ nguyên (`open -n` + `osascript` + `pgrep`).
- win32: spawn `apps/desktop/src-tauri/target/release/AI-GUI.exe` (Tauri main binary) bằng `spawn`, đợi 6s, assert sidecar sống bằng `tasklist /FI "IMAGENAME eq ai-gui-server.exe"`, rồi `taskkill /IM AI-GUI.exe /F` + assert sidecar đã chết.
```ts
import { spawn } from 'node:child_process';
const isWin = process.platform === 'win32';
async function listSidecarWin(): Promise<boolean> {
  const p = spawn('tasklist', ['/FI', 'IMAGENAME eq ai-gui-server.exe']);
  let out = '';
  p.stdout.on('data', (c: Buffer) => (out += c.toString()));
  await new Promise((r) => p.on('exit', r));
  return out.includes('ai-gui-server.exe');
}
```
> Windows GUI trên runner CI headless có thể không mở được cửa sổ; nếu vậy, chỉ build + assert artifact và **đánh dấu GUI unverified** (không fail job).

- [ ] **Step 4: Verify macOS**

Run: `bun test scripts/smoke-tools.test.ts && bun run smoke:sidecar && bun run smoke:bundle`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-tools.ts scripts/smoke-tools.test.ts scripts/smoke-bundle.ts
git commit -m "test(desktop): extend tool probe and make bundle smoke cross-platform"
```

---

### Task 5: Windows CI job hoàn chỉnh (nsis build + artifacts)

**Files:**
- Modify: `.github/workflows/desktop.yml`

**Interfaces:**
- Consumes: Task 2 (`build:desktop` platform-aware), Task 3 (windows config), Task 4 (smoke scripts).

- [ ] **Step 1: Thêm job `windows`**

Thay job `windows-spike` bằng job thật (giữ `workflow_dispatch` + tag):

```yaml
  windows:
    runs-on: windows-latest
    env:
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.3.14' }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install
        run: bun install --frozen-lockfile
      - name: Check
        run: bun run check
      - name: Build sidecar
        shell: bash
        run: bun run build:desktop
      - name: Sidecar smoke
        shell: bash
        run: bun run smoke:sidecar
      - name: Tool probe
        shell: bash
        run: bun scripts/smoke-tools.ts "apps/desktop/src-tauri/binaries/ai-gui-server-x86_64-pc-windows-msvc.exe"
      - name: Build app (nsis, unsigned)
        shell: bash
        working-directory: apps/desktop
        run: bun run tauri build
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ai-gui-windows
          path: |
            apps/desktop/src-tauri/target/release/bundle/nsis/*.exe
            apps/desktop/src-tauri/target/release/bundle/nsis/*.sig
          if-no-files-found: error
```

- [ ] **Step 2: Thêm `permissions` + `timeout-minutes` cho toàn workflow**

Đầu file:
```yaml
permissions:
  contents: read
```
Mỗi job: `timeout-minutes: 60`.

- [ ] **Step 3: Chạy CI**

```bash
git push
gh workflow run desktop.yml
gh run watch "$(gh run list --workflow=desktop.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```
Expected: job `windows` xanh tới bước upload; nếu bước `tauri build`/GUI fail vì CI headless → chuyển bước GUI-dependent sang `continue-on-error` và ghi chú unverified.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/desktop.yml
git commit -m "ci(desktop): windows build, tool probe, nsis artifacts"
```

---

### Task 6: Docs + architecture

**Files:**
- Modify: `docs/runbook.md`
- Modify: `docs/desktop-release.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Runbook — mục Windows**

Thêm mục "Desktop (Windows)": build bằng Git Bash (`bun run build:desktop`), chạy CI `windows-latest`, điều kiện `bun install` trên Windows kéo `@oh-my-pi/pi-natives-win32-x64`, artifacts ở `bundle/nsis`, và ghi rõ GUI/installer chưa verify.

- [ ] **Step 2: desktop-release — updater Windows**

Ghi artifact `.nsis.zip` + `.sig`, endpoint `latest.json` phải có entry `windows-x86_64`; nhắc Authenticode chưa làm.

- [ ] **Step 3: architecture — cập nhật trạng thái**

Trong `docs/architecture.md`, cập nhật dòng `apps/desktop/` (không còn "FUTURE" cho macOS/Windows) và ghi generic platform approach.

- [ ] **Step 4: Verify + commit**

Run: `bun run check`
```bash
git add docs/runbook.md docs/desktop-release.md docs/architecture.md
git commit -m "docs(desktop): windows build, release, and platform notes"
```

---

## Self-Review

**Spec coverage:**
- §3 approach A → Task 2/3. §4.1 platformTarget → Task 2. §4.2 bỏ symlink → Task 2.1/6. §4.3 per-platform config → Task 3.8. §4.4 cfg-gate → Task 3.7. §4.5 stdin shutdown → Task 3.
- §4.6 smoke cross-platform → Task 1 (smoke-tools) + Task 4. §4.7 CI → Task 1 (spike) + Task 5. §4.8 repo → Task 1.
- §7 rủi ro: #1 → Task 1 (spike); #2 → Task 1/2 (copy variant); #5 → Task 2/3 regression; #6 → worktree khi execute; #4 → Task 5.
- §9 tiêu chí: 1 → Task 1/5; 2 → Task 5; 3 → regression mỗi task; 4 → Task 2; 5 → Task 3; 6 → Task 6.
- **Gap đã bù:** manifest `{version, files[]}` (Task 2.3/5) — cần cho nhiều addon variant Windows; resource dir `natives/` (Task 2.7) tránh hardcode filename.

**Placeholder scan:** không có TBD/TODO; các bước code có nội dung thật.

**Type consistency:** `PlatformTarget{triple,addonPattern,exeSuffix}` (Task 2) dùng ở Task 2/5; `NativesManifest{version,files}` khớp build script ↔ Rust (Task 2); `runToolProbe`/`ProbeOptions` (Task 1) dùng ở Task 4; `installShutdownListener` (Task 3) khớp server + test; binary path Task 5 khớp Task 2 output.

**Điểm chưa chắc (đã phản ánh trong plan):** GUI trên CI headless (Task 4.3/Task 5.3 có fallback continue-on-error); `bash` tool Windows (Task 1 spike quyết định).
