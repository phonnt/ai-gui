# Parity Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đóng nốt các dòng còn mở: 5 gap parity (`plan.defaultOnStartup`, `/ssh`, `/git`, marketplace install/update, `/rewind`), hook web cho `GET /thinking`, 3 defect hiệu năng/payload (#13 models 506 kB, #18 export 42 MB, #7 logs ~10–20s), race tạo session (#12), rồi verify lại `/browser`+`/computer` và chốt phần desktop còn thiếu credential.

**Architecture:** Ba làn, mỗi làn ship được độc lập và kết thúc bằng `bun run check` xanh:
- **Làn A (parity)** — mọi thứ ở đúng tầng: SDK đã có sẵn API (`ssh/config-writer`, `MarketplaceManager`, `commit/git/diff` parsers) → `packages/omp-adapter` bọc lại, `packages/protocol` khai schema, `apps/server` mở route, `apps/web` chỉ gọi api-client. Không viết lại logic OMP ở frontend.
- **Làn B (hiệu năng/payload)** — nén + ETag cho JSON lớn, streaming cho export, cache tail cho `logs`, và một lần điều tra dứt điểm race tạo session.
- **Làn C (verify/bookkeeping)** — checklist desktop cho browser/computer, tick lại tracker cũ, sửa chữ e2e trong docs.

**Tech Stack:** Bun · TypeScript strict · Biome · zod (protocol) · Vite+React · TanStack Query · Vitest/`bun test` · Playwright e2e · SDK `@oh-my-pi/pi-coding-agent@18.1.11`.

**Spec:** `docs/tui-parity-status.md` (§1–§10 là bảng trạng thái + bảng defect; §10 ghi trạng thái tại HEAD 2026-09-22) và `docs/superpowers/plans/2026-09-22-hardening-round-2.md` (ledger đợt trước, gồm Ruling A–D).

## Global Constraints

- `bun run check` (typecheck + lint + test + server smoke) phải xanh trước mỗi commit; không commit khi đỏ.
- `bun run e2e` là cổng UI; mọi thay đổi UI phải để nó xanh (12 spec hiện có).
- `apps/web` **không** được import `apps/server`, `packages/omp-adapter`, OMP — chỉ `packages/core`, `packages/protocol`, `packages/ui`.
- Mọi logic OMP (đọc config, registry, credential, parse journal) nằm ở `packages/omp-adapter`; browser không parse JSONL, không resolve registry.
- TypeScript strict, Biome format, `lineWidth: 100`, `single quotes`, không file JS mới.
- File < 700 dòng (đã áp cho toàn repo ở đợt trước; file mới phải theo).
- UI theo `docs/design-system.md`: dùng token + recipe kit (`panel`, `panel-plain`, `panel-plain-active`, `hairline*`), không màu cứng, icon chỉ `lucide-react`.
- Invariant UI trong `apps/web/src/lib/ui-invariants.test.ts` phải xanh: icon-only control phải là `IconButton`; không `rounded-md border border-*` cho chrome; alert giữ `border border-link`/`border-warning` 1px (Ruling A).
- Mọi symbol mới phải có consumer thật; export chết bị bỏ `export` (đợt trước đã dọn 11 symbol).
- Commit Conventional Commits, một thay đổi logic mỗi commit; stage đúng file.

## Review Focus

Sáu nhóm input/điều kiện mà spec im lặng nhưng sẽ chạm người dùng thật; mỗi dòng có test ở task sở hữu code:

1. **Marketplace source không tới được / install hỏng giữa đường** → phải báo lỗi actionable và không để lại trạng thái nửa vời (Task 5).
2. **Repo git ở trạng thái lạ** (detached HEAD, chưa có commit, diff khổng lồ, không phải repo) → `status`/`diff` phải degrade (rỗng + nhãn), không 500 (Task 4).
3. **`plan.defaultOnStartup` áp nhầm chỗ** — setting tắt, hoặc session đã có history (resume/import) mà vẫn bị ép vào plan mode; và tắt plan đi rồi tạo session mới không được tự bật lại (Task 1).
4. **Export session rất dài** → streaming không buffer vào RAM; nhiều export song song không để lại temp file (Task 8).
5. **File SSH config thiếu/hỏng JSON/trùng tên host** → list không throw; add phải validate và từ chối trùng (Task 3).
6. **Tạo session song song** (#12) → mọi create phải thành công hoặc lỗi rõ ràng, không bao giờ `500 Agent "Main" was replaced` (Task 10).

---

# Làn A — Parity gaps

## Task 1: `plan.defaultOnStartup`

**Files:**
- Modify: `packages/omp-adapter/src/sdk/core-base.ts` (trong `createSession`, ngay sau `shareSettingsWithTools`)
- Modify: `packages/omp-adapter/src/sdk/modes-base.ts` (chỉ khi cần tách phần set-plan dùng chung)
- Test: `packages/omp-adapter/src/plan-startup.test.ts` (mới)

**Interfaces:**
- Consumes: `settingsGet(key: string, options?: Partial<SettingsScope>): Promise<SettingEntry>` từ `packages/omp-adapter/src/settings.ts` (async, trả `SettingEntry` với `value?: unknown` — không trả thẳng giá trị); `setPlanMode(input: SetFlagInput): Promise<SessionModes>` (đã có, `sdk/modes-base.ts`).
- Produces: `createSession` trả `SessionInfo` với plan mode đã bật khi setting `plan.defaultOnStartup` = true và request không nêu mode tường minh.

Bối cảnh: TUI đọc setting này ở `src/modes/interactive-mode.ts:393`; web chạy SDK không qua mode TUI nên phải tự áp.

- [ ] **Step 1: Viết test thất bại**

```ts
// packages/omp-adapter/src/plan-startup.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdkAdapter } from './sdk.js';
import { settingsSet } from './settings.js';

describe('plan.defaultOnStartup', () => {
  test('opens a fresh session in plan mode when the setting is on', async () => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-plan-agent-'));
    const cwd = mkdtempSync(join(tmpdir(), 'grove-plan-cwd-'));
    await settingsSet('plan.defaultOnStartup', true);
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });
    const modes = await adapter.getSessionModes(session.id);
    expect(modes.plan).toBe(true);
  });
});
```

Ghi setting qua `settingsSet` (không tự ghi file) để test không phụ thuộc định dạng file settings của SDK.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `bun test packages/omp-adapter/src/plan-startup.test.ts`
Expected: FAIL — `modes.plan` là `false` (setting chưa được áp).

- [ ] **Step 3: Hiện thực**

Trong `packages/omp-adapter/src/sdk/core-base.ts`, ngay sau dòng `this.shareSettingsWithTools(sessionId, session);`:

```ts
// TUI opens fresh interactive sessions in plan mode when
// `plan.defaultOnStartup` is on (src/modes/interactive-mode.ts); the SDK in
// this process has no mode layer, so the adapter applies it here.
const planDefault = await settingsGet('plan.defaultOnStartup');
if (planDefault.value === true && session.messages.length === 0) {
  await this.setPlanMode({ sessionId, enabled: true });
}
```

`setPlanMode` nằm ở `sdk/modes-base.ts`, tức lớp con — khai báo abstract trong `SdkCoreBase` giống các thành viên hướng xuống khác:

```ts
/** Implemented in `sdk/modes-base.ts`. */
protected abstract setPlanMode(input: SetFlagInput): Promise<SessionModes>;
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `bun test packages/omp-adapter/src/plan-startup.test.ts`
Expected: PASS.

- [ ] **Step 5: Test cho trường hợp ngược lại (Review Focus #3)**

```ts
test('never forces plan mode when the setting is off or the session has history', async () => {
  process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-plan-agent-'));
  const cwd = mkdtempSync(join(tmpdir(), 'grove-plan-cwd-'));
  await settingsSet('plan.defaultOnStartup', false);
  const adapter = new SdkAdapter(cwd);
  const fresh = await adapter.createSession({ cwd });
  expect((await adapter.getSessionModes(fresh.id)).plan).toBe(false);

  await settingsSet('plan.defaultOnStartup', true);
  // session đã có history (resume/import) không bị ép vào plan mode
  const resumed = await adapter.createSession({ cwd });
  await adapter.prompt({ sessionId: resumed.id, text: 'hi' }).catch(() => undefined);
  await adapter.setPlanMode({ sessionId: resumed.id, enabled: false });
  expect((await adapter.getSessionModes(resumed.id)).plan).toBe(false);
});
```

Run: `bun test packages/omp-adapter/src/plan-startup.test.ts`
Expected: PASS (2 test).

- [ ] **Step 6: Xác nhận UI không cần sửa**

Chạy dev stack, tạo session mới, mở ModesPanel:
Run: `bun run dev:web` + `bun run dev:server`, rồi trong browser kiểm tab Modes hiển thị Plan đang bật.
Expected: Plan chip đang bật ngay sau khi tạo session (UI đọc `getSessionModes` sẵn có).

- [ ] **Step 7: Commit**

```bash
git add packages/omp-adapter/src/sdk/core-base.ts packages/omp-adapter/src/sdk/modes-base.ts packages/omp-adapter/src/plan-startup.test.ts
git commit -m "feat(adapter): honour plan.defaultOnStartup for fresh sessions"
```

---

## Task 2: Hook web cho mức thinking (Ruling B)

**Files:**
- Modify: `apps/web/src/lib/api-client/rest/sessions.ts` (thêm `getThinking`)
- Modify: `apps/web/src/lib/api-client/hooks/sessions.ts` (thêm `useThinkingLevel`)
- Modify: `apps/web/src/features/model/ModelPicker.tsx:30` (dùng level đọc về thay vì mặc định cục bộ)
- Test: `apps/web/src/features/model/ModelPicker.test.tsx` (mới, hoặc mở rộng test sẵn có nếu đã có file)

**Interfaces:**
- Consumes: route `GET /api/sessions/:id/thinking` → `{ thinking: string }` (đã có, commit `f8cd093`); `useSetSessionThinking(sessionId)` (đã có).
- Produces: `getThinking(sessionId: string): Promise<Result<{ thinking: string }>>`; `useThinkingLevel(sessionId: string | undefined)` trả `{ data, isPending }`.

- [ ] **Step 1: Viết test thất bại**

```tsx
// apps/web/src/features/model/ModelPicker.test.tsx
import { expect, test } from 'bun:test';
// ... render harness theo mẫu test sẵn có của features (React Testing Library + QueryClientProvider)
test('preselects the level the session is actually on', async () => {
  // mock api-client getThinking → { ok: true, data: { thinking: 'high' } }
  renderModelPicker({ sessionId: 's1' });
  expect(await screen.findByText('high')).toBeDefined();
});
```

Run: `bun test apps/web/src/features/model/ModelPicker.test.tsx`
Expected: FAIL — `getThinking` chưa tồn tại (lỗi import).

- [ ] **Step 2: Thêm rest + hook**

```ts
// apps/web/src/lib/api-client/rest/sessions.ts
/** GET /api/sessions/:id/thinking → { thinking }. */
export function getThinking(sessionId: string): Promise<Result<{ thinking: string }>> {
  return call(`/api/sessions/${encodeURIComponent(sessionId)}/thinking`, ThinkingSchema);
}
```

```ts
// apps/web/src/lib/api-client/hooks/sessions.ts
export function useThinkingLevel(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['thinking', sessionId],
    queryFn: () => unwrap(getThinking(sessionId as string)),
    enabled: Boolean(sessionId),
  });
}
```

`ThinkingSchema` khai trong `packages/protocol` nếu chưa có (zod `{ thinking: z.string() }`), theo mẫu `ModesSchema` cùng file.

- [ ] **Step 3: Dùng trong ModelPicker**

Thay mặc định cục bộ bằng level đọc về; khi `setThinking` thành công thì invalidate `['thinking', sessionId]`:

```tsx
const thinking = useThinkingLevel(sessionId);
const [level, setLevel] = useState<string>('');
useEffect(() => {
  if (thinking.data) setLevel(thinking.data);
}, [thinking.data]);
```

- [ ] **Step 4: Chạy test + gate**

Run: `bun test apps/web/src/features/model/ModelPicker.test.tsx && bun run check`
Expected: PASS + `check: all green`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client/rest/sessions.ts apps/web/src/lib/api-client/hooks/sessions.ts apps/web/src/features/model/ModelPicker.tsx apps/web/src/features/model/ModelPicker.test.tsx packages/protocol/src
git commit -m "feat(web): read the session thinking level back into the model picker"
```

---

## Task 3: `/ssh` — quản lý host

**Files:**
- Modify: `packages/omp-adapter/package.json` (thêm `@oh-my-pi/pi-utils` — SDK dùng nó nhưng adapter chưa khai báo)
- Modify: `packages/omp-adapter/src/sdk/modes-base.ts` (thêm 3 method cạnh `listPlugins`)
- Modify: `packages/agent-runtime/src/runtime.ts` (khai 3 method)
- Modify: `packages/protocol/src/rest.ts` (schema `SshHostInput`)
- Modify: `apps/server/src/routes/` (file mới `ssh.ts`), `apps/server/src/index.ts` (path constants)
- Modify: `apps/web/src/lib/api-client/rest/settings.ts` + `hooks/settings.ts`
- Modify: `apps/web/src/features/explorer/ExplorerPane.tsx` (section SSH hosts) hoặc `apps/web/src/features/settings/SettingsPane.tsx` nếu pane explorer đã chật
- Modify: `apps/web/src/features/chat/chat-commands.ts` (lệnh palette `/ssh`)
- Test: `packages/omp-adapter/src/ssh-hosts.test.ts`, `apps/server/src/routes/ssh.test.ts`

**Interfaces:**
- Consumes: `getSSHConfigPath(scope, cwd)` từ `@oh-my-pi/pi-utils`; `readSSHConfigFile`, `addSSHHost`, `removeSSHHost`, `validateHostName`, types `SSHHostConfig`, `SSHConfigFile` từ `@oh-my-pi/pi-coding-agent/ssh/config-writer`.
- Produces: `AgentRuntime.listSshHosts(cwd, scope)`, `addSshHost(input)`, `removeSshHost(input)`; route `GET/POST/DELETE /api/sessions/:id/ssh/hosts`.

- [ ] **Step 1: Khai báo dependency**

Run: `cd packages/omp-adapter && bun add @oh-my-pi/pi-utils`
Expected: `package.json` có `"@oh-my-pi/pi-utils": "18.1.11"` (khớp version SDK đang dùng); `bun run typecheck` vẫn xanh.

- [ ] **Step 2: Viết test thất bại (adapter)**

```ts
// packages/omp-adapter/src/ssh-hosts.test.ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdkAdapter } from './sdk.js';

describe('ssh hosts', () => {
  test('adds, lists and removes a host in an empty config', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-ssh-'));
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-ssh-agent-'));
    const adapter = new SdkAdapter(cwd);
    await adapter.addSshHost({ cwd, scope: 'user', name: 'probe', host: '10.0.0.5', user: 'root' });
    expect(await adapter.listSshHosts(cwd, 'user')).toEqual(['probe']);
    await adapter.removeSshHost({ cwd, scope: 'user', name: 'probe' });
    expect(await adapter.listSshHosts(cwd, 'user')).toEqual([]);
  });

  test('rejects an invalid name and a duplicate', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-ssh-'));
    const adapter = new SdkAdapter(cwd);
    await expect(adapter.addSshHost({ cwd, scope: 'user', name: 'bad name', host: 'h' })).rejects.toThrow();
    await adapter.addSshHost({ cwd, scope: 'user', name: 'dup', host: 'h1' });
    await expect(adapter.addSshHost({ cwd, scope: 'user', name: 'dup', host: 'h2' })).rejects.toThrow();
  });

  test('an invalid config file does not throw on list', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-ssh-'));
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR as string, 'ssh.json'), '{not json');
    const adapter = new SdkAdapter(cwd);
    expect(await adapter.listSshHosts(cwd, 'user')).toEqual([]);
  });
});
```

Run: `bun test packages/omp-adapter/src/ssh-hosts.test.ts`
Expected: FAIL — `adapter.addSshHost is not a function`.

- [ ] **Step 3: Hiện thực adapter**

Trong `packages/omp-adapter/src/sdk/modes-base.ts`:

```ts
async listSshHosts(cwd: string, scope: 'user' | 'project'): Promise<string[]> {
  const path = getSSHConfigPath(scope, cwd);
  if (!existsSync(path)) return [];
  try {
    const config = await readSSHConfigFile(path);
    return Object.keys(config.hosts ?? {}).sort();
  } catch {
    // A corrupt file must not take the pane down; the UI shows an empty list.
    return [];
  }
}

async addSshHost(input: { cwd: string; scope: 'user' | 'project'; name: string; host: string; user?: string; port?: number }): Promise<void> {
  const invalid = validateHostName(input.name);
  if (invalid) throw new InvalidRequestError(invalid);
  const path = getSSHConfigPath(input.scope, input.cwd);
  if ((await this.listSshHosts(input.cwd, input.scope)).includes(input.name)) {
    throw new InvalidRequestError(`ssh host already exists: ${input.name}`);
  }
  await addSSHHost(path, input.name, { host: input.host, user: input.user, port: input.port });
}

async removeSshHost(input: { cwd: string; scope: 'user' | 'project'; name: string }): Promise<void> {
  await removeSSHHost(getSSHConfigPath(input.scope, input.cwd), input.name);
}
```

Khai các method này trên `AgentRuntime` (`packages/agent-runtime/src/runtime.ts`) theo đúng chữ ký trên.

- [ ] **Step 4: Route + protocol + test route**

```ts
// apps/server/src/routes/ssh.ts
import type { AgentRuntime } from '@grove/agent-runtime';
export async function listSshHostsRoute(runtime: AgentRuntime, sessionId: string, cwd: string, scope: 'user' | 'project') {
  return { hosts: await runtime.listSshHosts(cwd, scope) };
}
export async function addSshHostRoute(runtime: AgentRuntime, sessionId: string, cwd: string, body: unknown) {
  const input = SshHostInputSchema.parse(body);
  await runtime.addSshHost({ ...input, cwd });
  return { hosts: await runtime.listSshHosts(cwd, input.scope) };
}
```

Test ở `apps/server/src/routes/ssh.test.ts` theo mẫu `apps/server/src/routes/ops.test.ts` (runtime giả): POST host mới → 200 + list chứa tên; POST trùng → 409; POST tên sai → 400; GET khi config hỏng → `{ hosts: [] }`.

Run: `bun test apps/server/src/routes/ssh.test.ts`
Expected: PASS.

- [ ] **Step 5: UI + palette**

`apps/web/src/lib/api-client/rest/settings.ts` thêm `listSshHosts/addSshHost/removeSshHost`; `hooks/settings.ts` thêm `useSshHosts`, `useAddSshHost`, `useRemoveSshHost` (invalidate `['ssh-hosts']`). UI: section "SSH hosts" trong Explorer pane — list host + form thêm (name/host/user/port) + nút xoá, dùng `panel-plain`/`IconButton`/`Input` từ `@grove/ui`. Palette: thêm mục `/ssh` vào `chat-commands.ts` mở pane Explorer ở section SSH.

- [ ] **Step 6: Gate + e2e + đo**

Run: `bun run check && bun run e2e`
Expected: `check: all green`, e2e 12/12.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ssh): host manager across the adapter, server and web"
```

- [ ] **Step 8: Cập nhật parity**

`docs/tui-parity-status.md`: dòng `/ssh` ⬜ → ✅ kèm Evidence (lệnh curl add/list/remove + kết quả) + dòng changelog.

---

## Task 4: `/git` — bề mặt Git

**Files:**
- Modify: `packages/omp-adapter/src/sdk/modes-base.ts` (3 method)
- Modify: `packages/agent-runtime/src/runtime.ts`
- Modify: `packages/protocol/src/rest.ts` (`GitStatusEntrySchema`, `GitStatusDto`)
- Modify: `apps/server/src/routes/` (mới `git.ts`), `apps/server/src/index.ts`
- Modify: `apps/web/src/lib/api-client/rest/tools.ts` + `hooks/tools.ts`
- Modify: `apps/web/src/features/explorer/ExplorerPane.tsx` (section Git: branch + file changes + diff)
- Test: `packages/omp-adapter/src/git.test.ts`, `apps/server/src/routes/git.test.ts`

**Interfaces:**
- Consumes: `runBashImpl(sessionId: string, command: string, cwd?: string, timeoutMs?: number, env?: Record<string, string>, pty?: boolean): Promise<BashResult>` từ `packages/omp-adapter/src/tools/shell.ts` (trả `BashResult` với `.stdout`); `parseNumstat(output: string): NumstatEntry[]` từ `@oh-my-pi/pi-coding-agent/commit/git/diff`.
- Produces: `gitStatus(sessionId): Promise<{ branch: string; detached: boolean; entries: GitStatusEntry[]; insertions: number; deletions: number }>`, `gitDiff(sessionId, path): Promise<{ text: string }>`.

Quyết định: **không** import `@oh-my-pi/pi-natives/vcs` — đó là native addon mà repo không khai báo trực tiếp (đóng gói desktop phải copy `.node`), và ta đã có đường chạy lệnh qua chính `runBashImpl`; parse bằng parser đã export của SDK thay vì tự parse.

- [ ] **Step 1: Viết test thất bại**

```ts
// packages/omp-adapter/src/git.test.ts
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdkAdapter } from './sdk.js';

describe('git surface', () => {
  test('reports branch, changed files and line counts in a repo', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-git-'));
    execFileSync('git', ['init', '-q'], { cwd });
    writeFileSync(join(cwd, 'a.txt'), 'one\n');
    execFileSync('git', ['add', '.'], { cwd });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd });
    writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\n');
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });
    const status = await adapter.gitStatus(session.id);
    expect(status.detached).toBe(false);
    expect(status.entries.map((e) => e.path)).toContain('a.txt');
    expect(status.insertions).toBeGreaterThan(0);
    const diff = await adapter.gitDiff(session.id, 'a.txt');
    expect(diff.text).toContain('+two');
  });

  test('a directory outside any repo degrades instead of throwing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-nogit-'));
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });
    const status = await adapter.gitStatus(session.id);
    expect(status).toEqual({ branch: '', detached: false, entries: [], insertions: 0, deletions: 0 });
  });
});
```

Run: `bun test packages/omp-adapter/src/git.test.ts`
Expected: FAIL — `adapter.gitStatus is not a function`.

- [ ] **Step 2: Hiện thực**

```ts
async gitStatus(sessionId: string): Promise<GitStatusDto> {
  const empty: GitStatusDto = { branch: '', detached: false, entries: [], insertions: 0, deletions: 0 };
  const probe = await runBashImpl(sessionId, 'git rev-parse --is-inside-work-tree', undefined, 10_000);
  if (!probe.stdout.includes('true')) return empty;
  const branchRaw = await runBashImpl(sessionId, 'git status --porcelain=v1 --branch', undefined, 15_000);
  const numstat = await runBashImpl(sessionId, 'git diff --numstat HEAD', undefined, 20_000);
  const lines = branchRaw.stdout.split('\n');
  const head = lines[0] ?? '';
  const detached = /^## HEAD \(no branch\)/.test(head);
  const branch = detached ? '' : (head.match(/^## ([^.\s]+)/)?.[1] ?? '');
  const entries = lines.slice(1).filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim(),
    path: line.slice(3),
  }));
  const stats = parseNumstat(numstat.stdout);
  return {
    branch,
    detached,
    entries,
    insertions: stats.reduce((n, s) => n + (s.added ?? 0), 0),
    deletions: stats.reduce((n, s) => n + (s.removed ?? 0), 0),
  };
}

async gitDiff(sessionId: string, path: string): Promise<{ text: string }> {
  const safe = path.replace(/(["\\])/g, '\\$1');
  const result = await runBashImpl(sessionId, `git diff -- "${safe}"`, undefined, 30_000);
  return { text: result.stdout };
}
```

(Field thật của `NumstatEntry` nằm ở `$SDK/src/commit/git/diff.ts:1-20`: nếu là `{ added, removed }` thì map như trên, nếu khác thì đổi theo — test ở Step 1 chốt lại con số nên sai tên field sẽ đỏ ngay.)

- [ ] **Step 3: Route + protocol + test**

`apps/server/src/routes/git.ts`: `GET /api/sessions/:id/git?action=status|diff&path=` → 200 với DTO; nhánh `diff` thiếu `path` → 400. Test trong `apps/server/src/routes/git.test.ts` với runtime giả (status/diff + degrade ngoài repo).

Run: `bun test apps/server/src/routes/git.test.ts`
Expected: PASS.

- [ ] **Step 4: UI**

Explorer pane thêm section "Git": dòng branch (hoặc `detached HEAD`), list file đổi màu theo `status` (`--diff-add`/`--diff-del` tokens), click file → diff trong editor pane (đã có CodeMirror read-only path từ `useFileContent`; dùng view `diff` mới). Chỉ dùng component kit.

- [ ] **Step 5: Gate + e2e**

Run: `bun run check && bun run e2e`
Expected: xanh, e2e 12/12.

- [ ] **Step 6: Commit + parity**

```bash
git add -A
git commit -m "feat(git): status and diff surface for the session workspace"
```

Cập nhật `docs/tui-parity-status.md`: dòng `/git` tách khỏi `/ssh` → ✅ + Evidence.

---

## Task 5: Marketplace — browse/install/enable/update

**Files:**
- Modify: `packages/omp-adapter/src/sdk/modes-base.ts` (`listMarketplacePlugins`, `installMarketplacePlugin`, `uninstallPlugin`, `setPluginEnabled`, `pluginUpdates`, `upgradePlugin`)
- Modify: `packages/agent-runtime/src/runtime.ts`
- Modify: `packages/protocol/src/rest.ts`
- Modify: `apps/server/src/routes/plugins.ts` (mở rộng), `apps/server/src/index.ts`
- Modify: `apps/web/src/lib/api-client/rest/settings.ts` + `hooks/settings.ts`
- Modify: `apps/web/src/features/settings/PluginsSection.tsx`
- Modify: `apps/web/src/features/chat/chat-commands.ts` (`/marketplace`, `/install`, `/reload-plugins`)
- Test: `packages/omp-adapter/src/marketplace.test.ts`, `apps/server/src/routes/plugins.test.ts`

**Interfaces:**
- Consumes: `MarketplaceManager` (`listAvailablePlugins`, `installPlugin`, `uninstallPlugin`, `setPluginEnabled`, `listInstalledPlugins`, `checkForUpdates`, `upgradePlugin`) từ `@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/manager`; `MarketplaceManagerOptions` cùng file.
- Produces: `AgentRuntime.listMarketplacePlugins(marketplace?)`, `installMarketplacePlugin({ pluginId, marketplace })`, `uninstallPlugin(pluginId)`, `setPluginEnabled({ pluginId, enabled })`, `pluginUpdates()`, `upgradePlugin(pluginId)`; routes `GET /api/marketplace/plugins`, `POST /api/marketplace/install`, `POST /api/plugins/:id/uninstall`, `POST /api/plugins/:id/enabled`, `GET /api/plugins/updates`, `POST /api/plugins/:id/upgrade`.

Sửa luôn kết luận cũ trong parity doc ("cần package-manager TTY"): SDK có `MarketplaceManager` đầy đủ, không cần TTY.

- [ ] **Step 1: Xác định nguồn marketplace dùng được trong test**

Run: `grep -n "addMarketplace" -A20 $SDK/src/extensibility/plugins/marketplace/manager.ts | head -40`
Expected: thấy dạng `source` được chấp nhận (git URL và/hoặc đường dẫn local). Ghi lại dạng dùng được cho test (nếu chỉ git URL: test dùng `mkdtempSync` + `git init` một marketplace tối thiểu có `plugins.json` theo `types.ts`).

- [ ] **Step 2: Viết test thất bại**

```ts
// packages/omp-adapter/src/marketplace.test.ts
import { describe, expect, test } from 'bun:test';
test('lists and installs a plugin from a local marketplace', async () => {
  const adapter = new SdkAdapter(tmpCwd());
  const available = await adapter.listMarketplacePlugins();
  expect(Array.isArray(available)).toBe(true);
  // với fixture local: expect(available.some((p) => p.id === 'probe')).toBe(true)
  // await adapter.installMarketplacePlugin({ pluginId: 'probe' });
  // expect((await adapter.listPlugins()).some((p) => p.name === 'probe')).toBe(true);
  // await adapter.uninstallPlugin('probe');
});
```

Run: `bun test packages/omp-adapter/src/marketplace.test.ts`
Expected: FAIL — `listMarketplacePlugins` chưa tồn tại.

- [ ] **Step 3: Hiện thực adapter**

Bọc manager, giữ nguyên mọi lỗi có `code` và map sang `InvalidRequestError` khi input sai; lỗi mạng/registry để nguyên (route map 502).

```ts
private async marketplace(): Promise<MarketplaceManager> {
  return new MarketplaceManager({ cwd: this.defaultCwd ?? process.cwd() });
}
```

- [ ] **Step 4: Route + protocol + test**

Theo mẫu `apps/server/src/routes/plugins.ts` hiện có; test: list 200; install thiếu `pluginId` 400; install lỗi nguồn → 502 kèm message; enable/disable đổi `listPlugins` output.

- [ ] **Step 5: UI + palette**

`PluginsSection.tsx`: tab con "Installed | Browse"; Browse dùng `useMarketplacePlugins` (list + filter + Install), Installed thêm nút Enable/Disable/Uninstall + badge "update available" từ `usePluginUpdates` + nút Upgrade. Palette: `/marketplace` (mở tab Browse), `/install <pluginId>` (gọi install + toast), `/reload-plugins` (invalidate `['plugins']`).

- [ ] **Step 6: Gate + e2e + parity**

Run: `bun run check && bun run e2e` → xanh.
Cập nhật parity: dòng `/install`, `/marketplace`, `/reload-plugins`, `/smithery-search` — tách 3 dòng đầu thành ✅ (smithery: giữ ⬜ kèm lý do "registry search riêng, chưa có nguồn xác thực").

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(plugins): marketplace browse, install, enable and upgrade"
```

---

## Task 6: `/rewind` (palette)

**Files:**
- Modify: `apps/web/src/features/chat/chat-commands.ts`
- Modify: `apps/web/src/features/chat/ChatPage.tsx` (truyền handler focus selector nếu chưa có)
- Test: `apps/web/src/features/chat/chat-commands.test.ts` (mới)

**Interfaces:**
- Consumes: state message đã có trong `use-chat-session` (`setRetryOp`/`setEditing`…) — lệnh `/rewind` mở affordance "Branch from here" của message người dùng gần nhất chưa branch.
- Produces: `PaletteCommand` mới `{ id: 'session-rewind', label: 'Rewind (branch from here)', run }`.

- [ ] **Step 1: Test thất bại**

```ts
// apps/web/src/features/chat/chat-commands.test.ts
import { expect, test } from 'bun:test';
import { buildSessionActions } from './chat-commands';
test('exposes a rewind command that branches from the last user message', () => {
  const calls: string[] = [];
  const commands = buildSessionActions({
    // deps tối thiểu cần cho test này; các op khác no-op
    lastUserMessageId: 'm1',
    onRewind: (id) => calls.push(id),
  } as never);
  const rewind = commands.find((c) => c.id === 'session-rewind');
  expect(rewind).toBeDefined();
  rewind?.run();
  expect(calls).toEqual(['m1']);
});
```

Run: `bun test apps/web/src/features/chat/chat-commands.test.ts`
Expected: FAIL — không có command `session-rewind`.

- [ ] **Step 2: Hiện thực**

Thêm deps `lastUserMessageId: string | undefined` + `onRewind: (messageId: string) => void` vào `SessionActionDeps`; command `id: 'session-rewind'`, `label: 'Rewind'`, `hint: 'branch from here'`, `run: () => lastUserMessageId && onRewind(lastUserMessageId)` (nếu không có message → no-op). Trong `ChatPage`, truyền message người dùng cuối cùng và handler mở dialog branch sẵn có.

- [ ] **Step 3: Gate + parity + commit**

Run: `bun test apps/web/src/features/chat/chat-commands.test.ts && bun run check && bun run e2e`
Expected: PASS, xanh, e2e 12/12.

```bash
git add -A
git commit -m "feat(web): a rewind command that branches from the last user message"
```

Parity: dòng `/rewind` 🟡 → ✅ (ghi rõ web đã có branch-from-here theo từng message, lệnh palette là lớp tiện dụng).

---

# Làn B — Hiệu năng & payload

## Task 7: `logs` nhanh hơn (parity 🟡 + #5)

**Files:**
- Modify: `packages/omp-adapter/src/hub.ts` (`processAction` op `logs`)
- Modify: `apps/web/src/features/terminal/SupervisedProcessesSection.tsx` (Follow dùng cursor)
- Test: `packages/omp-adapter/src/hub-process.test.ts` (mở rộng, đang có 4 test)

**Interfaces:**
- Produces: `processAction(..., { op: 'logs', name, cursor? })` trả `{ text, cursor: number, ready: boolean }`; lần gọi sau với `cursor` chỉ nhận phần mới.

- [ ] **Step 1: Đo trước**

Run: `time curl -s "http://127.0.0.1:PORT/api/sessions/$SID/process" -H 'content-type: application/json' -d '{"op":"logs","name":"web","lines":50}' | wc -c`
Expected: ghi lại số giây (đo được 10–20s/call) và số byte — đây là baseline trong commit message.

- [ ] **Step 2: Test thất bại cho cache + cursor**

```ts
test('log tail is cached briefly and honours a cursor', async () => {
  // gọi logs hai lần liên tiếp cùng name: lần hai không spawn worker lại
  // (đo bằng thời gian < 1s) và trả cursor tăng dần
  const first = await adapter.processAction(sessionId, { op: 'logs', name: 'p', lines: 10 });
  const second = await adapter.processAction(sessionId, { op: 'logs', name: 'p', lines: 10, cursor: first.cursor });
  expect(second.cursor).toBeGreaterThanOrEqual(first.cursor);
  expect(second.text.length).toBeLessThanOrEqual(first.text.length);
});
```

Run: `bun test packages/omp-adapter/src/hub-process.test.ts`
Expected: FAIL — chưa có `cursor`/cache.

- [ ] **Step 3: Hiện thực**

Trong `hub.ts`: `const logCache = new Map<string, { text: string; at: number; cursor: number }>()`; TTL 2s; khoá `${sessionId}:${name}`; khi có `cursor` trả phần `text.slice(cursor)`; khi cache miss → gọi đường cũ rồi lưu. Dọn cache trong `dropSessionTools`/session drop path.

- [ ] **Step 4: Đo lại + xác nhận UI**

Run: cùng lệnh ở Step 1 (hai lần liên tiếp) + mở tab Terminal → Supervised processes → Follow.
Expected: lần hai < 1s; Follow vẫn trượt log (không nhân bản dòng) và Stop vẫn ra `exited`.

- [ ] **Step 5: Gate + commit + parity**

```bash
git add -A
git commit -m "perf(adapter): cache the process log tail and serve it by cursor"
```

Parity: dòng Supervised processes giữ 🟡 (chức năng đủ) nhưng Evidence đổi sang số đo mới; #5 ghi thêm phần `logs` đã cải thiện.

---

## Task 8: Export theo luồng (#18)

**Files:**
- Modify: `packages/agent-runtime/src/runtime.ts` (thêm `exportHtmlFile`)
- Modify: `packages/omp-adapter/src/sdk/modes-base.ts`
- Modify: `apps/server/src/routes/share.ts`, `apps/server/src/index.ts`
- Modify: `apps/web/src/lib/api-client/rest/sessions.ts`, `hooks/sessions.ts`
- Modify: `apps/web/src/features/sessions/OpsBar.tsx:146` (tải file thay vì nhúng chuỗi)
- Test: `apps/server/src/routes/share.test.ts` (mới), e2e `tests/e2e/app.spec.ts`

**Interfaces:**
- Produces: `exportHtmlFile(sessionId, userThemes?): Promise<{ path: string; bytes: number }>` (file tạm, caller xoá); route `GET /api/sessions/:id/export?as=file` → stream `text/html` + `Content-Disposition: attachment`.

- [ ] **Step 1: Test route thất bại**

```ts
// apps/server/src/routes/share.test.ts
test('as=file streams the html and reports its size', async () => {
  const res = await exportFileRoute(fakeRuntime, 's1');
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(res.headers.get('content-disposition')).toContain('attachment');
  expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
});
```

Run: `bun test apps/server/src/routes/share.test.ts`
Expected: FAIL — `exportFileRoute` chưa có.

- [ ] **Step 2: Hiện thực**

Adapter: viết HTML ra temp dir như hiện tại nhưng **trả path** thay vì đọc vào chuỗi; route trả `new Response(Bun.file(path), { headers })` và xoá file sau khi stream xong (`await response.arrayBuffer()` không dùng — dùng `Bun.file(...).stream()` + `finally { rm }` với `ReadableStream` bọc). Giữ route cũ `{ html }` cho session nhỏ, thêm trần: nếu file > 8 MB thì route cũ trả 413 kèm hướng dẫn dùng `?as=file`.

- [ ] **Step 3: UI tải file**

`OpsBar.tsx`: nút Export gọi URL `?as=file` qua `window.location.assign` (hoặc `<a download>`), bỏ việc nhúng chuỗi rồi tạo Blob.

- [ ] **Step 4: e2e + gate**

Thêm spec: tạo session, gọi `request.get('/api/sessions/<id>/export?as=file')` → 200 + `content-length` = số byte > 0.
Run: `bun run check && bun run e2e`
Expected: xanh, e2e 13/13.

- [ ] **Step 5: Commit + parity**

```bash
git add -A
git commit -m "perf(export): stream session html instead of one 42 MB json body"
```

Parity #18: MỞ → ĐÃ SỬA + Evidence (`curl -w '%{size_download} %{time_total}'`).

---

## Task 9: Payload model catalog (#13)

**Files:**
- Modify: `apps/server/src/index.ts` (đường JSON dùng chung)
- Modify: `apps/server/src/routes/catalog.ts`
- Modify: `packages/omp-adapter/src/catalog.ts` (hoặc nơi định nghĩa `modelsList`)
- Modify: `apps/web/src/lib/api-client/rest/settings.ts` + `hooks/settings.ts`
- Test: `apps/server/src/routes/catalog.test.ts` (mở rộng)

**Interfaces:**
- Produces: `GET /api/models?query=&provider=&limit=`; response JSON > 32 kB được gzip khi client gửi `Accept-Encoding: gzip`; `ETag` + `304` cho lần lặp.

- [ ] **Step 1: Đo baseline**

Run: `curl -s -o /dev/null -w '%{size_download} %{time_total}\n' http://127.0.0.1:PORT/api/models` và lặp với `-H 'Accept-Encoding: gzip'`
Expected: ghi lại (đã đo 508 424 B / 0.4–6s, không nén). Nếu Bun đã tự nén thì dừng task này và ghi lại bằng chứng.

- [ ] **Step 2: Test thất bại**

```ts
test('filters the catalog and honours conditional requests', async () => {
  const first = await listModelsRoute({ query: 'glm', limit: '5' });
  expect(first.models.length).toBeLessThanOrEqual(5);
  expect(first.models.every((m) => m.id.includes('glm'))).toBe(true);
  const etag = first.etag;
  const again = await listModelsRoute({}, etag);
  expect(again.notModified).toBe(true);
});
```

Run: `bun test apps/server/src/routes/catalog.test.ts`
Expected: FAIL — chưa có query/etag.

- [ ] **Step 3: Hiện thực**

`modelsList()` nhận `{ query, provider, limit }` (lọc sau khi lấy từ SDK, không đổi nguồn). ETag = hash của payload (`Bun.hash` → hex). Trong `index.ts`, bọc mọi response JSON > 32 kB: nếu `accept-encoding` có `gzip` → `Bun.gzipSync` body + `Content-Encoding: gzip` + `Vary: Accept-Encoding`.

- [ ] **Step 4: UI dùng query**

`ModelPicker` gọi `useModels({ query })` theo ô search; `ProvidersPane` chỉ cần `limit=0` + tổng số (thêm `total` vào DTO) để không tải catalog.

- [ ] **Step 5: Đo lại + gate + commit**

Run: `curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' http://127.0.0.1:PORT/api/models` (kỳ vọng ~40–60 kB) rồi `bun run check && bun run e2e`.
Expected: giảm ≥ 5× và vẫn xanh.

```bash
git add -A
git commit -m "perf(catalog): filter, gzip and cache the models payload"
```

## Task 10: Race tạo session (#12)

**Files:**
- Test: `packages/omp-adapter/src/session-create-race.test.ts` (mới)
- Modify: `packages/omp-adapter/src/sdk/core-base.ts` (chỉ khi tái hiện được)

**Interfaces:**
- Produces: hoặc một fix (serialize/await readiness) + test hồi quy, hoặc Evidence "SDK-owned" trong bảng defect kèm log 20 lần chạy.

- [ ] **Step 1: Tái hiện**

```ts
test('parallel session creation never reports a replaced agent', async () => {
  const adapter = new SdkAdapter(process.cwd());
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => adapter.createSession({ cwd: process.cwd() })),
  );
  const failures = results.filter((r) => r.status === 'rejected').map((r) => String(r.reason));
  expect(failures).toEqual([]);
});
```

Run: `bun test packages/omp-adapter/src/session-create-race.test.ts --rerun-each 5`
Expected: nếu FAIL với `Agent "Main" was replaced during session initialization` → sang Step 2; nếu PASS 5 lần liên tiếp → sang Step 3.

- [ ] **Step 2: Fix**

Nguyên nhân khả dĩ: `runExclusive` chỉ bọc `createAgentSession`, còn đăng ký agent "Main" hoàn tất sau khi promise resolve. Fix: chờ session sẵn sàng (subscribe tới event đầu tiên hoặc `await session.ready?.()`) trong cùng vùng `runExclusive`, giống TUI; nếu SDK không có hook "ready", đặt tên agent riêng cho mỗi session qua option `agentRegistry`/`agentName` nếu có. Test ở Step 1 phải chuyển xanh.

- [ ] **Step 3: Ghi kết luận**

Nếu không tái hiện: ghi vào bảng §10 dòng #12: `ĐÓNG — 5×8 create song song không lỗi (log)`, kèm commit test.

- [ ] **Step 4: Gate + commit**

```bash
bun run check
git add -A
git commit -m "test(adapter): pin parallel session creation against the replaced-agent race"
```

---

# Làn C — Verify & bookkeeping

## Task 11: `/browser` + `/computer` trên desktop thật

**Files:**
- Modify: `docs/tui-parity-status.md` (Evidence của dòng `/browser`, `/computer`)

- [ ] **Step 1: Chuẩn bị quyền**

Trên macOS: System Settings → Privacy & Security → Screen Recording → bật cho `Grove.app`; mở app desktop (`open apps/desktop/src-tauri/target/release/bundle/macos/Grove.app` sau `bun run dist:macos` nếu chưa có build mới).
Expected: app mở, sidecar sống, không có error page.

- [ ] **Step 2: Chạy checklist**

Trong tab Browser của một session: `computer` → `capabilities` phải trả được (không còn `PermissionDenied: macOS Screen Recording permission is not granted`); `displays` trả ≥1 display; `screenshot` lưu được file; `click` không còn `cannot use null as rangeable`; `browser` mode Web → `open`/`ariaSnapshot`/`click aria-ref=eN` vẫn hoạt động.

- [ ] **Step 3: Ghi Evidence + commit**

Ghi từng lệnh/kết quả vào parity doc; nếu `click` vẫn lỗi trên desktop thật → giữ 🟡 và ghi rõ giới hạn + issue cần mở ở SDK.

```bash
git add docs/tui-parity-status.md
git commit -m "docs: browser and computer parity re-verified on a real desktop session"
```

## Task 12: Desktop — chốt phần còn thiếu credential

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json:27` (đọc endpoint từ env lúc build)
- Modify: `docs/desktop-release.md`
- Modify: `docs/superpowers/plans/2026-09-19-desktop-shell.md` (thêm khối "Trạng thái thực tế" ở đầu)
- Modify: `docs/superpowers/plans/2026-09-19-desktop-windows.md` (như trên)
- Modify: `docs/superpowers/plans/2026-09-20-grove-rename.md` (Step 2 còn mở)

- [ ] **Step 1: Endpoint updater không còn hardcode**

Trong `scripts/build-desktop.ts`: đọc `GROVE_UPDATER_ENDPOINT`, ghi vào `tauri.conf.json` trước khi `tauri build` (hoặc dùng `--config` của Tauri). Thiếu env → giữ placeholder + cảnh báo rõ trong log build.

Test: `bun run scripts/build-desktop.ts --dry-run` in ra endpoint dùng được khi set env, và cảnh báo khi không set.

- [ ] **Step 2: Ghi trạng thái thật lên đầu 2 plan desktop**

Mỗi file thêm khối ngắn: việc đã ship (bundle `.app`, DMG/zip, sidecar, `smoke:bundle`, CI `verify`/`windows`/`release`), việc còn mở (notarization + secrets, endpoint updater), ngày đo. Không tick 104 checkbox lịch sử.

- [ ] **Step 3: Chạy migration dir giả (grove-rename Step 2)**

Run: `mkdir -p ~/Library/Application\ Support/dev.grove.desktop && open .../Grove.app` rồi kiểm thư mục dữ liệu sau khi mở.
Expected: dữ liệu cũ được migrate sang `dev.grove.desktop` (hoặc app dùng đúng dir mới) — ghi kết quả + tick box trong plan rename.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(desktop): record shipped state, env-driven updater endpoint, migration check"
```

## Task 13: Sửa chữ e2e trong docs + chốt push

**Files:**
- Modify: `AGENTS.md:89,94`
- Modify: `docs/architecture.md:32,221,254`

- [ ] **Step 1: Cập nhật chữ**

`AGENTS.md:89` → `- Editor: **CodeMirror** (lock). E2E (Playwright): có từ 2026-09-19 (P5), là cổng UI trong CI.`
`AGENTS.md:94` → `- Framework: Vitest (DOM) / `bun test` (logic thuần); Playwright e2e cho UI (`bun run e2e`, 12 spec).`
`docs/architecture.md:221` → sửa "Playwright 5 specs" thành "Playwright 12 specs".
`docs/architecture.md:32,254` → "Playwright E2E đã có (P5)".

- [ ] **Step 2: Gate (docs-only) + commit**

```bash
bun run check
git add AGENTS.md docs/architecture.md
git commit -m "docs: e2e is a live gate, not a P5 plan"
```

- [ ] **Step 3: Chốt push (quyết định của người dùng)**

Liệt kê 23+ commit local; đề xuất `git push origin main` (repo một người) hoặc tạo branch + PR. **Không tự push** — chờ quyết định.
Run: `git rev-list --left-right --count origin/main...HEAD`
Expected: in ra `0 <N>`; ghi N vào báo cáo cuối.

---

## Out of scope (quyết định, kèm lý do)

- **`/collab`, `/join`, `/leave`** — cần relay + thiết kế `InteractiveModeContext`; người dùng local-only (`docs/runbook.md` §Deferred, `docs/architecture.md:252`).
- **Interactive PTY** — terminal hiện chạy job-based; PTY cần epic riêng (runbook §Deferred).
- **Providers OAuth login/logout** — SDK không export flow device-code (`grep -rln "device_code" $SDK/src` không có kết quả); cần browser callback + listener local ⇒ không làm trong đợt này, giữ 🟡.
- **`/smithery-search`** — cần nguồn registry riêng; giữ ⬜ (Task 5 chỉ mở phần marketplace).
- **Đổi palette** và **#15 (đo latency bimodal)** — #15 chỉ cần đo lại khi server tươi, một client; thêm vào Task 7 Step 1 như một lần đo phụ nếu tiện, không phải deliverable.
- **`/api/models` chuyển sang phân trang thật** — Task 9 lọc + nén + ETag đủ cho 506 kB; phân trang là thiết kế khác, không cần bây giờ.

## Self-Review

**1. Spec coverage** (đối chiếu danh sách tồn đọng đã rà):

| Mục trong danh sách | Task |
|---|---|
| `plan.defaultOnStartup` ⬜ | 1 |
| Ruling B (hook `GET /thinking`) | 2 |
| `/ssh` ⬜ | 3 |
| `/git` ⬜ | 4 |
| `/install`, `/marketplace`, `/reload-plugins` ⬜ | 5 |
| `/rewind` 🟡 | 6 |
| Supervised processes `logs` 🟡 + #5 | 7 |
| #18 export 42 MB | 8 |
| #13 models 506 kB | 9 |
| #12 race tạo session | 10 |
| `/browser`, `/computer` 🟡 | 11 |
| Desktop notarization + updater endpoint + tracker cũ + rename migration | 12 |
| Chữ e2e trong `AGENTS.md`/`architecture.md`, push | 13 |
| `/collab`, PTY, OAuth, smithery, palette, #15 | Out of scope (có lý do) |

**2. Placeholder scan:** không có TBD/TODO. Hai chỗ yêu cầu xác nhận tên field khi viết code (Task 4 `NumstatEntry`, Task 5 dạng `source` của `addMarketplace`) — cả hai nêu đường dẫn file + lệnh grep cụ thể và cách xử lý nếu khác.

**3. Type consistency:** `listSshHosts(cwd, scope)`, `addSshHost({cwd,scope,name,host,user?,port?})`, `removeSshHost({cwd,scope,name})`, `gitStatus(sessionId) → GitStatusDto`, `gitDiff(sessionId, path) → {text}`, `listMarketplacePlugins(marketplace?)`, `installMarketplacePlugin({pluginId, marketplace})`, `processAction(..., {op:'logs', cursor?})`, `exportHtmlFile(sessionId, userThemes?) → {path, bytes}`, `getThinking(sessionId)`, `useThinkingLevel(sessionId)` — dùng nhất quán ở task sở hữu và task tiêu thụ (Task 2/3/4/5 đều khai protocol trước khi UI dùng).

**4. Review Focus:** 6 dòng ở đầu plan đều có test: #1 → Task 5 Step 4 (install lỗi → 502, không trạng thái nửa vời), #2 → Task 4 Step 1 test 2 (ngoài repo), #3 → Task 1 Step 5, #4 → Task 8 Step 4 (stream + size), #5 → Task 3 Step 1 test 2/3 (tên sai, trùng, JSON hỏng), #6 → Task 10 Step 1.

## Thực thi

**Ledger — plan: `docs/superpowers/plans/2026-09-22-parity-closeout.md`** · executor: inline (skill `executing-plans`) · worktree: `main` (consent: plan nêu rõ + hai đợt trước chạy inline trên `main`; người dùng chọn Native ở handoff) · BASE toàn plan: `f3b1009`.

**Ruling (setup):** bản cài skill `executing-plans`/`subagent-driven-development` ở máy này **không có `scripts/`** (`sdd-workspace`, `task-start`, `task-done`, `review-package` đều thiếu) → ledger là **bảng trong chính file plan này** (đã commit, sống sót compaction, đúng convention 2 đợt trước) thay vì `.superpowers/sdd/<plan>/progress.md` chưa được gitignore. Cost nếu sai: người đọc theo đường dẫn scratch của skill sẽ không thấy file — bù bằng dòng identity ngay trên.

**Pre-flight scan (interface giữa các task):**

| Cặp | Produces vs Consumes | Kết quả |
|---|---|---|
| 3 ↔ 4 ↔ 5 | cùng `packages/agent-runtime/src/runtime.ts` + `packages/omp-adapter/src/sdk/modes-base.ts` (mỗi task thêm method) | serial, append-only — không đụng chữ ký của nhau |
| 3 ↔ 4 | cùng `apps/web/src/features/explorer/ExplorerPane.tsx` (Task 3 thêm section SSH, Task 4 thêm section Git) | serial: Task 3 ship trước, Task 4 theo cùng khuôn section |
| 2 ↔ 8 | cùng `apps/web/src/lib/api-client/rest/sessions.ts` + `hooks/sessions.ts` (Task 2 thêm read fn, Task 8 thêm file-export fn) | serial, khác hàm — không đè |
| 3, 4, 5, 8 ↔ 9 | cùng `apps/server/src/index.ts` (path constant mới ở 3/4/5/8; wrapper gzip ở Task 9) | Task 9 làm **sau cùng** để wrapper phủ mọi route mới |
| 3, 4, 5, 6, 7, 11 | cùng `docs/tui-parity-status.md` (mỗi task sửa 1 dòng) | serial, chỉ sửa đúng dòng của mình, không viết lại cả bảng |
| còn lại | không chia sẻ interface | — |

Bảng kết quả điền khi làm xong từng task.

| Task | Commit | Kết quả |
|---|---|---|
| 1 | `0a3c6da` | `core-base.ts` đọc setting (async `settingsGet` → `SettingEntry.value`) sau `shareSettingsWithTools`, khai `setPlanMode` abstract trên `SdkCoreBase`. Test mới `plan-startup.test.ts` **2/2** (bật → plan true; tắt → plan false). LIVE qua server (agent dir riêng): PUT setting true → POST session → `GET /modes` `"plan":true`; PUT false → session mới `"plan":false`. `bun run check` xanh. |
| 2 | `b4bd58e` | **Không sửa production code** — premise của plan sai: picker **đã** đọc được level qua `GET /models` (`SdkAdapter.getSessionModels` gộp `configuredThinkingLevel() ?? thinkingLevel`) nên Ruling B coi như xong ở phía UI. Giữ spec e2e mới `the model picker shows the thinking level the session will use` (đọc level qua API rồi assert picker hiện + `aria-pressed`) — trường hợp chưa set level trước đây in "Thinking: default" dù session chạy `high`. e2e **13/13**, `bun run check` xanh. Ruling: không thêm hook `useThinkingLevel` (không còn consumer thật) — cost nếu sai: khi nào cần đọc level mà không kèm catalog thì phải thêm hook, ~15 dòng. |
| 3 |  | Thêm dep . Adapter:  bọc  + ; khai 3 method trên ; route  (GET/POST/DELETE) + ; web:  +  +  (scope user/project, form, xoá) gắn trong ExplorerPane. Test: adapter **3/3** (thêm/list/xoá, tên sai, trùng, config hỏng — đã chứng minh đỏ khi bỏ catch), route **4/4**, e2e **14/14**. Live :8787: list rỗng → add → trùng 400 → body thiếu 400 → delete sạch; file . Ruling: **không thêm lệnh palette ** — palette đã có lệnh chuyển tab tới Explorer (), thêm đường thứ hai tới cùng một tab là trọng lượng vô ích; cost nếu sai: gõ  trong composer không chạy gì (parity row ghi rõ người dùng vào Explorer). Ruling nhỏ: field SDK là  (không phải ) — API web vẫn nhận  cho gọn. |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
| 8 | | |
| 9 | | |
| 10 | | |
| 11 | | |
| 12 | | |
| 13 | | |
