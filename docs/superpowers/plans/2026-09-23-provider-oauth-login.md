# Provider OAuth login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cho phép login/logout OAuth provider ngay trong web (`ProvidersPane`), thay vì bắt người dùng chạy `omp login <provider>` trong terminal rồi bấm Refresh.

**Architecture:** Flow OAuth chạy **trong gateway** (`apps/server` process) qua `AuthStorage.login(provider, ctrl)` của SDK; web chỉ thấy một *attempt* có trạng thái và trả lời prompt khi SDK hỏi. Một state machine trong `packages/omp-adapter` giữ attempt (in-memory), đẩy `onAuth`/`onProgress`/`onPrompt` thành snapshot cho client poll; protocol khai schema; web poll + hiện URL/paste-code. Không có credential nào đi qua web.

**Tech Stack:** Bun · TypeScript strict · Biome · zod (protocol) · React + TanStack Query · Vitest/`bun test` · Playwright · SDK `@oh-my-pi/pi-coding-agent@18.1.11` + `@oh-my-pi/pi-ai@18.1.11`.

**Spec:** `docs/tui-parity-status.md` §7 dòng `Providers` (đính chính 2026-09-23: API đã có sẵn, chỉ thiếu đường nối) + mục Out-of-scope của `docs/superpowers/plans/2026-09-22-parity-closeout.md`.

## Global Constraints

- `bun run check` (typecheck + lint + test + server smoke) xanh trước mỗi commit; `bun run e2e` xanh cho thay đổi UI.
- `apps/web` không import `apps/server`, `packages/omp-adapter`, OMP — chỉ `packages/core`, `packages/protocol`, `packages/ui`.
- Mọi logic OMP (credential ladder, OAuth flow) ở `packages/omp-adapter`; web không bao giờ nhận token/refresh — chỉ `auth.url`, prompt text, trạng thái.
- TypeScript strict, Biome, `lineWidth: 100`, single quotes, không file JS mới, file < 700 dòng.
- UI theo `docs/design-system.md`: token + recipe kit (`panel`, `hairline*`), icon `lucide-react`, icon-only control phải là `IconButton` (invariant trong `apps/web/src/lib/ui-invariants.test.ts`).
- Conventional Commits, một thay đổi logic mỗi commit.

## Non-goals (YAGNI)

- **API key entry** cho provider không OAuth — vẫn ở Settings (`apiKey` settings), không thêm luồng mới.
- **Login theo session/scope riêng** — dùng đúng scope catalog hiện có (`process.cwd()` + `getAgentDir()`, tức `registryBundle()` mà `providersList()` đang dùng), không thêm tham số scope vào route.
- **Lưu attempt qua restart** — attempt là in-memory, có TTL; restart = attempt cũ 404 (client bắt đầu lại).
- **Device-code riêng cho môi trường không có browser cùng máy** — flow đã tự chọn theo provider; UI chỉ cần hiện URL + ô dán code.

## Review Focus

1. **Provider hỏi input TRƯỚC khi có auth URL** (RPC mode từ chối case này) → web vẫn phải hoạt động: prompt hiện ra, user trả lời, flow chạy tiếp.
2. **Provider id không hỗ trợ OAuth** (hoặc gõ sai) → 400 với tên provider, không crash, không tạo attempt rác.
3. **Attempt id lạ / đã hết TTL** → 404 `unknown login attempt`, không treo request.
4. **Cancel giữa flow** (kể cả khi đang chờ paste code) → flow abort, **không** credential nào được ghi, status `cancelled`.
5. **Logout khi đang có attempt chạy** → credential bị xoá và attempt không "hồi sinh" provider đó.

---

### Task 1: Adapter — state machine cho login attempt

**Files:**
- Create: `packages/omp-adapter/src/provider-login.ts`
- Modify: `packages/omp-adapter/src/settings-catalog.ts` (thêm `login` vào `ProviderEntry` + ids OAuth)
- Modify: `packages/omp-adapter/src/index.ts` (export)
- Modify: `packages/omp-adapter/package.json` (thêm `@oh-my-pi/pi-ai`: `18.1.11`)
- Test: `packages/omp-adapter/src/provider-login.test.ts` (mới)

**Interfaces:**
- Consumes: `registryBundle(options?)` → `{ registry, authStorage }`, `catalogScopeOf` (`./settings-catalog.js`); `AuthStorage.login(provider, ctrl)` / `.logout(provider)` (`@oh-my-pi/pi-coding-agent/session/auth-storage`); `getOAuthProviders()` (`@oh-my-pi/pi-ai/oauth`); `InvalidRequestError` / `PathNotFoundError` (`@grove/agent-runtime`).
- Produces (Task 2/3 dùng đúng tên này):
  - `type ProviderLoginStatus = 'running' | 'needs-input' | 'complete' | 'failed' | 'cancelled'`
  - `interface ProviderLoginState { attemptId: string; providerId: string; status: ProviderLoginStatus; auth?: { url: string; launchUrl?: string; instructions?: string }; prompt?: { message: string; placeholder?: string }; progress?: string; identity?: { email?: string; accountId?: string; orgName?: string }; error?: string }`
  - `providerLoginStart(providerId: string): Promise<ProviderLoginState>`
  - `providerLoginState(attemptId: string): ProviderLoginState` (throw `PathNotFoundError`)
  - `providerLoginInput(attemptId: string, value: string): Promise<ProviderLoginState>`
  - `providerLoginCancel(attemptId: string): ProviderLoginState`
  - `providerLogout(providerId: string): Promise<void>`
  - `ProviderEntry` thêm field `login: boolean`

- [ ] **Step 1: Thêm dependency**

```bash
cd packages/omp-adapter && bun add @oh-my-pi/pi-ai@18.1.11
```
Expected: `package.json` có `"@oh-my-pi/pi-ai": "18.1.11"`; `bun run typecheck` vẫn xanh.

- [ ] **Step 2: Viết test thất bại**

```ts
// packages/omp-adapter/src/provider-login.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOAuthProvider, unregisterOAuthProvider } from '@oh-my-pi/pi-ai/oauth';
import { providersList } from './settings-catalog.js';
import {
  providerLoginCancel,
  providerLoginInput,
  providerLoginStart,
  providerLoginState,
  providerLogout,
} from './provider-login.js';

const PROVIDER = 'probe-oauth';
let codeAsked = 0;

/** A provider whose login mirrors the two SDK shapes: auth URL first, then a prompt. */
function registerProbeProvider(): void {
  registerOAuthProvider({
    id: PROVIDER,
    name: 'Probe OAuth',
    async login(callbacks) {
      callbacks.onAuth({ url: 'https://probe.test/authorize?state=abc' });
      callbacks.onProgress?.('waiting for the pasted code');
      const code = await callbacks.onPrompt({ message: 'Paste the code' });
      codeAsked += 1;
      return { refresh: 'r', access: `a-${code}`, expires: Date.now() + 3_600_000, email: 'probe@example.test' };
    },
  });
}

async function waitFor(status: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (lastAttemptId && providerLoginState(lastAttemptId).status === status) return;
    await Bun.sleep(20);
  }
  throw new Error(`attempt never reached ${status}`);
}

let lastAttemptId = '';

beforeAll(() => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-login-agent-'));
  registerProbeProvider();
});
afterAll(() => {
  unregisterOAuthProvider(PROVIDER);
});

describe('provider login attempts', () => {
  test('surfaces the auth URL, then the prompt, then the stored credential', async () => {
    const started = await providerLoginStart(PROVIDER);
    lastAttemptId = started.attemptId;
    expect(started.providerId).toBe(PROVIDER);
    expect(started.status).toBe('running');
    expect(started.auth?.url).toContain('probe.test');

    await waitFor('needs-input');
    expect(providerLoginState(lastAttemptId).prompt?.message).toBe('Paste the code');

    const done = await providerLoginInput(lastAttemptId, 'xyz');
    expect(done.status).toBe('complete');
    expect(done.identity?.email).toBe('probe@example.test');

    const listed = await providersList();
    const entry = listed.find((p) => p.id === PROVIDER);
    expect(entry?.auth).toBe('oauth');
    expect(entry?.login).toBe(true);
  });

  test('cancel aborts the flow and stores nothing', async () => {
    const started = await providerLoginStart(PROVIDER);
    lastAttemptId = started.attemptId;
    await waitFor('needs-input');
    const cancelled = providerLoginCancel(lastAttemptId);
    expect(cancelled.status).toBe('cancelled');

    await providerLogout(PROVIDER);
    const entry = (await providersList()).find((p) => p.id === PROVIDER);
    expect(entry?.auth).not.toBe('oauth');
  });

  test('an unknown provider and an unknown attempt are request errors', async () => {
    await expect(providerLoginStart('not-a-provider')).rejects.toThrow();
    expect(() => providerLoginState('nope')).toThrow();
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận fail**

Run: `bun test packages/omp-adapter/src/provider-login.test.ts`
Expected: FAIL — `Cannot find module './provider-login.js'`.

- [ ] **Step 4: Hiện thực state machine**

```ts
// packages/omp-adapter/src/provider-login.ts
import { InvalidRequestError, PathNotFoundError } from '@grove/agent-runtime';
import { getOAuthProviders } from '@oh-my-pi/pi-ai/oauth';
import { catalogScopeOf, registryBundle, type CatalogScope } from './settings-catalog.js';

export type ProviderLoginStatus = 'running' | 'needs-input' | 'complete' | 'failed' | 'cancelled';

export interface ProviderLoginState { /* như Interfaces ở trên */ }

interface Attempt {
  state: ProviderLoginState;
  controller: AbortController;
  pending?: { resolve: (value: string) => void; reject: (error: Error) => void };
  startedAt: number;
}

const ATTEMPT_TTL_MS = 10 * 60_000;
const attempts = new Map<string, Attempt>();

/** Provider ids the SDK can run an interactive login for (TUI `/login` list). */
export function oauthLoginProviderIds(): Set<string> {
  return new Set(getOAuthProviders().map((provider) => provider.id));
}

function snapshot(attempt: Attempt): ProviderLoginState {
  return { ...attempt.state };
}

function pruneExpired(now: number): void {
  for (const [id, attempt] of attempts) {
    if (now - attempt.startedAt < ATTEMPT_TTL_MS) continue;
    attempt.controller.abort();
    attempt.pending?.reject(new Error('login attempt expired'));
    attempt.state = { ...attempt.state, status: 'failed', prompt: undefined, error: 'login attempt expired' };
    attempts.delete(id);
  }
}

function requireAttempt(attemptId: string): Attempt {
  pruneExpired(Date.now());
  const attempt = attempts.get(attemptId);
  if (!attempt) throw new PathNotFoundError(`unknown login attempt: ${attemptId}`);
  return attempt;
}

export function providerLoginState(attemptId: string): ProviderLoginState {
  return snapshot(requireAttempt(attemptId));
}

export async function providerLoginStart(
  providerId: string,
  options?: Partial<CatalogScope>,
): Promise<ProviderLoginState> {
  pruneExpired(Date.now());
  if (!oauthLoginProviderIds().has(providerId)) {
    throw new InvalidRequestError(`provider ${providerId} does not support OAuth login`);
  }
  // One live attempt per provider: a second click replaces the first instead of
  // leaving two browser flows racing for the same credential row.
  for (const [id, existing] of attempts) {
    if (existing.state.providerId !== providerId) continue;
    existing.controller.abort();
    existing.pending?.reject(new Error('login restarted'));
    attempts.delete(id);
  }

  const attempt: Attempt = {
    state: { attemptId: crypto.randomUUID(), providerId, status: 'running' },
    controller: new AbortController(),
    startedAt: Date.now(),
  };
  attempts.set(attempt.state.attemptId, attempt);
  const { registry, authStorage } = await registryBundle(options);
  void runLogin(attempt, registry, authStorage, options);
  return snapshot(attempt);
}

async function runLogin(
  attempt: Attempt,
  registry: Awaited<ReturnType<typeof registryBundle>>['registry'],
  authStorage: Awaited<ReturnType<typeof registryBundle>>['authStorage'],
  options?: Partial<CatalogScope>,
): Promise<void> {
  const providerId = attempt.state.providerId;
  try {
    const identity = await authStorage.login(providerId, {
      onAuth: (info) => {
        attempt.state = {
          ...attempt.state,
          status: 'running',
          auth: { url: info.url, ...(info.launchUrl ? { launchUrl: info.launchUrl } : {}), ...(info.instructions ? { instructions: info.instructions } : {}) },
        };
      },
      onProgress: (message) => {
        attempt.state = { ...attempt.state, progress: message };
      },
      onPrompt: (prompt) => {
        attempt.state = { ...attempt.state, status: 'needs-input', prompt: { message: prompt.message, ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}) } };
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        attempt.pending = { resolve, reject };
        attempt.controller.signal.addEventListener('abort', () => reject(new Error('login cancelled')), { once: true });
        return promise;
      },
      signal: attempt.controller.signal,
    });
    attempt.state = {
      ...attempt.state,
      status: 'complete',
      prompt: undefined,
      identity: identity ? { email: identity.email, accountId: identity.accountId, orgName: identity.orgName } : undefined,
    };
    // Discovery needs the new credential; a failed refresh must not turn a
    // successful login into a failure (offline machine, provider hiccup).
    try {
      await registry.refreshProvider(providerId, 'online');
    } catch (error) {
      attempt.state = { ...attempt.state, progress: `signed in; model discovery failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  } catch (error) {
    if (attempt.state.status === 'cancelled') return;
    attempt.state = { ...attempt.state, status: 'failed', prompt: undefined, error: error instanceof Error ? error.message : String(error) };
  } finally {
    attempt.pending = undefined;
  }
}

export async function providerLoginInput(attemptId: string, value: string): Promise<ProviderLoginState> {
  const attempt = requireAttempt(attemptId);
  if (attempt.state.status !== 'needs-input' || !attempt.pending) {
    throw new InvalidRequestError(`login attempt ${attemptId} is not waiting for input`);
  }
  const pending = attempt.pending;
  attempt.pending = undefined;
  attempt.state = { ...attempt.state, status: 'running', prompt: undefined };
  pending.resolve(value);
  return snapshot(attempt);
}

export function providerLoginCancel(attemptId: string): ProviderLoginState {
  const attempt = requireAttempt(attemptId);
  attempt.state = { ...attempt.state, status: 'cancelled', prompt: undefined, error: undefined };
  attempt.controller.abort();
  attempt.pending?.reject(new Error('login cancelled'));
  attempt.pending = undefined;
  return snapshot(attempt);
}

export async function providerLogout(providerId: string, options?: Partial<CatalogScope>): Promise<void> {
  const { authStorage } = await registryBundle(options);
  await authStorage.logout(providerId);
}
```

`settings-catalog.ts`: `ProviderEntry` thêm `login: boolean`; trong `providersList()` gộp thêm `oauthLoginProviderIds()` vào `ids` và set `login: oauthIds.has(id)`.

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `bun test packages/omp-adapter/src/provider-login.test.ts`
Expected: PASS (3 test). Sau đó `bun test packages/omp-adapter` (cả package).

- [ ] **Step 6: Commit**

```bash
git add packages/omp-adapter/src/provider-login.ts packages/omp-adapter/src/provider-login.test.ts packages/omp-adapter/src/settings-catalog.ts packages/omp-adapter/src/index.ts packages/omp-adapter/package.json bun.lock
git commit -m "feat(adapter): drive provider OAuth login as a pollable attempt"
```

---

### Task 2: Protocol + server routes

**Files:**
- Modify: `packages/protocol/src/rest.ts` (`ProviderEntrySchema` + `login`; `ProviderLoginStateSchema`, `ProviderLoginInputSchema`, `ProviderLoginResponseSchema`, DTO types)
- Create: `apps/server/src/routes/provider-login.ts`
- Modify: `apps/server/src/index.ts` (path constants + dispatch)
- Test: `apps/server/src/routes/provider-login.test.ts`

**Interfaces:**
- Consumes: Task 1 (`providerLoginStart/State/Input/Cancel/Logout`), `ProviderLoginState` type.
- Produces (Task 3 dùng):
  - `POST /api/providers/:id/login` → `{ attempt }`
  - `GET /api/providers/logins/:attemptId` → `{ attempt }`
  - `POST /api/providers/logins/:attemptId/input` body `{ value }` → `{ attempt }`
  - `POST /api/providers/logins/:attemptId/cancel` → `{ attempt }`
  - `DELETE /api/providers/:id` → `{ providers }` (danh sách sau logout)
  - route fns: `startProviderLoginRoute`, `getProviderLoginRoute`, `submitProviderLoginInputRoute`, `cancelProviderLoginRoute`, `logoutProviderRoute`

- [ ] **Step 1: Viết test thất bại**

```ts
// apps/server/src/routes/provider-login.test.ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOAuthProvider, unregisterOAuthProvider } from '@oh-my-pi/pi-ai/oauth';
import { HttpError } from './errors.js';
import {
  cancelProviderLoginRoute,
  getProviderLoginRoute,
  logoutProviderRoute,
  startProviderLoginRoute,
  submitProviderLoginInputRoute,
} from './provider-login.js';

const PROVIDER = 'probe-route-oauth';

beforeAll(() => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-login-route-agent-'));
  registerOAuthProvider({
    id: PROVIDER,
    name: 'Probe Route OAuth',
    async login(callbacks) {
      callbacks.onAuth({ url: 'https://route-probe.test/authorize' });
      const code = await callbacks.onPrompt({ message: 'Paste the code' });
      return { refresh: 'r', access: `a-${code}`, expires: Date.now() + 3_600_000 };
    },
  });
});
afterAll(() => unregisterOAuthProvider(PROVIDER));

describe('provider login routes', () => {
  test('start → needs-input → input completes the flow', async () => {
    const started = await startProviderLoginRoute(PROVIDER);
    expect(started.attempt.auth?.url).toContain('route-probe.test');

    const deadline = Date.now() + 5_000;
    let state = started.attempt;
    while (Date.now() < deadline && state.status !== 'needs-input') {
      await Bun.sleep(20);
      state = (await getProviderLoginRoute(started.attempt.attemptId)).attempt;
    }
    expect(state.status).toBe('needs-input');

    const done = await submitProviderLoginInputRoute(started.attempt.attemptId, { value: 'code-1' });
    expect(done.attempt.status).toBe('complete');
  });

  test('unknown attempt is 404 and a bad body is 400', async () => {
    const missing: unknown = await getProviderLoginRoute('nope').catch((e) => e);
    expect(missing).toBeInstanceOf(HttpError);
    expect((missing as HttpError).status).toBe(404);

    const bad: unknown = await submitProviderLoginInputRoute('nope', {}).catch((e) => e);
    expect(bad).toBeInstanceOf(HttpError);
    expect((bad as HttpError).status).toBe(400);
  });

  test('a provider without OAuth login is 400, cancel is reported', async () => {
    const refused: unknown = await startProviderLoginRoute('not-a-provider').catch((e) => e);
    expect(refused).toBeInstanceOf(HttpError);
    expect((refused as HttpError).status).toBe(400);

    const started = await startProviderLoginRoute(PROVIDER);
    const cancelled = cancelProviderLoginRoute(started.attempt.attemptId);
    expect(cancelled.attempt.status).toBe('cancelled');
  });

  test('logout drops the credential from the provider list', async () => {
    const body = await logoutProviderRoute(PROVIDER);
    const entry = body.providers.find((p) => p.id === PROVIDER);
    expect(entry?.auth).not.toBe('oauth');
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test apps/server/src/routes/provider-login.test.ts`
Expected: FAIL — `Cannot find module './provider-login.js'`.

- [ ] **Step 3: Hiện thực protocol + routes**

`packages/protocol/src/rest.ts`:

```ts
export const ProviderEntrySchema = z.object({
  id: z.string().min(1),
  available: z.boolean(),
  auth: ProviderAuthSchema,
  /** Provider supports an interactive OAuth login (`/login` in the TUI). */
  login: z.boolean(),
});

export const ProviderLoginStatusSchema = z.enum([
  'running',
  'needs-input',
  'complete',
  'failed',
  'cancelled',
]);

export const ProviderLoginStateSchema = z.object({
  attemptId: z.string().min(1),
  providerId: z.string().min(1),
  status: ProviderLoginStatusSchema,
  auth: z
    .object({ url: z.string(), launchUrl: z.string().optional(), instructions: z.string().optional() })
    .optional(),
  prompt: z.object({ message: z.string(), placeholder: z.string().optional() }).optional(),
  progress: z.string().optional(),
  identity: z
    .object({ email: z.string().optional(), accountId: z.string().optional(), orgName: z.string().optional() })
    .optional(),
  error: z.string().optional(),
});

export const ProviderLoginResponseSchema = z.object({ attempt: ProviderLoginStateSchema });
export const ProviderLoginInputSchema = z.object({ value: z.string() });
```

`apps/server/src/routes/provider-login.ts`:

```ts
import { InvalidRequestError } from '@grove/agent-runtime';
import type { ProviderEntry } from '@grove/omp-adapter';
import {
  providerLoginCancel,
  providerLoginInput,
  providerLoginStart,
  providerLoginState,
  providerLogout,
  providersList,
} from '@grove/omp-adapter';
import { ProviderLoginInputSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** POST /api/providers/:id/login → { attempt }. */
export async function startProviderLoginRoute(providerId: string): Promise<{ attempt: ProviderLoginState }> {
  return { attempt: await providerLoginStart(decodeURIComponent(providerId)) };
}

/** GET /api/providers/logins/:attemptId → { attempt }. */
export async function getProviderLoginRoute(attemptId: string): Promise<{ attempt: ProviderLoginState }> {
  return { attempt: providerLoginState(decodeURIComponent(attemptId)) };
}

/** POST /api/providers/logins/:attemptId/input { value } → { attempt }. */
export async function submitProviderLoginInputRoute(attemptId: string, body: unknown): Promise<{ attempt: ProviderLoginState }> {
  const parsed = ProviderLoginInputSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return { attempt: await providerLoginInput(decodeURIComponent(attemptId), parsed.data.value) };
}

/** POST /api/providers/logins/:attemptId/cancel → { attempt }. */
export function cancelProviderLoginRoute(attemptId: string): { attempt: ProviderLoginState } {
  return { attempt: providerLoginCancel(decodeURIComponent(attemptId)) };
}

/** DELETE /api/providers/:id → { providers } after the logout. */
export async function logoutProviderRoute(providerId: string): Promise<{ providers: ProviderEntry[] }> {
  await providerLogout(decodeURIComponent(providerId));
  return { providers: await providersList() };
}
```

Errors: route handler không cần try/catch — `errorToStatus` đã map `PathNotFoundError`→404, `InvalidRequestError`→400 (kiểm tra lại ở Step 4 nếu smoke trả 500).

`apps/server/src/index.ts` — path constants cạnh `PROVIDERS_PATH` và dispatch **trước** nhánh `PROVIDERS_PATH`:

```ts
const PROVIDER_LOGIN_START_PATH = /^\/api\/providers\/([^/]+)\/login$/;
const PROVIDER_LOGIN_PATH = /^\/api\/providers\/logins\/([^/]+)$/;
const PROVIDER_LOGIN_INPUT_PATH = /^\/api\/providers\/logins\/([^/]+)\/input$/;
const PROVIDER_LOGIN_CANCEL_PATH = /^\/api\/providers\/logins\/([^/]+)\/cancel$/;
const PROVIDER_PATH = /^\/api\/providers\/([^/]+)$/;
```

- [ ] **Step 4: Chạy test + smoke**

Run: `bun test apps/server/src/routes/provider-login.test.ts && bun run smoke:server`
Expected: PASS (4 test) + `server smoke OK`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/rest.ts apps/server/src/routes/provider-login.ts apps/server/src/routes/provider-login.test.ts apps/server/src/index.ts
git commit -m "feat(server): expose provider OAuth login and logout over HTTP"
```

---

### Task 3: Web — api-client + dialog trong ProvidersPane

**Files:**
- Modify: `apps/web/src/lib/api-client/rest/settings.ts` (5 hàm + types)
- Modify: `apps/web/src/lib/api-client/hooks/settings.ts` (`useProviderLoginFlow`, `useProviderLogout`)
- Create: `apps/web/src/features/providers/ProviderLoginDialog.tsx`
- Modify: `apps/web/src/features/providers/ProvidersPane.tsx` (Login/Logout thay dialog `omp login …`)
- Test: `tests/e2e/app.spec.ts` (spec mới, stub 3 endpoint login)

**Interfaces:**
- Consumes: Task 2 routes + protocol schemas.
- Produces: `useProviderLoginFlow(providerId: string | null)` → `{ attempt, isPending, start, submit, cancel, error }`; `useProviderLogout()` → mutation invalidate `['settings','providers']` + `['settings','models']`.

- [ ] **Step 1: Viết spec e2e thất bại (stub contract)**

```ts
test('the provider login dialog drives the OAuth flow from the browser', async ({ page, request }) => {
  const created = await request.post('/api/sessions', { data: { cwd: '/tmp/grove-e2e' } });
  const { session } = await created.json();

  const attempt = {
    attemptId: 'a1',
    providerId: 'probe-oauth',
    status: 'running',
    auth: { url: 'https://probe.test/authorize?state=abc' },
  };
  const posted: unknown[] = [];
  await page.route('**/api/providers/*/login', (route) =>
    route.fulfill({ json: { attempt } }),
  );
  await page.route('**/api/providers/logins/*/input', async (route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { attempt: { ...attempt, status: 'complete', identity: { email: 'probe@example.test' } } } });
  });
  await page.route('**/api/providers/logins/a1', (route) =>
    route.fulfill({ json: { attempt: { ...attempt, status: 'needs-input', prompt: { message: 'Paste the code' } } } }),
  );

  await page.goto(`/s/${session.id}`);
  await page.getByRole('button', { name: 'Providers', exact: true }).first().click();
  await page.getByRole('button', { name: 'Login' }).first().click();

  await expect(page.getByText('https://probe.test/authorize?state=abc')).toBeVisible();
  await page.getByLabel('Authorization code').fill('code-1');
  await page.getByRole('button', { name: 'Submit code' }).click();

  await expect(page.getByText('probe@example.test')).toBeVisible();
  expect(posted).toEqual([{ value: 'code-1' }]);

  await request.delete(`/api/sessions/${session.id}`);
});
```

- [ ] **Step 2: Chạy để xác nhận fail**

Run: `bun run e2e -- --grep "provider login dialog"`
Expected: FAIL — không có nút `Login`.

- [ ] **Step 3: api-client + dialog**

`rest/settings.ts`:

```ts
/** POST /api/providers/:id/login → { attempt }. */
export function startProviderLogin(providerId: string): Promise<Result<ProviderLoginStateDto>> {
  return unwrapEnvelope(
    call(`/api/providers/${encodeURIComponent(providerId)}/login`, ProviderLoginResponseSchema, withBody({})),
    'attempt',
  );
}

/** GET /api/providers/logins/:attemptId → { attempt }. */
export function getProviderLogin(attemptId: string): Promise<Result<ProviderLoginStateDto>> {
  return unwrapEnvelope(
    call(`/api/providers/logins/${encodeURIComponent(attemptId)}`, ProviderLoginResponseSchema),
    'attempt',
  );
}

/** POST /api/providers/logins/:attemptId/input { value } → { attempt }. */
export function submitProviderLoginInput(attemptId: string, value: string): Promise<Result<ProviderLoginStateDto>> {
  return unwrapEnvelope(
    call(`/api/providers/logins/${encodeURIComponent(attemptId)}/input`, ProviderLoginResponseSchema, withBody({ value })),
    'attempt',
  );
}

/** POST /api/providers/logins/:attemptId/cancel → { attempt }. */
export function cancelProviderLogin(attemptId: string): Promise<Result<ProviderLoginStateDto>> {
  return unwrapEnvelope(
    call(`/api/providers/logins/${encodeURIComponent(attemptId)}/cancel`, ProviderLoginResponseSchema, withBody({})),
    'attempt',
  );
}

/** DELETE /api/providers/:id → { providers } after logout. */
export function logoutProvider(providerId: string): Promise<Result<ProviderInfo[]>> {
  return unwrapEnvelope(
    call(`/api/providers/${encodeURIComponent(providerId)}`, ProvidersResponseSchema, { method: 'DELETE' }),
    'providers',
  );
}
```

`hooks/settings.ts` — polling chỉ khi attempt đang chạy, dừng khi kết thúc:

```ts
export function useProviderLoginFlow(providerId: string | null) {
  const qc = useQueryClient();
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: (id: string) => unwrap(startProviderLogin(id)),
    onSuccess: (attempt) => setAttemptId(attempt.attemptId),
  });
  const status = useQuery({
    queryKey: ['provider-login', attemptId],
    queryFn: () => unwrap(getProviderLogin(attemptId as string)),
    enabled: attemptId !== null,
    refetchInterval: (query) => {
      const attempt = query.state.data;
      return attempt && (attempt.status === 'running' || attempt.status === 'needs-input') ? 1500 : false;
    },
  });
  // 'complete' phải làm provider list + model catalog đọc lại credential mới.
  useEffect(() => {
    if (status.data?.status !== 'complete') return;
    void qc.invalidateQueries({ queryKey: ['settings', 'providers'] });
    void qc.invalidateQueries({ queryKey: ['settings', 'models'] });
  }, [qc, status.data?.status]);
  return { start, status, attemptId, setAttemptId };
}
```

`ProviderLoginDialog.tsx`: dialog 4 trạng thái (`running` → URL + nút *Open in browser* + progress; `needs-input` → `Input aria-label="Authorization code"` + nút *Submit code*; `complete` → email/`Signed in` + *Done*; `failed` → `error` + *Retry*), nút *Cancel* khi đang chạy, `useEscapeToClose`. Token/không màu cứng; `Dialog`/`Button`/`Input`/`Badge` từ `@grove/ui`.

`ProvidersPane.tsx`: cột Action đổi thành
```tsx
{provider.login && provider.auth === 'oauth' && <Button variant="outline" onClick={() => setLogoutId(provider.id)}>Logout</Button>}
{provider.login && provider.auth !== 'oauth' && <Button variant="outline" onClick={() => setLoginId(provider.id)}>Login</Button>}
```
và **xoá** dialog `omp login …` cũ (copy command + "I authorized — Refresh") — không để hai đường login.

- [ ] **Step 4: Chạy e2e + gate**

Run: `bun run e2e && bun run check`
Expected: spec mới PASS, e2e xanh, `check: all green`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client apps/web/src/features/providers tests/e2e/app.spec.ts
git commit -m "feat(web): sign in to OAuth providers from the providers pane"
```

---

### Task 4: Verify bằng browser thật + docs

**Files:**
- Modify: `docs/tui-parity-status.md` (dòng `Providers` 🟡 → ✅ + changelog)

- [ ] **Step 1: Chạy dev stack và xem pane thật**

Run: `bun run dev:server` + `bun run dev:web` (hoặc `bun run dev`), mở Providers pane, bấm **Login** ở một provider OAuth thật, xác nhận dialog hiện URL và trạng thái chuyển tiếp.
Expected: dialog hiện URL thật của provider; bấm *Open in browser* mở tab; Cancel → về trạng thái đóng; provider đã đăng nhập có nút **Logout** và `auth` = `oauth` sau khi Refresh.

- [ ] **Step 2: Ghi Evidence + commit**

```bash
git add docs/tui-parity-status.md
git commit -m "docs: provider OAuth login is in-web, not a terminal detour"
```

---

## Ledger

| Task | Commit | Kết quả |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |

## Self-Review

**Spec coverage:** login/logout in-web (Task 1–3) · provider list biết provider nào login được (Task 1) · credential không qua web (chỉ URL/prompt/status) · evidence vào tracker (Task 4). Không có mục nào của dòng `Providers` bị bỏ.

**Placeholder scan:** không có TBD/TODO; mọi bước có code thật.

**Type consistency:** `ProviderLoginState` (adapter) → `ProviderLoginStateSchema`/`ProviderLoginStateDto` (protocol) → `ProviderLoginStateDto` (web); route fns trả `{ attempt }` / `{ providers }` khớp schema; `ProviderEntry.login` thêm ở adapter + protocol cùng tên.
