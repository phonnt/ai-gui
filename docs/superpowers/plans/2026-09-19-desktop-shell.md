# Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng gói AI-GUI thành app desktop Tauri v2 chạy được trên macOS (unsigned), tự start sidecar `bun-compile`, phục vụ UI cùng origin, dừng sạch khi thoát.

**Architecture:** Tauri Rust shell chọn port động, đảm bảo native addon của SDK có mặt, spawn sidecar `ai-gui-server` (Bun runtime nhúng), poll TCP tới khi server ready rồi tạo window trỏ `http://127.0.0.1:<port>`. Server serve static web dist + SPA fallback + token auth, bind `127.0.0.1`.

**Tech Stack:** Bun 1.3.14, TypeScript strict, Biome, Tauri v2 (Rust), `@oh-my-pi/pi-coding-agent` 18.1.11.

**Spec:** `docs/superpowers/specs/2026-09-19-desktop-app-design.md`

**Phạm vi plan này:** MỘT plan, đủ để app chạy được và ship.
- **Phase A (Task 1-6)** — bắt buộc để app chạy: server static/token, build sidecar, Tauri shell, spawn + health + crash-restart + graceful shutdown, bundle unsigned. Verify được ngay, không cần credentials.
- **Phase B (Task 7-9)** — phân phối: ký + notarize + `.dmg`, updater, CI. Cần Apple Developer credentials; chạy sau khi Phase A xanh. Rủi ro #1 (native addon dưới hardened runtime) chỉ lộ ra ở đây.

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
import { classifyStaticPath, contentTypeFor, isImmutableAsset, STATIC_CSP } from './static';

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

  test('CSP keeps script-src strict', () => {
    expect(STATIC_CSP).toContain("script-src 'self'");
    expect(STATIC_CSP).toContain("frame-ancestors 'none'");
    expect(STATIC_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
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
 * CSP served with static responses (spec §9). `'unsafe-inline'` styles and
 * `blob:` workers are required by Tailwind/CodeMirror/highlight; never relax
 * `script-src`.
 */
export const STATIC_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

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
import { classifyStaticPath, contentTypeFor, isImmutableAsset, STATIC_CSP } from './static.js';
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
                'content-security-policy': STATIC_CSP,
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
                'content-security-policy': STATIC_CSP,
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
    const pkgJson = join(match, '..', 'package.json');
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

Create `apps/desktop/placeholder/index.html` (loading + error page; Tauri-served nên có IPC):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>AI-GUI</title>
    <style>
      body { font-family: system-ui; padding: 2rem; }
      #error { color: #b00; white-space: pre-wrap; }
      button { margin-top: 1rem; padding: 0.4rem 1rem; }
    </style>
  </head>
  <body>
    <p id="msg">Starting AI-GUI…</p>
    <p id="error" hidden></p>
    <button id="retry" hidden>Retry</button>
    <script>
      const err = new URLSearchParams(location.search).get('error');
      if (err) {
        document.getElementById('msg').textContent = 'AI-GUI failed to start.';
        const box = document.getElementById('error');
        box.textContent = err;
        box.hidden = false;
        document.getElementById('retry').hidden = false;
      }
      document.getElementById('retry').onclick = () => {
        document.getElementById('retry').hidden = true;
        document.getElementById('msg').textContent = 'Restarting…';
        window.__TAURI__.core.invoke('restart_sidecar');
      };
    </script>
  </body>
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
    "withGlobalTauri": true,
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
  - `fn natives_dir() -> PathBuf` (XDG-aware, khớp loader §6.2 spec)
  - `fn provision_native(app: &tauri::AppHandle) -> Result<NativesManifest, String>`
  - `fn health_ok(port: u16, token: &str) -> bool` · `fn wait_for_health(port, token) -> bool`
  - `fn kill_graceful(child: CommandChild)` (SIGTERM → 3s → SIGKILL)
  - `#[tauri::command] fn restart_sidecar(app)`
  - Window mở ngay trên `index.html` (loading/error page, Tauri-served) rồi navigate sang `http://127.0.0.1:<port>` khi ready; crash → quay lại `index.html?error=…`.

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
use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;

pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(serde::Deserialize, Clone)]
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

/// Mirror the SDK loader's own resolution
/// (`@oh-my-pi/pi-natives/native/loader-state.js`): natives live in
/// `$XDG_DATA_HOME/omp/natives` when that root exists, else `~/.omp/natives`.
/// `PI_CONFIG_DIR` does NOT relocate this cache.
pub fn natives_dir() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            let root = PathBuf::from(&xdg).join("omp");
            if root.exists() {
                return root.join("natives");
            }
        }
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join(".omp")
        .join("natives")
}

/// Copy the signed addon resource into the versioned natives cache the loader
/// probes first. Never writes into the signed .app bundle.
pub fn provision_native(app: &AppHandle) -> Result<NativesManifest, String> {
    let manifest_path = app
        .path()
        .resolve("natives/natives-manifest.json", BaseDirectory::Resource)
        .map_err(|e| format!("resolve manifest: {e}"))?;
    let raw = std::fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {e}"))?;
    let manifest: NativesManifest =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest: {e}"))?;

    let dest_dir = natives_dir().join(&manifest.version);
    let dest = dest_dir.join(&manifest.file);
    if !dest.exists() {
        std::fs::create_dir_all(&dest_dir).map_err(|e| format!("mkdir natives: {e}"))?;
        let src = app
            .path()
            .resolve(format!("natives/{}", manifest.file), BaseDirectory::Resource)
            .map_err(|e| format!("resolve addon: {e}"))?;
        std::fs::copy(&src, &dest).map_err(|e| format!("copy addon: {e}"))?;
    }
    Ok(manifest)
}

/// Ready when `GET /api/health` (with the launch token) says `{ ok: true }`.
pub fn health_ok(port: u16, token: &str) -> bool {
    let url = format!("http://127.0.0.1:{port}/api/health");
    match ureq::get(&url)
        .set("x-ai-gui-token", token)
        .timeout(Duration::from_millis(800))
        .call()
    {
        Ok(res) => res
            .into_string()
            .map(|body| body.contains("\"ok\":true"))
            .unwrap_or(false),
        Err(_) => false,
    }
}

pub fn wait_for_health(port: u16, token: &str) -> bool {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if health_ok(port, token) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

/// SIGTERM, wait up to 3s, then SIGKILL. The sidecar flushes its journal on
/// SIGTERM (its own SIGINT/SIGTERM handler), so a graceful stop is required.
pub fn kill_graceful(child: CommandChild) {
    let pid = child.pid() as i32;
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
}
```

- [ ] **Step 3: Thay `apps/desktop/src-tauri/src/lib.rs`**

```rust
mod sidecar;

use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    port: Mutex<u16>,
    token: Mutex<String>,
    config_dir: Mutex<String>,
    web_dist: Mutex<String>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("random bytes");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn spawn_sidecar(
    app: &tauri::AppHandle,
    port: u16,
    token: &str,
    config_dir: &str,
    web_dist: &str,
) -> Result<CommandChild, String> {
    let (mut rx, child) = app
        .shell()
        .sidecar("ai-gui-server")
        .map_err(|e| e.to_string())?
        .env("AI_GUI_PORT", port.to_string())
        .env("AI_GUI_TOKEN", token.to_string())
        .env("PI_CONFIG_DIR", config_dir.to_string())
        .env("AI_GUI_WEB_DIST", web_dist.to_string())
        .spawn()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
                eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
            }
        }
    });
    Ok(child)
}

/// Navigate the main window to the served app once the server is ready.
fn goto_app(app: &tauri::AppHandle, port: u16) {
    if let Some(win) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{port}");
        let _ = win.navigate(url.parse().expect("app url"));
    }
}

/// Show the local error page (Tauri-served, has IPC) with the reason. Uses a
/// query param so the page never races an event that fired before it loaded.
fn goto_error(app: &tauri::AppHandle, message: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let encoded: String = message
            .chars()
            .map(|c| if c == ' ' { "%20".to_string() } else { c.to_string() })
            .collect();
        let url = format!("tauri://localhost/index.html?error={encoded}");
        if let Ok(parsed) = tauri::Url::parse(&url) {
            let _ = win.navigate(parsed);
        }
    }
    let _ = app.emit("sidecar-error", message);
}

/// Spawn, wait for readiness, then drive the window and watch for crashes.
fn start(app: &tauri::AppHandle) {
    let (port, token, config_dir, web_dist) = {
        let state = app.state::<SidecarState>();
        (
            *state.port.lock().unwrap(),
            state.token.lock().unwrap().clone(),
            state.config_dir.lock().unwrap().clone(),
            state.web_dist.lock().unwrap().clone(),
        )
    };

    match spawn_sidecar(app, port, &token, &config_dir, &web_dist) {
        Ok(child) => {
            app.state::<SidecarState>().child.lock().unwrap().replace(child);
        }
        Err(e) => {
            goto_error(app, &format!("spawn failed: {e}"));
            return;
        }
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        if !sidecar::wait_for_health(port, &token) {
            goto_error(&handle, "server did not become ready in 15s");
            return;
        }
        goto_app(&handle, port);
        // Crash monitor: two consecutive misses surface the error page.
        let mut misses = 0;
        loop {
            std::thread::sleep(Duration::from_secs(5));
            if sidecar::health_ok(port, &token) {
                misses = 0;
                continue;
            }
            misses += 1;
            if misses >= 2 {
                goto_error(&handle, "server stopped");
                return;
            }
        }
    });
}

#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) {
    {
        let state = app.state::<SidecarState>();
        if let Some(child) = state.child.lock().unwrap().take() {
            sidecar::kill_graceful(child);
        }
    }
    start(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![restart_sidecar])
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir: {e}"))?;
            std::fs::create_dir_all(&config_dir)?;
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o700))?;
            }
            if let Err(e) = sidecar::provision_native(app.handle()) {
                eprintln!("native addon provisioning failed: {e}");
            }
            let web_dist = app
                .path()
                .resolve("web", BaseDirectory::Resource)
                .map_err(|e| format!("resolve web dist: {e}"))?;

            let port = sidecar::free_port();
            let token = random_token();
            {
                let state = app.state::<SidecarState>();
                *state.port.lock().unwrap() = port;
                *state.token.lock().unwrap() = token;
                *state.config_dir.lock().unwrap() = config_dir.to_string_lossy().to_string();
                *state.web_dist.lock().unwrap() = web_dist.to_string_lossy().to_string();
            }

            // Window opens immediately on the local loading page; it is
            // navigated to the server (or the error page) by `start`.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("AI-GUI")
                .inner_size(1200.0, 800.0)
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || start(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(child) =
                    app_handle.state::<SidecarState>().child.lock().unwrap().take()
                {
                    sidecar::kill_graceful(child);
                }
            }
        });
}
```

- [ ] **Step 4: Thêm dependencies**

Trong `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`, thêm:

```toml
getrandom = "0.3"
ureq = "2"
libc = "0.2"
```

(`ureq` = HTTP client blocking nhẹ cho `/api/health`; `libc` = gửi SIGTERM để kill graceful.)

- [ ] **Step 5: Build**

Run: `cd apps/desktop && bun run tauri build --no-bundle`
Expected: biên dịch thành công (sửa lỗi API nếu Tauri v2 khác — đối chiếu docs `WebviewWindowBuilder`, `BaseDirectory`, `CommandEvent`).

- [ ] **Step 6: Chạy app dev**

Run: `cd apps/desktop && bun run tauri dev`
Expected: cửa sổ mở ngay trên loading page, sau ~1-3s tự chuyển sang UI AI-GUI (landing "How Can I Assist You?"). Vào Settings → đổi theme (REST + cookie token). Tạo session + gửi prompt ngắn → có phản hồi (WS + runtime).

- [ ] **Step 7: Kiểm tra health handshake thất bại → error page**

Trong lúc app đang chạy, kill sidecar để mô phỏng crash:
```bash
pkill -f ai-gui-server
```
Expected: trong ≤10s cửa sổ chuyển về error page "server stopped" có nút **Retry**; bấm Retry → khôi phục về UI.

- [ ] **Step 8: Kiểm tra dừng sạch**

Đóng cửa sổ app. Run: `pgrep -fl ai-gui-server || echo "no sidecar"`.
Expected: `no sidecar`.

- [ ] **Step 9: Kiểm tra data dir + natives**

Run:
```bash
ls "$HOME/Library/Application Support/dev.aigui.desktop"
ls "$HOME/.omp/natives/18.1.11/pi_natives.darwin-arm64.node"
```
Expected: app data dir có session/settings; addon nằm ở `~/.omp/natives/18.1.11/` (đúng ngoại lệ spec §8 — loader-owned path, **không** dưới `PI_CONFIG_DIR`).

- [ ] **Step 10: Commit**

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

### Task 7: macOS signing + notarization + `.dmg`

**Files:**
- Create: `apps/desktop/src-tauri/entitlements.plist`
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (`bundle.macOS`, `targets`)

**Yêu cầu trước:** Apple Developer Program; Developer ID Application cert trong Keychain; app-specific password. Không có → task này block, Phase A vẫn ship được dạng unsigned.

- [ ] **Step 1: `entitlements.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Bun/JSC cần JIT; native addon dlopen cần bỏ library validation -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
```

- [ ] **Step 2: `tauri.conf.json`**

`targets` thêm `"dmg"`; thêm khối `macOS`:

```json
    "macOS": {
      "entitlements": "entitlements.plist",
      "hardenedRuntime": true
    },
```

- [ ] **Step 3: Ký + notarize**

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: NAME (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
cd apps/desktop && bun run tauri build
```
Expected: tạo `.app` + `.dmg`, Tauri ký inside-out (sidecar + addon) rồi notarize + staple.

- [ ] **Step 4: Verify (rủi ro #1)**

```bash
APP="apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vvv -t exec "$APP"        # accepted, source=Notarized Developer ID
xcrun stapler validate "$APP"
```
Sau đó `open "$APP"` trên **máy sạch** (hoặc xoá quarantine rồi mở). Expected: mở không bị Gatekeeper chặn; native addon load được (không `Failed to load pi_natives`) → **xác nhận rủi ro #1 đã xử lý**. Nếu addon bị library validation chặn: kiểm tra entitlement đã áp (`codesign -d --entitlements - "$APP"`) và addon nằm trong resource đã ký.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/entitlements.plist apps/desktop/src-tauri/tauri.conf.json
git commit -m "build(desktop): sign, notarize, and dmg for macOS"
```

---

### Task 8: Auto-update

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml` (`tauri-plugin-updater`)
- Modify: `apps/desktop/src-tauri/tauri.conf.json` (updater plugin)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (plugin init + startup check)
- Create: `docs/desktop-release.md` (cách host manifest)

- [ ] **Step 1: Thêm plugin + key**

```bash
cd apps/desktop && bun tauri add updater
bunx tauri signer generate -w ~/.tauri/ai-gui.key
```
Lưu private key + password vào CI secret (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Pubkey điền vào config.

- [ ] **Step 2: `tauri.conf.json`**

```json
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<PUBKEY từ bước 1>",
      "endpoints": ["https://REPLACE/latest.json"]
    }
  }
```

- [ ] **Step 3: Kiểm tra update lúc khởi động (`lib.rs`)**

Thêm vào `setup`, sau `start`:

```rust
            let updater_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_updater::UpdaterExt;
                if let Ok(updater) = updater_handle.updater() {
                    if let Ok(Some(update)) = updater.check().await {
                        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                            updater_handle.restart();
                        }
                    }
                }
            });
```

- [ ] **Step 4: Verify**

Host `latest.json` (xem `docs/desktop-release.md`) với version cao hơn; cài bản cũ; mở app. Expected: phát hiện + cài + restart sang bản mới.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop docs/desktop-release.md
git commit -m "feat(desktop): auto-update via tauri updater"
```

---

### Task 9: CI (mac runner)

**Files:**
- Create: `.github/workflows/desktop.yml`

- [ ] **Step 1: Workflow**

```yaml
name: desktop
on:
  push:
    tags: ['desktop-v*']
  workflow_dispatch:

jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: '1.3.14' }
      - uses: dtolnay/rust-toolchain@stable
      - name: Install
        run: bun install
      - name: Check
        run: bun run check
      - name: Build sidecar
        run: bun run build:desktop
      - name: Sidecar smoke
        run: bun run smoke:sidecar
      - name: Build app (signed, notarized, updater)
        working-directory: apps/desktop
        env:
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: bun run tauri build
      - name: Bundle smoke
        run: bun run smoke:bundle
      - uses: actions/upload-artifact@v4
        with:
          name: ai-gui-macos
          path: |
            apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
            apps/desktop/src-tauri/target/release/bundle/macos/*.app.tar.gz
            apps/desktop/src-tauri/target/release/bundle/macos/*.sig
```

- [ ] **Step 2: Secrets**

Thêm CI secrets: `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY` (nội dung file key), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

- [ ] **Step 3: Verify**

Push tag `desktop-v0.1.0` (hoặc `workflow_dispatch`). Expected: job xanh; artifact `.dmg` + updater artifacts tải về được.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/desktop.yml
git commit -m "ci(desktop): mac build, sign, notarize, updater artifacts"
```

---

## Self-Review

**Spec coverage (toàn bộ spec):**
- §1-2 mục tiêu/quyết định → Global Constraints + Task 3-5. §3 kiến trúc + startup → Task 4/5. §4 thay đổi repo → Task 1-4. §5 static/SPA/token/hostname → Task 1/2. §6.1 build sidecar → Task 3; §6.2 native addon (đường dẫn loader) → Task 3 (manifest) + Task 5 (`natives_dir` + provision) + verify Step 9. §7.1 readiness handshake (`/api/health` + token, timeout → error page) → Task 5; §7.2 crash detect + restart → Task 5 + verify Step 7; §7.3 graceful shutdown → Task 5 (`kill_graceful`) + verify Step 8. §8 data dir + `0700` + natives ngoại lệ → Task 5. §9 security + CSP → Task 1 (CSP) + Task 2 (token/cookie/loopback). §10 signing/notarize/updater → Task 7/8. §11 risks #1 → Task 7 Step 4; #2 → Task 5 Step 9; #3 → Task 3 smoke; #4 ghi nhận. §12 testing → test mỗi task + sidecar smoke + bundle smoke. §13.A (app chạy) → Task 5 verify 6-9 + Task 6; §13.B → Task 7-9.
- **Đã vá 6 gap:** (A) health handshake dùng `/api/health`+token thay vì TCP, timeout → error page (Task 5). (B) crash monitor 5s + `restart_sidecar` (Task 5). (C) `kill_graceful` SIGTERM→3s→SIGKILL (Task 5). (D) đường dẫn addon xác định từ source loader (`~/.omp/natives`, không phải `PI_CONFIG_DIR`), có verify step (Task 5). (E) CSP header (Task 1). (G) sidecar smoke tạo session (Task 3); prompt round-trip giữ ở verify thủ công vì cần model creds.

**Placeholder scan:** không có TBD/TODO; mọi step code có nội dung thật.

**Type consistency:** `classifyStaticPath`/`StaticTarget`/`STATIC_CSP` (Task 1) dùng lại ở Task 1 Step 5. `tokenCookieHeader`/`isAuthorized` (Task 2) khớp call site. Manifest `{version,file}` (Task 3) khớp `NativesManifest` (Task 5). `natives_dir()` (Task 5) khớp công thức loader §6.2 spec. `AI_GUI_WEB_DIST`/`AI_GUI_TOKEN`/`AI_GUI_PORT`/`PI_CONFIG_DIR` nhất quán giữa build script, Rust, server.

**Còn lại chưa verify (không chặn "app chạy"):** TCC/permission lần đầu (risk #5) và perf WKWebView (risk #6) chỉ kiểm chứng được khi chạy thật; Phase B verify rủi ro #1. Ghi vào `docs/runbook.md` mục Desktop.
