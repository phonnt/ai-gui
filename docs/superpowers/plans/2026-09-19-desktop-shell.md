# Desktop Shell (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng gói AI-GUI thành app desktop Tauri v2 chạy được trên macOS (unsigned), tự start sidecar `bun-compile`, phục vụ UI cùng origin, dừng sạch khi thoát.

**Architecture:** Tauri Rust shell chọn port động, đảm bảo native addon của SDK có mặt, spawn sidecar `ai-gui-server` (Bun runtime nhúng), poll TCP tới khi server ready rồi tạo window trỏ `http://127.0.0.1:<port>`. Server serve static web dist + SPA fallback + token auth, bind `127.0.0.1`.

**Tech Stack:** Bun 1.3.14, TypeScript strict, Biome, Tauri v2 (Rust), `@oh-my-pi/pi-coding-agent` 18.1.11.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-app-design.md`

**Phạm vi plan này:** Phase A (Task 1-6) — app chạy local dạng unsigned. Phase B (code-signing/notarize/dmg/updater/CI) là plan riêng, viết sau khi Phase A xanh, vì cần Apple Developer credentials.

## Global Constraints

- Runtime/PM: **Bun** ≥1.3.14. Không npm/pnpm/yarn, không file JS mới.
- TS `strict`, Biome 2-space single quotes lineWidth 100, chạy `bun run format` trước khi commit.
- Cổng CI duy nhất: `bun run check` (typecheck + lint + test) — không commit khi đỏ.
- Test: `bun:test` (`describe/expect/test`), colocate `*.test.ts` cạnh module.
- Không silent catch ở biên; dùng `HttpError` (`apps/server/src/routes/errors.ts`).
- SDK version hiện tại: `18.1.11`; platform package: `@oh-my-pi/pi-natives-darwin-arm64`; addon filename: `pi_natives.darwin-arm64.node`.
- `bun build --compile` phải kèm `--external omp-legacy-pi-modules`.
- Web layer (`apps/web`) KHÔNG sửa trong plan này.

---

### Task 1: Server phục vụ static web + SPA fallback + bind loopback

**Files:**
- Create: `apps/server/src/static.ts`
- Create: `apps/server/src/static.test.ts`
- Modify: `apps/server/src/index.ts` (import; thêm static block trước dòng `return Response.json({ error: 'not found' }...)`; thêm `hostname` vào `Bun.serve`)

**Interfaces:**
- Produces:
  - `type StaticTarget = { kind: 'asset'; filePath: string } | { kind: 'spa' } | { kind: 'blocked' }`
  - `function classifyStaticPath(distDir: string, urlPath: string): StaticTarget`
  - `function contentTypeFor(filePath: string): string`
  - `function isImmutableAsset(filePath: string): boolean`
- Consumes: `node:path` (`resolve`, `sep`, `extname`, `join`), `node:fs/promises` (`readFile`).

- [ ] **Step 1: Viết test thất bại cho `classifyStaticPath`**

Create `apps/server/src/static.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { classifyStaticPath, contentTypeFor, isImmutableAsset } from './static';

const dist = '/tmp/ai-gui-dist';

describe('classifyStaticPath', () => {
  test('serves hashed assets by extension', () => {
    expect(classifyStaticPath(dist, '/assets/index-abc123.js')).toEqual({
      kind: 'asset',
      filePath: `${dist}/assets/index-abc123.js`,
    });
    expect(classifyStaticPath(dist, '/favicon.ico')).toEqual({
      kind: 'asset',
      filePath: `${dist}/favicon.ico`,
    });
  });

  test('falls back to the SPA for extensionless routes', () => {
    expect(classifyStaticPath(dist, '/')).toEqual({ kind: 'spa' });
    expect(classifyStaticPath(dist, '/s/01a0b7d9')).toEqual({ kind: 'spa' });
  });

  test('blocks traversal and encoded escapes', () => {
    expect(classifyStaticPath(dist, '/../../etc/passwd')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/%2e%2e/%2e%2e/etc/passwd')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/a/../../../x.txt')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/%')).toEqual({ kind: 'blocked' });
  });
});

describe('asset headers', () => {
  test('immutable only for hashed asset dir', () => {
    expect(isImmutableAsset(`${dist}/assets/x-abc.js`)).toBe(true);
    expect(isImmutableAsset(`${dist}/index.html`)).toBe(false);
  });

  test('content types cover the build output', () => {
    expect(contentTypeFor('a.html')).toContain('text/html');
    expect(contentTypeFor('a.js')).toContain('text/javascript');
    expect(contentTypeFor('a.css')).toContain('text/css');
    expect(contentTypeFor('a.woff2')).toBe('font/woff2');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test apps/server/src/static.test.ts`
Expected: FAIL — `Cannot find module './static'`.

- [ ] **Step 3: Viết `apps/server/src/static.ts`**

```ts
import { extname, resolve, sep } from 'node:path';

export type StaticTarget =
  | { kind: 'asset'; filePath: string }
  | { kind: 'spa' }
  | { kind: 'blocked' };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function isImmutableAsset(filePath: string): boolean {
  return resolve(filePath).includes(`${sep}assets${sep}`);
}

/**
 * Resolve a static request against the built web dist. `blocked` means the
 * path escaped the dist root or was not decodable — the caller answers 404 so
 * traversal attempts never reach the filesystem. Extensionless paths fall
 * back to the SPA entry (client-side router routes like /s/:id).
 */
export function classifyStaticPath(distDir: string, urlPath: string): StaticTarget {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { kind: 'blocked' };
  }
  const root = resolve(distDir);
  const candidate = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return { kind: 'blocked' };
  if (extname(candidate) === '') return { kind: 'spa' };
  return { kind: 'asset', filePath: candidate };
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test apps/server/src/static.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Nối static serving vào `apps/server/src/index.ts`**

Thêm import gần các import route (sau dòng `import { createStreamBus } from './stream/bus.js';`):

```ts
import { classifyStaticPath, contentTypeFor, isImmutableAsset } from './static.js';
```

Trong `main()`, sau dòng `const port = Number(...)` thêm:

```ts
  const webDist = globals.process?.env?.AI_GUI_WEB_DIST;
```

Trong `globals.Bun.serve({ port, ... })`, đổi thành:

```ts
  globals.Bun.serve({
    port,
    hostname: '127.0.0.1',
```

Ngay TRƯỚC dòng `return Response.json({ error: 'not found' }, { status: 404 });` (cuối chuỗi route, trong `try`), chèn:

```ts
        if (webDist && !pathname.startsWith('/api/')) {
          const target = classifyStaticPath(webDist, pathname);
          if (target.kind === 'blocked') {
            return new Response('not found', { status: 404 });
          }
          if (target.kind === 'spa') {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            try {
              const html = await readFile(join(webDist, 'index.html'));
              return new Response(html, {
                headers: {
                  'content-type': 'text/html; charset=utf-8',
                  'cache-control': 'no-cache',
                },
              });
            } catch {
              return new Response('web dist missing index.html', { status: 500 });
            }
          }
          const { readFile } = await import('node:fs/promises');
          try {
            const body = await readFile(target.filePath);
            return new Response(body, {
              headers: {
                'content-type': contentTypeFor(target.filePath),
                'cache-control': isImmutableAsset(target.filePath)
                  ? 'public, max-age=31536000, immutable'
                  : 'no-cache',
              },
            });
          } catch {
            return new Response('not found', { status: 404 });
          }
        }
```

> Ghi chú: dynamic import giữ `index.ts` không kéo `node:fs` vào cold path khi dev không set `AI_GUI_WEB_DIST`.

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Smoke thủ công**

```bash
cd apps/web && bun run build && cd ../..
AI_GUI_WEB_DIST="$PWD/apps/web/dist" AI_GUI_PORT=8899 bun apps/server/src/index.ts &
sleep 2
curl -s http://127.0.0.1:8899/ | head -c 80            # HTML
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/s/x   # 200 (SPA fallback)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8899/..%2f..%2fetc%2fpasswd  # 404
kill %1
```
Expected: HTML in ra, `200`, `404`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/static.ts apps/server/src/static.test.ts apps/server/src/index.ts
git commit -m "feat(server): serve static web dist with SPA fallback on loopback"
```

---

### Task 2: Token auth cho `/api/*` và WebSocket

**Files:**
- Create: `apps/server/src/auth.ts`
- Create: `apps/server/src/auth.test.ts`
- Modify: `apps/server/src/index.ts` (import; guard đầu `try`; guard nhánh upgrade; set cookie khi serve index.html)

**Interfaces:**
- Consumes: `Request`.
- Produces:
  - `const TOKEN_HEADER = 'x-ai-gui-token'`
  - `const TOKEN_COOKIE = 'ai_gui_token'`
  - `function readRequestToken(req: Request): string | null`
  - `function isAuthorized(req: Request, token: string | undefined): boolean`
  - `function tokenCookieHeader(token: string): string`

- [ ] **Step 1: Viết test thất bại**

Create `apps/server/src/auth.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { isAuthorized, readRequestToken, TOKEN_COOKIE, TOKEN_HEADER, tokenCookieHeader } from './auth';

const token = 's3cr3t';

describe('readRequestToken', () => {
  test('reads the header', () => {
    const req = new Request('http://x/api/health', { headers: { [TOKEN_HEADER]: token } });
    expect(readRequestToken(req)).toBe(token);
  });

  test('reads the cookie among others', () => {
    const req = new Request('http://x/api/health', {
      headers: { cookie: `a=1; ${TOKEN_COOKIE}=${token}; b=2` },
    });
    expect(readRequestToken(req)).toBe(token);
  });

  test('returns null when absent', () => {
    expect(readRequestToken(new Request('http://x/api/health'))).toBeNull();
  });
});

describe('isAuthorized', () => {
  test('auth disabled when token undefined', () => {
    expect(isAuthorized(new Request('http://x/'), undefined)).toBe(true);
  });
  test('rejects wrong or missing token', () => {
    expect(isAuthorized(new Request('http://x/'), token)).toBe(false);
    const bad = new Request('http://x/', { headers: { [TOKEN_HEADER]: 'nope' } });
    expect(isAuthorized(bad, token)).toBe(false);
  });
  test('accepts matching header', () => {
    const ok = new Request('http://x/', { headers: { [TOKEN_HEADER]: token } });
    expect(isAuthorized(ok, token)).toBe(true);
  });
});

describe('tokenCookieHeader', () => {
  test('is HttpOnly, SameSite=Strict, root path', () => {
    expect(tokenCookieHeader(token)).toBe(
      `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test apps/server/src/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Viết `apps/server/src/auth.ts`**

```ts
export const TOKEN_HEADER = 'x-ai-gui-token';
export const TOKEN_COOKIE = 'ai_gui_token';

/** Bearer token from the dedicated header, else the same-origin cookie. */
export function readRequestToken(req: Request): string | null {
  const header = req.headers.get(TOKEN_HEADER);
  if (header) return header;
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === TOKEN_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Loopback API guard. An undefined token disables auth (dev), matching the
 * server's current no-auth flow. The webview receives the cookie when the
 * server serves index.html, so same-origin fetch and WS carry it implicitly.
 */
export function isAuthorized(req: Request, token: string | undefined): boolean {
  if (!token) return true;
  return readRequestToken(req) === token;
}

export function tokenCookieHeader(token: string): string {
  return `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test apps/server/src/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Nối auth vào `apps/server/src/index.ts`**

Thêm import (sau import `static.js`):

```ts
import { isAuthorized, tokenCookieHeader } from './auth.js';
```

Trong `main()`, sau dòng `const webDist = ...`:

```ts
  const authToken = globals.process?.env?.AI_GUI_TOKEN;
```

Trong nhánh upgrade WebSocket, sau khi tính `sessionId` và TRƯỚC dòng `const upgraded = (`:

```ts
        if (!isAuthorized(req, authToken)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
```

Đầu khối `try {` (ngay sau dòng `try {`), chèn:

```ts
        if (authToken && pathname.startsWith('/api/') && !isAuthorized(req, authToken)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
```

Trong nhánh serve SPA `index.html` (Task 1), thay object `headers` bằng biến có điều kiện cookie:

```ts
              const headers: Record<string, string> = {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-cache',
              };
              if (authToken) headers['set-cookie'] = tokenCookieHeader(authToken);
              return new Response(html, { headers });
```

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Smoke token**

```bash
cd apps/web && bun run build && cd ../..
AI_GUI_WEB_DIST="$PWD/apps/web/dist" AI_GUI_TOKEN=tok AI_GUI_PORT=8899 bun apps/server/src/index.ts &
sleep 2
curl -s -o /dev/null -w 'no-token=%{http_code}\n' http://127.0.0.1:8899/api/health
curl -s -o /dev/null -w 'with-token=%{http_code}\n' -H 'x-ai-gui-token: tok' http://127.0.0.1:8899/api/health
curl -s -D - -o /dev/null http://127.0.0.1:8899/ | grep -i set-cookie
kill %1
```
Expected: `no-token=401`, `with-token=200`, có `set-cookie: ai_gui_token=tok; HttpOnly; SameSite=Strict; Path=/`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/auth.ts apps/server/src/auth.test.ts apps/server/src/index.ts
git commit -m "feat(server): loopback token auth for api and websocket"
```

---

### Task 3: Build script sidecar + addon + manifest + packaging smoke

**Files:**
- Create: `apps/desktop/binaries/.gitkeep`
- Create: `scripts/build-desktop.ts`
- Create: `scripts/smoke-sidecar.ts`
- Modify: `package.json` (thêm script `build:desktop`, `smoke:sidecar`)
- Modify: `.gitignore` (bỏ qua binary/addon nặng)

**Interfaces:**
- Produces:
  - Build output `apps/desktop/binaries/ai-gui-server-aarch64-apple-darwin`
  - Build output `apps/desktop/binaries/pi_natives.darwin-arm64.node`
  - Build output `apps/desktop/binaries/natives-manifest.json` — `{ "version": string; "file": string }`
  - `scripts/smoke-sidecar.ts`: exit 0 nếu `/api/health` trả `{ok:true}`, non-zero nếu không.

- [ ] **Step 1: Thêm `.gitignore`**

Append vào `.gitignore`:

```gitignore
apps/desktop/binaries/*
!apps/desktop/binaries/.gitkeep
apps/desktop/src-tauri/target/
apps/desktop/src-tauri/resources/web/
```

Create `apps/desktop/binaries/.gitkeep` (file rỗng).

- [ ] **Step 2: Viết `scripts/build-desktop.ts`**

```ts
#!/usr/bin/env bun
// Builds the desktop sidecar: web dist, compiled server binary, native addon,
// and the manifest Rust reads to provision the addon at runtime.
import { $ } from 'bun';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const TARGET_TRIPLE = 'aarch64-apple-darwin';
const ADDON_FILENAME = 'pi_natives.darwin-arm64.node';
const OUT_DIR = 'apps/desktop/binaries';
const SERVER_OUT = join(OUT_DIR, `ai-gui-server-${TARGET_TRIPLE}`);
const WEB_DIST = 'apps/desktop/src-tauri/resources/web';

async function findAddon(): Promise<{ path: string; version: string }> {
  const glob = new Bun.Glob('node_modules/.bun/@oh-my-pi+pi-natives-darwin-arm64@*/**/' + ADDON_FILENAME);
  for await (const match of glob.scan('.')) {
    const pkgJson = join(match, '..', '..', 'package.json');
    const pkg = (await Bun.file(pkgJson).json()) as { version?: string };
    return { path: match, version: pkg.version ?? '0.0.0' };
  }
  throw new Error(`native addon not found: ${ADDON_FILENAME}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await $`bun run --filter @ai-gui/web build`;
  await $`rm -rf ${WEB_DIST}`;
  await mkdir('apps/desktop/src-tauri/resources', { recursive: true });
  await $`cp -R apps/web/dist ${WEB_DIST}`;
  await $`bun build --compile apps/server/src/index.ts --outfile ${SERVER_OUT} --external omp-legacy-pi-modules`;
  const addon = await findAddon();
  await copyFile(addon.path, join(OUT_DIR, ADDON_FILENAME));
  await Bun.write(
    join(OUT_DIR, 'natives-manifest.json'),
    JSON.stringify({ version: addon.version, file: ADDON_FILENAME }, null, 2),
  );
  console.log(`sidecar: ${SERVER_OUT}\nweb dist: ${WEB_DIST}\naddon: ${ADDON_FILENAME} v${addon.version}`);
}

await main();
```

- [ ] **Step 3: Viết `scripts/smoke-sidecar.ts`**

```ts
#!/usr/bin/env bun
// Runs the compiled sidecar and asserts /api/health answers. Guards the two
// packaging regressions that compile hides: missing native addon and a new
// unbundled dynamic import.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'apps/desktop/binaries';
const BIN = join(DIR, 'ai-gui-server-aarch64-apple-darwin');
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

child.kill('SIGTERM');
if (!ok) {
  console.error(`sidecar health failed\n${stderr}`);
  process.exit(1);
}
console.log('sidecar smoke OK');
```

- [ ] **Step 4: Thêm script vào `package.json`**

Trong `scripts` của root `package.json`, thêm:

```json
    "build:desktop": "bun scripts/build-desktop.ts",
    "smoke:sidecar": "bun scripts/smoke-sidecar.ts",
```

- [ ] **Step 5: Chạy build + smoke**

Run: `bun run build:desktop && bun run smoke:sidecar`
Expected: log `sidecar: ...` + `sidecar smoke OK`. Không có stderr `Failed to load pi_natives`.

- [ ] **Step 6: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json scripts/build-desktop.ts scripts/smoke-sidecar.ts apps/desktop/binaries/.gitkeep
git commit -m "build(desktop): compile sidecar with native addon and smoke script"
```

---

### Task 4: Tauri scaffold — app mở window placeholder

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/placeholder/index.html`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/icons/` (icon tối thiểu để build — xem Step 3)

**Interfaces:**
- Produces: một Tauri app biên dịch được, mở 1 window hiển thị placeholder.
- Consumes: Tauri v2, `tauri-plugin-shell` v2.

- [ ] **Step 1: Kiểm tra Rust toolchain**

Run: `rustc --version && cargo --version`
Expected: in ra version. Nếu thiếu: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` rồi mở shell mới.

- [ ] **Step 2: Tạo `apps/desktop/package.json`**

```json
{
  "name": "@ai-gui/desktop",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build --no-bundle"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0"
  }
}
```

Sau đó: `bun install`.

- [ ] **Step 3: Placeholder + icons**

Create `apps/desktop/placeholder/index.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>AI-GUI</title></head>
  <body style="font-family: system-ui; padding: 2rem">Starting AI-GUI…</body>
</html>
```

Icons: tạo placeholder hợp lệ bằng Tauri CLI (không cần asset thật):
Run: `cd apps/desktop && bunx tauri icon placeholder/index.html 2>/dev/null || bunx tauri icon --help`
Nếu CLI không sinh được từ file này, lấy icon mặc định: `cd apps/desktop && bunx @tauri-apps/cli icon` (Tauri phát icon mặc định khi chưa có). Sau đó xác nhận có `src-tauri/icons/icon.icns`.

- [ ] **Step 4: `Cargo.toml`**

```toml
[package]
name = "ai-gui-desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "ai_gui_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 5: `build.rs`, `main.rs`, `lib.rs`**

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_gui_desktop_lib::run()
}
```

`apps/desktop/src-tauri/src/lib.rs`:

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AI-GUI")
                .inner_size(1200.0, 800.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: `tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AI-GUI",
  "version": "0.1.0",
  "identifier": "dev.aigui.desktop",
  "build": {
    "frontendDist": "../placeholder"
  },
  "app": {
    "windows": [],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["app"],
    "icon": ["icons/icon.icns"],
    "externalBin": ["binaries/ai-gui-server"]
  }
}
```

- [ ] **Step 7: `capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "default desktop capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/ai-gui-server", "sidecar": true }]
    }
  ]
}
```

- [ ] **Step 8: Build (không bundle)**

Run: `cd apps/desktop && bun run tauri build --no-bundle` (lần đầu tải + compile crate, vài phút)
Expected: biên dịch thành công; `src-tauri/target/release/ai-gui-desktop` tồn tại.

- [ ] **Step 9: Chạy thử window**

Run: `cd apps/desktop && bun run tauri dev`
Expected: cửa sổ mở, hiển thị "Starting AI-GUI…". Đóng cửa sổ để thoát.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/package.json apps/desktop/placeholder apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/build.rs apps/desktop/src-tauri/src apps/desktop/src-tauri/capabilities apps/desktop/src-tauri/icons bun.lock
git commit -m "feat(desktop): scaffold tauri v2 shell with sidecar capability"
```

---

### Task 5: Spawn sidecar + provision addon + health handshake + window

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (thêm `resources`, đổi `externalBin` giữ nguyên; thêm `beforeDevCommand`/`beforeBuildCommand` gọi build script)
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/src/sidecar.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml` (thêm `tauri-plugin-updater`? KHÔNG — Phase B. Chỉ giữ shell.)

**Interfaces:**
- Consumes: `apps/desktop/binaries/{ai-gui-server-aarch64-apple-darwin, pi_natives.darwin-arm64.node, natives-manifest.json}` (Task 3); resource dir.
- Produces:
  - `fn free_port() -> u16`
  - `fn provision_native(app: &tauri::AppHandle, config_dir: &std::path::PathBuf) -> Result<(), String>`
  - `struct SidecarState(Mutex<Option<CommandChild>>)`
  - App mở window trỏ `http://127.0.0.1:<port>`, giết sidecar khi thoát.

- [ ] **Step 1: Cập nhật `tauri.conf.json`**

Thay khối `build` và `bundle` bằng:

```json
  "build": {
    "frontendDist": "../placeholder",
    "beforeDevCommand": "bun run ../../scripts/build-desktop.ts",
    "beforeBuildCommand": "bun run ../../scripts/build-desktop.ts"
  },
```

Trong `bundle`, thêm `resources` (giữ `externalBin`, `icon`, `targets`, `active`):

```json
    "resources": {
      "../binaries/pi_natives.darwin-arm64.node": "natives/pi_natives.darwin-arm64.node",
      "../binaries/natives-manifest.json": "natives/natives-manifest.json",
      "resources/web": "web"
    }
```

(`resources/web` được `scripts/build-desktop.ts` đổ từ `apps/web/dist`; server đọc qua `AI_GUI_WEB_DIST` = `<resource>/web`.)

- [ ] **Step 2: Viết `apps/desktop/src-tauri/src/sidecar.rs`**

```rust
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(15);
/// SDK version-pinned natives cache; PI_CONFIG_DIR relocates its root.
const NATIVES_DIR: &str = "natives";

#[derive(serde::Deserialize)]
pub struct NativesManifest {
    pub version: String,
    pub file: String,
}

pub fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind ephemeral port")
        .local_addr()
        .expect("local addr")
        .port()
}

/// Copy the signed addon resource into the SDK's versioned natives cache so
/// the sidecar loader finds it without a node_modules tree. Never writes into
/// the signed .app bundle.
pub fn provision_native(app: &AppHandle, config_dir: &PathBuf) -> Result<(), String> {
    // Owners only: the config dir holds sessions, settings, and credentials.
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(config_dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("chmod config dir: {e}"))?;

    let manifest_path = app
        .path()
        .resolve("natives/natives-manifest.json", BaseDirectory::Resource)
        .map_err(|e| format!("resolve manifest: {e}"))?;
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {e}"))?;
    let manifest: NativesManifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;

    let dest_dir = config_dir.join(NATIVES_DIR).join(&manifest.version);
    let dest = dest_dir.join(&manifest.file);
    if dest.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("mkdir natives: {e}"))?;
    let src = app
        .path()
        .resolve(format!("natives/{}", manifest.file), BaseDirectory::Resource)
        .map_err(|e| format!("resolve addon: {e}"))?;
    std::fs::copy(&src, &dest).map_err(|e| format!("copy addon: {e}"))?;
    Ok(())
}

/// Poll TCP connect until the sidecar accepts connections or the deadline
/// passes. TCP is enough: the webview itself calls /api/health.
pub fn wait_for_port(port: u16) -> bool {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let addr = format!("127.0.0.1:{port}");
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr.parse().expect("addr"), Duration::from_millis(200)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}
```

- [ ] **Step 3: Thay `apps/desktop/src-tauri/src/lib.rs`**

```rust
mod sidecar;

use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            std::fs::create_dir_all(&config_dir)?;
            sidecar::provision_native(app.handle(), &config_dir)?;

            let web_dist = app
                .path()
                .resolve("web", BaseDirectory::Resource)
                .map_err(|e| format!("resolve web dist: {e}"))?;

            let port = sidecar::free_port();
            let token = random_token();
            let (mut rx, child) = app
                .shell()
                .sidecar("ai-gui-server")?
                .env("AI_GUI_PORT", port.to_string())
                .env("AI_GUI_TOKEN", token)
                .env("PI_CONFIG_DIR", config_dir.to_string_lossy().to_string())
                .env("AI_GUI_WEB_DIST", web_dist.to_string_lossy().to_string())
                .spawn()?;
            app.state::<SidecarState>().0.lock().unwrap().replace(child);

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
                        eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                    }
                }
            });

            let url = format!("http://127.0.0.1:{port}");
            let handle_for_window = app.handle().clone();
            std::thread::spawn(move || {
                if !sidecar::wait_for_port(port) {
                    eprintln!("sidecar did not become ready on {url}");
                }
                let _ = handle_for_window.clone().run_on_main_thread(move || {
                    let _ = WebviewWindowBuilder::new(
                        &handle_for_window,
                        "main",
                        WebviewUrl::External(url.parse().expect("url")),
                    )
                    .title("AI-GUI")
                    .inner_size(1200.0, 800.0)
                    .build();
                });
            });
            let _ = handle;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<SidecarState>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
```

- [ ] **Step 4: Thêm `getrandom`**

Trong `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`, thêm:

```toml
getrandom = "0.3"
```

- [ ] **Step 5: Build**

Run: `cd apps/desktop && bun run tauri build --no-bundle`
Expected: biên dịch thành công (sửa lỗi API nếu Tauri v2 khác — đối chiếu docs `WebviewWindowBuilder`, `BaseDirectory`, `CommandEvent`).

- [ ] **Step 6: Chạy app dev**

Run: `cd apps/desktop && bun run tauri dev`
Expected: sau ~1-3s cửa sổ mở và hiển thị UI AI-GUI (landing "How Can I Assist You?"). Vào Settings → đổi theme hoạt động (chứng minh REST + cookie token thông). Tạo session + gửi prompt ngắn → có phản hồi (chứng minh WS + runtime).

- [ ] **Step 7: Kiểm tra dừng sạch**

Đóng cửa sổ app. Run: `pgrep -fl ai-gui-server || echo "no sidecar"`.
Expected: `no sidecar`.

- [ ] **Step 8: Kiểm tra data dir**

Run: `ls "$HOME/Library/Application Support/dev.aigui.desktop" 2>/dev/null || ls "$HOME/Library/Application Support/AI-GUI" 2>/dev/null`
Expected: có dir data (session/settings) và `natives/18.1.11/pi_natives.darwin-arm64.node`; `~/.omp` không bị tạo mới bởi app.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src bun.lock
git commit -m "feat(desktop): spawn sidecar, provision native addon, handshake, window"
```

---

### Task 6: Bundle `.app` unsigned + smoke bundle

**Files:**
- Modify: `scripts/smoke-sidecar.ts` (giữ nguyên — dùng cho CI Phase B)
- Create: `scripts/smoke-bundle.ts`

**Interfaces:**
- Consumes: `apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app`
- Produces: script verify app bundle mở được + sidecar tới health, exit code theo kết quả.

- [ ] **Step 1: Bundle**

Run: `cd apps/desktop && bun run tauri build` (không set `APPLE_SIGNING_IDENTITY` → Tauri bỏ qua ký)
Expected: tạo `apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app`.

- [ ] **Step 2: Xác nhận layout bundle**

Run: `find apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app -maxdepth 3 -name 'ai-gui-server*' -o -name 'pi_natives*' -o -name 'natives-manifest.json'`
Expected: `Contents/MacOS/ai-gui-server` tồn tại; addon + manifest nằm trong `Contents/Resources/natives/`.

- [ ] **Step 3: Viết `scripts/smoke-bundle.ts`**

```ts
#!/usr/bin/env bun
// Launches the unsigned .app, waits for it to settle, then asserts no orphan
// sidecar survives after the app is asked to quit. Guards bundle layout,
// addon provisioning, and shutdown wiring.
import { $ } from 'bun';
import { existsSync } from 'node:fs';

const APP = 'apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app';
if (!existsSync(APP)) {
  console.error(`missing app bundle: run \`cd apps/desktop && bun run tauri build\` (${APP})`);
  process.exit(1);
}

await $`open ${APP}`.quiet();
await Bun.sleep(6000);

const running = await $`pgrep -fl ai-gui-server`.quiet().nothrow();
if (running.exitCode !== 0) {
  console.error('sidecar not running after launch');
  await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
  process.exit(1);
}

await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
await Bun.sleep(3000);

const after = await $`pgrep -fl ai-gui-server`.quiet().nothrow();
if (after.exitCode === 0) {
  console.error('sidecar survived app quit');
  process.exit(1);
}
console.log('bundle smoke OK');
```

- [ ] **Step 4: Thêm script + chạy**

Thêm vào `package.json` `scripts`:

```json
    "smoke:bundle": "bun scripts/smoke-bundle.ts",
```

Run: `bun run smoke:bundle`
Expected: `bundle smoke OK`. (macOS có thể hỏi quyền lần đầu — chấp nhận.)

- [ ] **Step 5: Ghi nhận giới hạn**

Unsigned build **không** bật hardened runtime, nên **rủi ro #1** (native addon bị library validation chặn khi dlopen) chưa được kiểm chứng ở đây. Nó thuộc Phase B. Ghi chú vào `docs/runbook.md` mục Desktop.

- [ ] **Step 6: Typecheck + lint + full gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/smoke-bundle.ts docs/runbook.md
git commit -m "build(desktop): bundle smoke for unsigned .app"
```

---

## Self-Review

**Spec coverage (Phase A):**
- §3 kiến trúc + startup sequence → Task 5. §4 thay đổi repo → Task 3/4/5. §5 static/SPA/token/hostname → Task 1/2. §6 packaging + native addon → Task 3/5. §7 lifecycle/shutdown → Task 5 (Exit kill) + Task 6 smoke. §8 data dir (`PI_CONFIG_DIR`, `0700` TODO — chưa set mode; xem gap). §9 security (loopback + token + cookie) → Task 1/2. §10 signing/updater → **Phase B**. §11 risks → #2/#3 validated Task 3/6; #1/#4 deferred Phase B. §12 testing → tests mỗi task + smoke. §13 acceptance → Task 5/6 (trừ update).
- **Gap đã sửa:** spec §8 dir `0700` → Task 5 Step 2 set `PermissionsExt 0o700`. Web dist copy vào Tauri resource → Task 3 Step 2 (`cp -R apps/web/dist → src-tauri/resources/web`) + Task 5 Step 1 (`resources["resources/web"]="web"`) + `.gitignore`.

**Placeholder scan:** không có TBD/TODO; mọi step code có nội dung thật.

**Type consistency:** `classifyStaticPath`/`StaticTarget` (Task 1) dùng lại ở Task 1 Step 5. `tokenCookieHeader`/`isAuthorized` (Task 2) khớp call site. Manifest `{version,file}` (Task 3) khớp `NativesManifest` (Task 5). `AI_GUI_WEB_DIST`/`AI_GUI_TOKEN`/`AI_GUI_PORT`/`PI_CONFIG_DIR` nhất quán giữa build script, Rust, server.

**Scope note:** Phase B (signing/notarize/dmg/updater/CI) tách plan riêng — cần Apple Developer cert, không verify được trong repo state hiện tại.
