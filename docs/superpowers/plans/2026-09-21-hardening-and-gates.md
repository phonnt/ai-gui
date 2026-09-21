# Hardening & Gate Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three highest-risk findings from the 2026-09-21 five-slice sweep (loopback trust, fail-open approvals, secret leak into tool shells), get the dependency audit to zero, and make CI cover the two paths it never runs (production web build, dependency audit).

**Architecture:** `apps/server` is a single `Bun.serve` on `127.0.0.1` with a hand-rolled regex router; `packages/omp-adapter` is the only OMP integration (SDK pinned exactly). Security fixes land as pure, unit-tested helpers in the modules that already own that concern (`auth.ts` for request trust, `tool-helpers.ts` for tool process env) plus one line of wiring each. CI changes extend `ci.yml`; no new workflow.

**Tech Stack:** Bun ≥ 1.3.14, TypeScript strict, Biome, `bun test`, OMP SDK `@oh-my-pi/pi-coding-agent`, GitHub Actions.

**Spec:** No design doc exists for this pass; the source is the sweep report captured in this session and the defect history in `docs/tui-parity-status.md` §10. Where the plan and that report disagree, the report wins.

## Global Constraints

- `bun run check` must be green before every commit (typecheck + Biome + `bun test` + server smoke). No new JS files — TypeScript strict only.
- TDD order per task: write the failing test, watch it fail, implement, watch it pass, commit.
- The server binds `127.0.0.1` (`apps/server/src/index.ts:291-293`) and the desktop webview reaches it at `127.0.0.1:<port>`; anything that changes request trust must keep these working: vite dev proxy (`apps/web/vite.config.ts:41-48`, `changeOrigin: true` → `Host: localhost:8787`), `bun scripts/smoke-server.ts`, Playwright e2e (`localhost:5199` → proxy), and the packaged sidecar.
- `tools.approvalMode` keeps OMP's documented default `yolo` (`omp://settings.md:513`); only *invalid* explicit values change behaviour.
- SDK pin lives in `packages/omp-adapter/package.json` (currently `"18.1.11"`, exact); bumping it is the only way to drop the transitive advisories.
- No secrets in the repo; `.env` is git-ignored and loaded automatically by Bun.

## Review Focus

Inputs and conditions the tasks below do not test, most likely to bite a user first:

1. A reverse proxy or SSH tunnel in front of the server (Host header not loopback) — the Host gate will refuse it; the runbook must say so.
2. A user who typo'd `tools.approvalMode` in `settings.json` — after this plan they get `always-ask` prompts they did not expect; the UI must still show them (approval bridge is wired).
3. A tool command that legitimately needs `GROVE_TOKEN` (a nested Grove call) — the sanitizer removes it; the caller can pass it back explicitly via the per-call `env` parameter.
4. In-turn bash (SDK-owned, not our spawn) still inherits the server env — out of reach here; must be stated as a known limit rather than implied fixed.
5. Windows PowerShell line endings/permissions on any file this plan edits under `scripts/` — keep edits ASCII and LF.

---

### Task 1: Refuse non-loopback Host headers

**Files:**
- Modify: `apps/server/src/auth.ts` (add `isLoopbackHost`)
- Modify: `apps/server/src/index.ts:294` (fetch handler, first statement)
- Test: `apps/server/src/auth.test.ts`

**Interfaces:**
- Produces: `isLoopbackHost(header: string | null | undefined): boolean` — exact-match on the hostname (port and brackets tolerated), no suffix matching.

- [ ] **Step 1: Write the failing test** — append to `apps/server/src/auth.test.ts` (import `isLoopbackHost` in the existing import block):

```ts
describe('isLoopbackHost', () => {
  test('accepts the loopback names the app uses', () => {
    expect(isLoopbackHost('127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHost('localhost:5173')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('[::1]:8787')).toBe(true);
  });

  test('rejects everything else, including lookalikes', () => {
    expect(isLoopbackHost('10.0.0.5:8787')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `bun test apps/server/src/auth.test.ts` → FAIL (`isLoopbackHost` is not exported).

- [ ] **Step 3: Implement** — in `apps/server/src/auth.ts`:

```ts
/**
 * Hostnames allowed to reach this server. The server binds 127.0.0.1 and hands
 * its token cookie to any anonymous `GET /`, so the Host header — not the token
 * — is what stops a page that rebinds a hostname to the loopback address from
 * talking to the API as if it were the desktop webview.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** True when the Host header names the loopback interface (port ignored). */
export function isLoopbackHost(header: string | null | undefined): boolean {
  if (!header) return false;
  const trimmed = header.trim().toLowerCase();
  const host = trimmed.startsWith('[')
    ? trimmed.slice(0, trimmed.indexOf(']') + 1)
    : (trimmed.split(':')[0] ?? '');
  return LOOPBACK_HOSTS.has(host);
}
```

- [ ] **Step 4: Run it, watch it pass** — `bun test apps/server/src/auth.test.ts` → PASS.

- [ ] **Step 5: Wire it into the fetch handler** — `apps/server/src/index.ts`, inside `fetch: async (req, server) => {` immediately after `const url = new URL(req.url);`:

```ts
      // Loopback-only Host gate: see isLoopbackHost(). A request that arrived
      // with a foreign Host (reverse proxy, DNS rebinding) never reaches auth.
      if (!isLoopbackHost(req.headers.get('host'))) {
        return new Response('forbidden host', { status: 403 });
      }
```
Add `isLoopbackHost` to the existing `./auth.js` import list.

- [ ] **Step 6: Prove the real paths still work and the gate bites**

Run: `bun run smoke:server` → Expected: `server smoke OK`.
Run: `bun run e2e` → Expected: 9 passed.
Run (dev stack via `hub start` or two terminals): `curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:8787/api/health` → Expected: `403`; the same request without the Host override → `200`.

- [ ] **Step 7: Commit** — `git add apps/server/src/auth.ts apps/server/src/auth.test.ts apps/server/src/index.ts && git commit -m "fix(server): refuse non-loopback Host headers"`

---

### Task 2: Fail closed on an unrecognised approval mode

**Files:**
- Modify: `packages/omp-adapter/src/tools.ts:315-317` (`normalizeApprovalMode`)
- Test: `packages/omp-adapter/src/tool-helpers.test.ts` — new file `approval-mode.test.ts` if importing from `tools.ts` pulls SDK weight at test time; try `tools.ts` first.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `normalizeApprovalMode(value: unknown): ApprovalMode` (already exists; behaviour changes for invalid values only).

- [ ] **Step 1: Write the failing test** — new `packages/omp-adapter/src/approval-mode.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { normalizeApprovalMode } from './tools';

describe('normalizeApprovalMode', () => {
  test('keeps the three documented values', () => {
    expect(normalizeApprovalMode('always-ask')).toBe('always-ask');
    expect(normalizeApprovalMode('write')).toBe('write');
    expect(normalizeApprovalMode('yolo')).toBe('yolo');
  });

  test("an absent value keeps OMP's documented yolo default", () => {
    expect(normalizeApprovalMode(undefined)).toBe('yolo');
  });

  test('a typo fails closed instead of disabling every prompt', () => {
    expect(normalizeApprovalMode('alwais-ask')).toBe('always-ask');
    expect(normalizeApprovalMode(42)).toBe('always-ask');
    expect(normalizeApprovalMode(null)).toBe('always-ask');
  });
});
```

- [ ] **Step 2: Run it, watch the third case fail** — `bun test packages/omp-adapter/src/approval-mode.test.ts` → FAIL (`'alwais-ask'` → `'yolo'`). If the import of `tools.ts` explodes (SDK side effects), move the test next to `tool-helpers.test.ts` and export the helper from `tool-helpers.ts` instead — record that as a ruling.

- [ ] **Step 3: Implement**:

```ts
function normalizeApprovalMode(value: unknown): ApprovalMode {
  if (value === 'always-ask' || value === 'write' || value === 'yolo') return value;
  // Absent keeps OMP's documented default (yolo); anything else unrecognised is
  // a typo, and silently reading it as yolo would disable every approval prompt.
  return value === undefined ? 'yolo' : 'always-ask';
}
```

- [ ] **Step 4: Run it, watch it pass** — same command → PASS.

- [ ] **Step 5: Commit** — `git add packages/omp-adapter/src/tools.ts packages/omp-adapter/src/approval-mode.test.ts && git commit -m "fix(adapter): fail closed on an unrecognised approval mode"`

---

### Task 3: Keep the gateway token out of tool-spawned shells

**Files:**
- Modify: `packages/omp-adapter/src/tool-helpers.ts` (add `toolShellEnv`), `packages/omp-adapter/src/tools.ts:963-964` (use it)
- Test: `packages/omp-adapter/src/tool-helpers.test.ts`

**Interfaces:**
- Produces: `toolShellEnv(base: Record<string, string | undefined>, extra?: Record<string, string>): Record<string, string | undefined>`.

- [ ] **Step 1: Write the failing test** — append to `packages/omp-adapter/src/tool-helpers.test.ts`:

```ts
describe('toolShellEnv', () => {
  test('drops the gateway token and keeps the rest of the environment', () => {
    const env = toolShellEnv({ GROVE_TOKEN: 'secret', PATH: '/usr/bin', HOME: '/home/u' });
    expect(env.GROVE_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
  });

  test('a per-call env value wins, including an explicit token', () => {
    const env = toolShellEnv({ PATH: '/usr/bin' }, { PATH: '/opt/bin', GROVE_TOKEN: 'explicit' });
    expect(env.PATH).toBe('/opt/bin');
    expect(env.GROVE_TOKEN).toBe('explicit');
  });
});
```

- [ ] **Step 2: Run it, watch it fail** — `bun test packages/omp-adapter/src/tool-helpers.test.ts` → FAIL (`toolShellEnv` not exported).

- [ ] **Step 3: Implement** — in `packages/omp-adapter/src/tool-helpers.ts`:

```ts
/**
 * Environment for a shell this server spawns on the user's behalf: the ambient
 * environment minus the gateway's own secret. `GROVE_TOKEN` authenticates
 * `/api/*`, so a command that can read the environment (or echo it back to the
 * model) must not receive it. An explicit per-call value still wins — a caller
 * that really wants the token can pass it.
 */
export function toolShellEnv(
  base: Record<string, string | undefined>,
  extra?: Record<string, string>,
): Record<string, string | undefined> {
  const env = { ...base };
  delete env.GROVE_TOKEN;
  return { ...env, ...(extra ?? {}) };
}
```

- [ ] **Step 4: Run it, watch it pass** — same command → PASS.

- [ ] **Step 5: Use it at the spawn site** — `packages/omp-adapter/src/tools.ts:964` becomes `env: toolShellEnv(process.env, input.env)`, importing `toolShellEnv` from `./tool-helpers.js` (already imported from there — extend the list).

- [ ] **Step 6: Prove the tool still runs** — `bun run check` → all green; then with the dev server up: `curl -s -X POST http://127.0.0.1:8787/api/sessions/<id>/bash -H 'content-type: application/json' -d '{"command":"echo TOKEN=[$GROVE_TOKEN]"}'` → Expected: output `TOKEN=[]`.

- [ ] **Step 7: Commit** — `git add packages/omp-adapter/src/tool-helpers.ts packages/omp-adapter/src/tools.ts packages/omp-adapter/src/tool-helpers.test.ts && git commit -m "fix(adapter): keep the gateway token out of tool shells"`

---

### Task 4: Bump the OMP SDK to drop the transitive advisories

**Files:**
- Modify: `packages/omp-adapter/package.json:11`, `bun.lock`

**Interfaces:**
- Consumes: nothing. Produces: the pinned SDK version every later task is verified against.

- [ ] **Step 1: Confirm the advisories belong to the pin** — `bun audit` → Expected: `5 vulnerabilities (4 high, 1 moderate)` naming `adm-zip <0.6.0` and `sharp <0.35.0` under `@oh-my-pi/pi-coding-agent`.
- [ ] **Step 2: Bump** — set `"@oh-my-pi/pi-coding-agent": "18.2.7"` in `packages/omp-adapter/package.json`, then `bun install`.
- [ ] **Step 3: Audit again** — `bun audit` → Expected: `0 vulnerabilities` (18.2.7 has neither `adm-zip` nor `sharp` in `dependencies`/`optionalDependencies`).
- [ ] **Step 4: Prove the adapter still compiles and behaves** — `bun run check` → green (typecheck catches any subpath export that moved); `bun run e2e` → 9 passed; `bun run smoke:sidecar` → `sidecar smoke OK`.
- [ ] **Step 5: Prove the paths this session fixed still work** (dev server up, one session): `GET /api/plugins` lists `superpowers`; `POST /thinking {"level":"banana"}` → 400; `POST /thinking {"level":"off"}` → 200 and `GET /model` thinking `off`; `GET /api/sessions/<new>/jobs` → 200, unknown id → 404; `POST /export` on an empty session → 400 with "no journal yet".
- [ ] **Step 6: Commit** — `git add packages/omp-adapter/package.json bun.lock && git commit -m "chore(deps): bump the OMP SDK to 18.2.7 (clears 5 advisories)"`

---

### Task 5: CI builds the web app for production and typechecks its config

**Files:**
- Modify: `apps/web/tsconfig.json` (`include`), `.github/workflows/ci.yml` (check job)

**Interfaces:** none.

- [ ] **Step 1: Prove the gap is real** — `grep -rn 'filter @grove/web build' .github/workflows/ scripts/` → Expected: only `scripts/build-desktop.ts:60`.
- [ ] **Step 2: Typecheck the config** — `apps/web/tsconfig.json`: `"include": ["src", "vite.config.ts"]`; run `bun run typecheck` → Expected: PASS (it currently passes because the file is ignored; a passing run here means the file is clean, not that it was checked — confirm by temporarily introducing a type error in `vite.config.ts` and seeing it fail, then revert).
- [ ] **Step 3: Add the build step** — in `.github/workflows/ci.yml`, after the `Check` step:

```yaml
      - name: Production web build
        run: bun run --filter @grove/web build
```
- [ ] **Step 4: Verify locally** — `bun run --filter @grove/web build` → Expected: `built in …`, chunks listed, exit 0.
- [ ] **Step 5: Commit** — `git add apps/web/tsconfig.json .github/workflows/ci.yml && git commit -m "ci: build the web app and typecheck its vite config"`

---

### Task 6: A dependency-audit gate CI can fail on

**Files:**
- Create: `scripts/audit.ts`, `scripts/audit.test.ts`
- Modify: `package.json` (`audit` script), `.github/workflows/ci.yml` (step)

**Interfaces:**
- Produces: `summarizeAudit(report: unknown): { total: number; blocking: number; bySeverity: Record<string, number> }` and a CLI that exits 1 when `blocking > 0`.

- [ ] **Step 1: Write the failing test** — `scripts/audit.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { summarizeAudit } from './audit';

describe('summarizeAudit', () => {
  test('counts severities and blocks on high and critical', () => {
    const report = {
      advisories: {
        a: { severity: 'high' },
        b: { severity: 'moderate' },
        c: { severity: 'critical' },
        d: { severity: 'low' },
      },
    };
    expect(summarizeAudit(report)).toEqual({
      total: 4,
      blocking: 2,
      bySeverity: { critical: 1, high: 1, moderate: 1, low: 1 },
    });
  });

  test('an empty report blocks nothing', () => {
    expect(summarizeAudit({ advisories: {} })).toEqual({ total: 0, blocking: 0, bySeverity: {} });
  });
});
```
- [ ] **Step 2: Run it, watch it fail** — `bun test scripts/audit.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `scripts/audit.ts`** — a CLI that runs `bun audit --json`, parses via `summarizeAudit`, prints a one-line summary, and exits 1 when `blocking > 0`. Tolerate a non-JSON/empty stdout (older Bun, no lockfile) by printing a warning and exiting 0 — the gate must not fail on tool unavailability. Read the real JSON shape from `bun audit --json` output during implementation rather than guessing key names; the parser handles an unknown shape by returning zeros **and** the CLI then warns loudly instead of silently passing.
- [ ] **Step 4: Run the test, then the CLI** — `bun test scripts/audit.test.ts` → PASS; `bun run audit` → Expected (after Task 4): exit 0 with `0 advisory`.
- [ ] **Step 5: Wire CI** — `.github/workflows/ci.yml`, check job, after the installer assertions:
```yaml
      - name: Dependency audit
        run: bun run audit
```
and add `"audit": "bun scripts/audit.ts"` to `package.json` scripts.
- [ ] **Step 6: Commit** — `git add scripts/audit.ts scripts/audit.test.ts package.json .github/workflows/ci.yml && git commit -m "ci: gate on dependency advisories"`

---

### Task 7: Correct the documentation the sweep proved wrong

**Files:**
- Modify: `AGENTS.md:22` (desktop "chưa scaffold"), `AGENTS.md:65` (`packages/types`)
- Modify: `docs/architecture.md:17-22`, `:60` (`packages/gateway`/`api-client`/`types`, `omp --mode rpc` per session)
- Modify: `docs/runbook.md:28` (`.env` not read), `:55` (bind address), `:58` (`rpc` child)
- Modify: `docs/design-system.md` (state it is a reference, point to the real tokens)
- Modify: `README.md` (only if a claim is disproved during the edit)

**Interfaces:** none.

- [ ] **Step 1: Re-verify every claim before editing** — `Bun` loads `.env` (proved: `GROVE_PORT` from `.env` is visible to `bun -e` and `bun file.ts`); the server binds `127.0.0.1` (`index.ts:291-293`); no `packages/gateway|api-client|types` exist (`ls packages/`); no `omp --mode rpc` child exists (`grep -rn "mode rpc" apps packages` → only docs).
- [ ] **Step 2: Edit each file so the statement matches the code**, keeping the historical sections that are explicitly labelled as history (`docs/architecture.md` §9b, `docs/superpowers/**`) untouched.
- [ ] **Step 3: Note the Host gate** — add one line to `docs/runbook.md` § "Production notes": the server now refuses non-loopback `Host` headers, so a reverse proxy/SSH tunnel must forward `Host: 127.0.0.1:<port>` (links the Review Focus item 1).
- [ ] **Step 4: Verify no stale claim survives** — `grep -rn "chưa scaffold\|packages/gateway\|packages/api-client\|packages/types\|mode rpc child\|No \`.env\` file is read\|all interfaces" AGENTS.md README.md docs/*.md` → Expected: only history-labelled sections or the new explanatory lines.
- [ ] **Step 5: Commit** — `git add AGENTS.md docs && git commit -m "docs: correct claims the sweep disproved"`

---

## Self-Review

**Spec coverage:** the sweep's P1 items → Tasks 1–4; P2 build/audit gaps → Tasks 5–6; docs drift → Task 7; P3 structural debt (god files, dead exports, UI dedupe) is deliberately **out of scope** — it needs its own plan and a product decision.

**Placeholder scan:** no TBD/TODO; every code step carries the code; Task 6 Step 3 is the one step whose exact JSON keys must be read from the tool during implementation — flagged in-step with the fallback behaviour.

**Type consistency:** `isLoopbackHost(string|null|undefined): boolean`, `normalizeApprovalMode(unknown): ApprovalMode`, `toolShellEnv(Record<string,string|undefined>, Record<string,string>?)`, `summarizeAudit(unknown) → {total, blocking, bySeverity}` — each defined once, consumed once.

**Review Focus:** item 1 → Task 7 Step 3; item 2 → Task 2 (test asserts prompts are not disabled; the UI path is unchanged); item 3 → Task 3 test; item 4 → Task 7 (known-limit note in the runbook); item 5 → no task edits Windows-sensitive files; keep LF.
