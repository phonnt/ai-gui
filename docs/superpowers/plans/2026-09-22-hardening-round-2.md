# Grove Hardening Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các defect audit còn thật sự mở (`/move`, prelude schema, process latency, read-back thinking), tách 5 god file theo biên rõ ràng, xoá export chết/hàm trùng, và đưa kiểm tra UI vào Playwright CI.

**Architecture:** Ba lớp, làm theo thứ tự vì rẻ→đắt: (a) **docs truth** — bảng defect trong `docs/tui-parity-status.md` đã cũ, 7/11 dòng thực tế đã sửa; (b) **correctness** — mỗi defect sửa ở đúng tầng (route zod-validated → adapter → SDK), có test ở tầng đó; (c) **structure** — tách file **giữ nguyên thân hàm**, chỉ đổi nơi ở, verify bằng `bun run check` + test package + `bun run e2e`; (d) **harness** — spec Playwright đo computed style, thay cho probe tay.

**Tech Stack:** Bun ≥1.3.14, TypeScript strict, zod (`packages/protocol`), React 19, Playwright (đã cấu hình sẵn), Biome, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-22-hardening-round-2-design.md` — bảng đo tại HEAD, danh sách phạm vi/không phạm vi, acceptance.

## Global Constraints

- Bảng "Nguồn sự thật" trong spec là số đo tại `1398c90`; mọi con số trong plan lấy từ đó, không tự chế.
- Tách file: **không đổi chữ ký hàm, không đổi hành vi**; mỗi bước tách xong phải `bun run check` xanh trước khi đi tiếp.
- Ranh giới monorepo giữ nguyên: `apps/web` chỉ import `core`/`protocol`/`ui`; `omp-adapter` chỉ dựa `agent-runtime` + `core`.
- Sau mỗi task: `bun run format` + `bun run check` xanh, rồi commit một lần; ledger là mục `## Thực thi` trong chính plan này (harness không có `scripts/sdd-workspace`).
- Test đặt đúng tầng: route → `apps/server/src/routes/<x>.test.ts`; protocol → `packages/protocol/src/rest.test.ts`; adapter → `packages/omp-adapter/src/<x>.test.ts`; UI → `tests/e2e/app.spec.ts`.
- Không dùng screenshot làm bằng chứng (harness screenshot hỏng); dùng computed style qua Playwright/`tab.evaluate`.

## Review Focus

1. **Tách file làm mất ngữ cảnh lỗi** — `SdkAdapter` map lỗi SDK → typed error; tách sai chỗ có thể nuốt `SessionNotFoundError` thành lỗi chung. Kiểm: `bun test packages/omp-adapter` + probe 404 của `GET /api/sessions/không-tồn-tại`.
2. **`ChatPage` tách hook làm đổi thứ tự hook** → React unmount/remount hoặc mất trạng thái stream. Kiểm: e2e mở session gửi prompt + abort.
3. **`/move` validate quá tay** — chặn cả trường hợp hợp lệ (đường dẫn có nhưng chưa phải git worktree, hoặc symlink). Kiểm: test 200 cho thư mục tồn tại (kể cả symlink).
4. **Schema prelude sửa lệch client** — UI đang gửi `capabilities` cho `computer`; nếu sửa nhầm nhánh thì nút Computer hỏng. Kiểm: test protocol cho cả hai endpoint + mở pane Browser/Computer.
5. **Playwright spec đo số đo** có thể flaky do font/animation; kiểm bằng cách chạy `bun run e2e` 2 lần liên tiếp.

---

### Task 1: Đồng bộ bảng defect với thực tế

**Files:**
- Modify: `docs/tui-parity-status.md` (§10 bảng + Changelog)
- Modify: `docs/superpowers/plans/2026-09-21-hardening-and-gates.md:367` (sửa ví dụ dead-export đã sai)

**Interfaces:**
- Produces: bảng defect đúng tại HEAD — đầu vào cho các task sau (chỉ #5, #9, #11, #6-read-back còn mở).

- [ ] **Step 1: Chạy lại probe để có bằng chứng tươi**

```sh
B=http://127.0.0.1:8787; S=$(curl -s "$B/api/sessions" | python3 -c 'import sys,json;print((json.load(sys.stdin)["sessions"] or [{}])[0]["id"])')
curl -s -o /dev/null -w 'ps -> %{http_code} in %{time_total}s\n' -X POST "$B/api/sessions/$S/process" -H 'content-type: application/json' -d '{"op":"ps"}'
curl -s -w ' -> %{http_code}\n' "$B/api/sessions/$S/thinking" | head -1
curl -s -o /dev/null -w 'GET thinking -> %{http_code}\n' "$B/api/sessions/$S/thinking"
curl -s -w ' -> %{http_code}\n' -X POST "$B/api/sessions/$S/browser" -H 'content-type: application/json' -d '{"action":"capabilities"}' | head -1
rm -rf /tmp/grove-defect9; curl -s -o /dev/null -w 'move -> %{http_code}\n' -X POST "$B/api/sessions/$S/move" -H 'content-type: application/json' -d '{"cwd":"/tmp/grove-defect9"}'; test -d /tmp/grove-defect9 && echo 'dir created: yes'
```

Expected: `ps` ~10s; `GET thinking` 404; browser `capabilities` 400; `move` 200 + `dir created: yes`.

- [ ] **Step 2: Sửa bảng §10**

Với mỗi dòng: giữ nguyên phát biểu gốc, thêm cột `Trạng thái tại HEAD` (`MỞ` / `ĐÃ SỬA <commit>` / `THEO DÕI`) và `Bằng chứng`. Cụ thể: #6 → `MỘT NỬA` (validate xong, thiếu GET), **#7/#11/#14/#16/#17 → `ĐÃ SỬA`** (kèm bằng chứng: `GET …/jobs` 404; `POST …/browser {"action":"capabilities"}` → 400 vì `prelude.ts:15-19` chọn `BrowserActionSchema`; `exportHtml` ghi vào `mkdtemp`; export session rỗng → 400 `session has no journal yet`), #12 → `THEO DÕI (không tái hiện, e2e có test song song)`, #13 → `MỘT NỬA (UI không chặn; payload 508 424 B / 3.50s còn)`, #5/#9 → `MỞ`.

Thêm 1 dòng **mới** vào bảng: `#18 · GET /api/sessions/:id/export trên session dài trả 42 MB trong một response (0.43s) — UI tải trọn vào bộ nhớ` · trạng thái `MỞ (chưa nằm trong đợt này)`.

- [ ] **Step 3: Sửa ví dụ sai ở plan cũ**

`docs/superpowers/plans/2026-09-21-hardening-and-gates.md:367`: thay cụm `Card`, `reset*ForTest`, "18 barrel feature" bằng dữ liệu thật của DebtScout (`@grove/core` 4 dead, `@grove/ui` 7, `@grove/agent-runtime` 11; 0 barrel; `ThinkingElapsed` không trùng).

- [ ] **Step 4: Changelog**

Thêm 1 dòng `2026-09-22 · đối soát bảng defect · <lệnh probe + kết quả> · commit`.

- [ ] **Step 5: Gate + commit**

```sh
bun run check
git add -A && git commit -m "docs: reconcile the defect table with the code at HEAD"
```

---

### Task 2: `/move` không tự tạo thư mục đích (#9)

**Files:**
- Modify: `apps/server/src/routes/ops.ts:89-98`
- Test: `apps/server/src/routes/ops.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `MoveSchema` (`packages/protocol/src/rest.ts`), `errorToStatus` (`apps/server/src/routes/errors.ts`).
- Produces: `POST /api/sessions/:id/move` trả **400 `directory does not exist: <path>`** khi `cwd` không tồn tại; 200 khi tồn tại.

- [ ] **Step 1: Viết test đỏ**

Route thật trả `Promise<{ ok: true }>` và **ném** `HttpError` (không trả `Response`) — xem `apps/server/src/routes/ops.ts:89-98`. Test đúng theo hình đó:

`apps/server/src/routes/ops.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moveSessionRoute } from './ops';
import { HttpError } from './errors';

const runtime = { moveSession: async () => ({ ok: true }) } as never;

describe('move route', () => {
  test('rejects a directory that does not exist and does not create it', async () => {
    const target = join(tmpdir(), `grove-move-${Date.now()}`);
    const err = await moveSessionRoute(runtime, 's1', { cwd: target }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).message).toContain('directory does not exist');
    expect(existsSync(target)).toBe(false);
  });

  test('accepts an existing directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grove-move-ok-'));
    expect(await moveSessionRoute(runtime, 's1', { cwd: dir })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/server/src/routes/ops.test.ts`
Expected: FAIL — status 200 và thư mục bị tạo.

- [ ] **Step 3: Validate trong route**

`apps/server/src/routes/ops.ts` — trước khi gọi runtime:

```ts
if (!existsSync(input.cwd)) {
  return json({ error: `directory does not exist: ${input.cwd}` }, 400);
}
```

Dùng cùng cách `/workspace/dirs` đang làm (`apps/server/src/routes/workspace.ts:32-46`).

- [ ] **Step 4: Chạy cho xanh + live**

Run: `bun test apps/server/src/routes/ops.test.ts` → PASS (2 test).
Live: `rm -rf /tmp/grove-defect9 && curl -s -o /dev/null -w '%{http_code}\n' -X POST …/move -d '{"cwd":"/tmp/grove-defect9"}'` → `400`; `test -d /tmp/grove-defect9` → không tồn tại.

- [ ] **Step 5: Gate + commit**

```sh
bun run format && bun run check
git add -A && git commit -m "fix(server): refuse to create the target directory on /move"
```

---

### Task 3: Đọc lại thinking level (`GET /thinking`) (#6)

**Files:**
- Modify: `apps/server/src/routes/model.ts` (thêm `getThinkingRoute` cạnh `setThinkingRoute:52`), `apps/server/src/index.ts` (`THINKING_PATH:173`, handler `POST` tại `:539-541` — thêm nhánh `GET`)
- Test: `apps/server/src/routes/thinking.test.ts`

**Interfaces:**
- Consumes: `runtime.getSessionMeta`/`getThinkingLevel` (kiểm tên thật trong `packages/agent-runtime/src/runtime.ts` trước khi viết).
- Produces: `GET /api/sessions/:id/thinking` → `200 { thinking }`; session lạ → `404`.

- [ ] **Step 1: Test đỏ**

```ts
test('GET returns the current thinking level', async () => {
  const res = await thinkingGetRoute(runtimeWith('medium'), 's1');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ thinking: 'medium' });
});

test('GET 404s for an unknown session', async () => {
  const res = await thinkingGetRoute(runtimeThrowingSessionNotFound, 'nope');
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Chạy cho đỏ** → Run: `bun test apps/server/src/routes/thinking.test.ts` → FAIL (route chưa có).

- [ ] **Step 3: Thêm route** trong `apps/server/src/index.ts` (đăng ký path) + handler đọc level từ session meta/adapter (dùng đúng hàm có sẵn; nếu adapter chưa expose thì thêm `getThinkingLevel` vào `AgentRuntime` + cài đặt trong `SdkAdapter`, **không** đọc state nội bộ).

- [ ] **Step 4: Test xanh + live**

Run: `bun test apps/server/src/routes/thinking.test.ts` → PASS.
Live: `GET …/thinking` → 200 `{"thinking":"…"}`; `GET …/does-not-exist/thinking` → 404.

- [ ] **Step 5: Gate + commit**

```sh
bun run format && bun run check
git add -A && git commit -m "feat(server): expose GET /thinking for read-back"
```

---

### Task 4: Process plane — hợp đồng lỗi rõ ràng, đo độ trễ broker (#5)

**Files:**
- Modify: `packages/omp-adapter/src/hub.ts:365-392` (chỉ comment/đo, không đổi logic)
- Test: `packages/omp-adapter/src/deadline.test.ts` (đã có) + `packages/omp-adapter/src/hub-process.test.ts` (mới)
- Modify: `docs/tui-parity-status.md` (#5 ghi rõ trạng thái)

**Interfaces:**
- Produces: không đổi API. Ghi nhận: độ trễ `ps`/`describe` là của **broker/SDK** (`executeLaunch` trong `withDeadline` 20 s), không phải của server; hợp đồng lỗi khi broker treo = `503 RuntimeUnavailableError` kèm thông báo hành động được.

- [ ] **Step 1: Đo baseline (đã có trong spec)**

Run: `curl -s -o /dev/null -w 'describe -> %{http_code} in %{time_total}s\n' -X POST "$B/api/sessions/$S/process" -H 'content-type: application/json' -d '{"op":"describe","name":"nope"}'`
Expected: `400 in ~9.9s`. Ghi số này vào ledger — **không** hứa cải thiện vì nguồn là broker.

- [ ] **Step 2: Test hợp đồng lỗi (đỏ nếu chưa có)**

`packages/omp-adapter/src/hub-process.test.ts`: giả lập `executeLaunch` treo (promise không resolve) và khẳng định `withDeadline` trả `RuntimeUnavailableError` với message chứa `did not answer within 20s` **và** thông tin scope; đồng thời khẳng định lỗi "broker.sock" được map thành `RuntimeUnavailableError` (503), không phải 500.

Run: `bun test packages/omp-adapter/src/hub-process.test.ts` → PASS (nếu FAIL thì đó là bug thật, sửa trong task này).

- [ ] **Step 3: Ghi trạng thái vào bảng defect**

#5 giữ nhãn `MỞ (nguồn: broker/SDK)`, kèm số đo `ps 9.95s`, `describe 400 sau 9.9s`, và ghi chú "deadline 20 s + 503 đã có; cải thiện thật phải làm ở tầng broker".

- [ ] **Step 4: Gate + commit**

```sh
bun run format && bun run check
git add -A && git commit -m "test(adapter): pin the process-broker failure contract and record its latency"
```

### Task 5: Tách `ChatPage.tsx` (1179 → < 700 dòng)

**Files:**
- Create: `apps/web/src/features/chat/use-chat-session.ts` (state + hook 159-745), `apps/web/src/features/chat/ChatHeader.tsx`, `apps/web/src/features/chat/ToolPane.tsx`, `apps/web/src/features/chat/ToolRail.tsx` (JSX 813-1179 tách theo khối lớn nhất)
- Modify: `apps/web/src/features/chat/ChatPage.tsx`

**Interfaces:**
- Produces: `useChatSession(sessionId): { … }` trả đúng tập giá trị JSX cần (đọc `ChatPage.tsx:159-745` để lấy danh sách chính xác trước khi viết); mỗi component con nhận props tường minh, **không** nhận object state tổng.

- [ ] **Step 1: Viết e2e bảo vệ trước khi tách**

Thêm vào `tests/e2e/app.spec.ts` một test mở session, gửi prompt, chờ turn xuất hiện, bấm abort — để có lưới an toàn cho việc tách.

Run: `bun run e2e -- tests/e2e/app.spec.ts -g "session turn"`
Expected: PASS **trước** khi tách (nếu fail thì dừng, sửa môi trường trước).

- [ ] **Step 2: Tách khối JSX lớn nhất trước**

Chuyển khối pane/rail thành component con, truyền props tường minh; giữ nguyên class. Không đổi logic.

Run: `bun run typecheck && bun run e2e -- -g "session turn"` → PASS.

- [ ] **Step 3: Tách state thành hook**

Chuyển toàn bộ `useState/useMemo/useEffect/useRef` (159-745) sang `use-chat-session.ts`, **giữ nguyên thứ tự gọi hook**; `ChatPage` chỉ còn gọi hook + render.

Run: `bun run check` → xanh; `bun run e2e` → xanh.

- [ ] **Step 4: Kiểm ngưỡng dòng**

Run: `wc -l apps/web/src/features/chat/ChatPage.tsx apps/web/src/features/chat/use-chat-session.ts`
Expected: file nào cũng `< 700`.

- [ ] **Step 5: Commit**

```sh
bun run format && bun run check
git add -A && git commit -m "refactor(web): split ChatPage into a session hook and pane components"
```

---

### Task 6: Tách `packages/omp-adapter/src/sdk.ts` (2085 → < 700 dòng/file)

**Files:**
- Create: `packages/omp-adapter/src/sdk/` với các module theo nhóm method: `sessions.ts`, `messages.ts`, `tools-bridge.ts`, `settings.ts`, `meta.ts` (đọc `sdk.ts:359-2085` để chia theo cụm 15–20 method/file)
- Modify: `packages/omp-adapter/src/sdk.ts` → còn `class SdkAdapter` mỏng, compose các mixin/module

**Interfaces:**
- Produces: cùng chữ ký `SdkAdapter implements AgentRuntime`; `packages/omp-adapter/src/index.ts` export không đổi.

- [ ] **Step 1: Chốt ranh giới**

```sh
grep -nE '^  (async )?[a-zA-Z]+\(' packages/omp-adapter/src/sdk.ts | wc -l
```
Ghi danh sách method vào ledger và chia thành 5 nhóm trước khi cắt (không cắt mò).

- [ ] **Step 2: Tách module đầu tiên, giữ hành vi**

Chuyển nhóm method + helper riêng của nó sang `sdk/<nhóm>.ts` dưới dạng hàm nhận `deps` (đối tượng chứa `client`, `ensureSession`, log) — **không** dùng `this` xuyên module.

Run: `bun test packages/omp-adapter && bun run check` → xanh.

- [ ] **Step 3: Lặp cho từng nhóm** (mỗi nhóm 1 lần chạy test + typecheck).

- [ ] **Step 4: Ngưỡng dòng**

Run: `wc -l packages/omp-adapter/src/sdk.ts packages/omp-adapter/src/sdk/*.ts`
Expected: mọi file `< 700`.

- [ ] **Step 5: Smoke + commit**

```sh
bun run smoke:server && bun run check
git add -A && git commit -m "refactor(adapter): split the SDK adapter by capability"
```

---

### Task 7: Tách `packages/omp-adapter/src/tools.ts` (1972 → < 700 dòng/file)

**Files:**
- Create: `packages/omp-adapter/src/tools/` với `files.ts` (`readFileImpl`, `writeFileImpl`, `listDirImpl`, `globFilesImpl`, `grepFilesImpl`), `shell.ts` (`runBashImpl`, `runCellImpl`), `lsp.ts` (`lsp*Impl`), `debug.ts` (`debug*Impl`), `index.ts` (`createSessionTools` + export lại)
- Modify: `packages/omp-adapter/src/tools.ts` → re-export mỏng hoặc xoá (cập nhật importer)

**Interfaces:**
- Produces: `createSessionTools(deps)` giữ nguyên chữ ký + 23 export hiện có (kiểm bằng `grep -c '^export' tools.ts` trước/sau).

- [ ] **Step 1: Ghi danh sách export trước khi tách**

Run: `grep -n '^export' packages/omp-adapter/src/tools.ts | wc -l` → ghi số vào ledger.

- [ ] **Step 2: Tách theo nhóm**, mỗi nhóm chạy `bun test packages/omp-adapter && bun run typecheck`.

- [ ] **Step 3: Kiểm lại export + ngưỡng**

Run: `grep -rn "from './tools'" packages/omp-adapter/src | wc -l` (importer phải vẫn chạy) và `wc -l packages/omp-adapter/src/tools*.ts packages/omp-adapter/src/tools/*.ts`.
Expected: mọi file `< 700`; số export không đổi.

- [ ] **Step 4: Smoke + commit**

```sh
bun run smoke:server && bun run check
git add -A && git commit -m "refactor(adapter): split tool implementations by domain"
```

---

### Task 8: Tách web api-client + dọn export chết + gộp hàm trùng

**Files:**
- Create: `apps/web/src/lib/api-client/rest/` (`sessions.ts`, `settings.ts`, `hub.ts`, `tools.ts`, `index.ts`) và `apps/web/src/lib/api-client/hooks/` (cùng cách chia)
- Modify: `apps/web/src/lib/api-client/rest.ts`, `hooks.ts` (giữ re-export để không phá importer trong cùng commit)
- Modify: xoá export chết ở `packages/core/src/*`, `packages/ui/src/index.ts`, `packages/agent-runtime/src/runtime.ts` (11 symbol)
- Modify: `apps/web/src/features/chat/Message.tsx:26`, `apps/web/src/features/terminal/BackgroundJobsSection.tsx:12` → dùng **một** `formatDuration` trong `apps/web/src/lib/format.ts`; gộp `errorMessage` của web LSP về `lib/format.ts` (bản server `routes/errors.ts` giữ riêng — khác runtime)

**Interfaces:**
- Produces: `lib/format.ts` thêm `formatDuration(ms: number): string`; các nơi khác import từ đó. Export chết bị xoá **chỉ khi** grep toàn repo = 0.

- [ ] **Step 1: Test cho `formatDuration`**

Thêm vào `apps/web/src/lib/format.test.ts`:

```ts
test('formats durations the way the transcript shows them', () => {
  expect(formatDuration(45)).toBe('45ms');
  expect(formatDuration(1500)).toBe('1.5s');
  expect(formatDuration(90_000)).toBe('1m30s');
});
```

Run: `bun test apps/web/src/lib/format.test.ts` → FAIL (hàm chưa tồn tại / chưa export).

- [ ] **Step 2: Hiện thực + thay 2 chỗ dùng**, xoá 2 bản cũ.

Run: `bun test apps/web/src/lib/format.test.ts` → PASS; `grep -rn 'function formatDuration' apps/web/src | wc -l` → `1`.

- [ ] **Step 3: Xoá export chết**

Với từng symbol trong danh sách (core 4, ui 7, agent-runtime 11): `grep -rn '<Tên>' --include='*.ts' --include='*.tsx' . | grep -v node_modules` phải = 1 (chính file định nghĩa) trước khi xoá. Xoá xong chạy `bun run check`.

- [ ] **Step 4: Tách `rest.ts`/`hooks.ts` theo nhóm hàm**, giữ re-export.

Run: `wc -l apps/web/src/lib/api-client/rest.ts apps/web/src/lib/api-client/hooks.ts apps/web/src/lib/api-client/rest/*.ts apps/web/src/lib/api-client/hooks/*.ts` → mọi file `< 700`; `bun run typecheck` xanh.

- [ ] **Step 5: Gate + e2e + commit**

```sh
bun run format && bun run check && bun run e2e
git add -A && git commit -m "refactor(web): split the api client, drop dead exports, share formatters"
```

---

### Task 9: Border active + guard mạnh hơn + e2e số đo + runbook

**Files:**
- Modify: `apps/web/src/features/knowledge/KnowledgePane.tsx:289`, `apps/web/src/features/mcp/McpPane.tsx:108`, `apps/web/src/features/settings/SettingsPane.tsx:271`, `apps/web/src/features/settings/ThemePicker.tsx:79`, `apps/web/src/features/settings/SettingsModal.tsx:181`
- Modify: `apps/web/src/lib/ui-invariants.test.ts`
- Modify: `tests/e2e/app.spec.ts`, `docs/runbook.md`

**Interfaces:**
- Produces: hàng active dùng `hairline` + `hairline-strong` (khi active) thay `border` 1px; guard bắt được cả conditional chia dòng và `border-<dir>`.

- [ ] **Step 1: Guard đỏ trước**

Trong `ui-invariants.test.ts`, mở rộng test border:

```ts
  test('no one-pixel border recipes survive', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) => {
          const bad =
            /border border-(border|ring|input|link|warning)\b/.test(line) ||
            /border-[lrtb] border-border\b/.test(line) ||
            /'border-ring'\s*:/.test(line) || // conditional active form
            /hover:border-(border|border-strong)\b/.test(line);
          return bad ? [`${rel}:${i + 1}`] : [];
        }),
    );
    expect(offenders).toEqual([]);
  });
```

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — 4 hàng active + `SettingsModal.tsx:181` (+ `hover:border-border-strong` ở `router.tsx:91`).

- [ ] **Step 2: Sửa 4 hàng active**

Mẫu (áp cho cả 4 file): bỏ `border` khỏi class nền, thêm `hairline`, và khi active thêm `hairline-strong`:

```tsx
className={`... rounded-md px-2 py-1.5 hairline ${active ? 'hairline-strong' : ''}`}
```

`SettingsModal.tsx:181`: `border-r border-border` → `hairline-l` + `border-l-0`? Chọn: dùng utility mới `hairline-r` (thêm vào `globals.css` cùng nhóm `hairline-l`).

- [ ] **Step 3: Sửa `router.tsx:91`** `hover:border-border-strong` → hover đổi sang `hover:bg-accent` (đã có) hoặc thêm `hover:hairline-strong`.

- [ ] **Step 4: e2e số đo kit**

Thêm vào `tests/e2e/app.spec.ts`:

```ts
test('kit controls keep their oc-2 metrics', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const metrics = await page.evaluate(() => {
    const px = (el: Element | null, prop: string) =>
      el ? getComputedStyle(el)[prop as never] : null;
    const btn = document.querySelector('[class*="h-7"]');
    const tag = document.querySelector('[class*="text-meta"]');
    return { buttonHeight: px(btn, 'height'), tagSize: px(tag, 'fontSize') };
  });
  expect(metrics.buttonHeight).toBe('28px');
  expect(metrics.tagSize).toBe('11px');
});
```

Run: `bun run e2e -- -g "oc-2 metrics"` → PASS, chạy 2 lần liên tiếp để kiểm không flaky.

- [ ] **Step 5: Runbook**

Thêm mục `## Verify UI` vào `docs/runbook.md`: (a) `bun run e2e` là cổng UI trong CI; (b) cách thêm spec đo computed style (mẫu trên); (c) ghi chú harness screenshot của agent không dùng được — dùng `tab.evaluate`/Playwright.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check && bun run e2e
git add -A && git commit -m "fix(web): hairline active states, stricter border guard, and a UI metrics e2e spec"
```

---

## Self-Review

**Spec coverage:** #5 → Task 4; #6 read-back → Task 3; #9 → Task 2; **#11 → đã sửa sẵn trong `apps/server/src/routes/prelude.ts` (chọn `BrowserActionSchema` cho browser) — chỉ còn ghi vào bảng ở Task 1**; bảng defect stale (#7/#11/#12/#13/#14/#16/#17) → Task 1; nợ cấu trúc (5 file) → Task 5, 6, 7, 8; export chết + hàm trùng → Task 8; border active + divider + guard + e2e số đo + runbook → Task 9. Ngoài phạm vi theo spec: #12 (theo dõi), #13 payload catalog, #15, đổi palette.

**Placeholder scan:** không có TBD/TODO; mọi step có lệnh + Expected. Hai chỗ cần đọc tên thật khi thực thi (đã ghi rõ trong step): hàm đọc level trong `AgentRuntime` (Task 3), danh sách 23 export của `tools.ts` (Task 7 Step 1).

**Type consistency:** `moveSessionRoute`, `thinkingGetRoute`, `formatDuration(ms: number): string`, `useChatSession(sessionId)` — mỗi tên dùng nhất quán trong task của nó; Task 9 gộp `formatDuration` về `lib/format.ts` và Task 6/10 không định nghĩa lại.

**Review Focus:** 1 → Task 6 Step 2/3 + Task 4 Step 2; 2 → Task 5 Step 1/2; 3 → Task 2 Step 1 (test 200 cho thư mục tồn tại); 4 → Task 1 Step 2 (ghi #11 đã sửa, kèm bằng chứng `prelude.ts` + probe 400) + mở pane Browser/Computer để chắc UI không gửi `capabilities` cho browser; 5 → Task 9 Step 4 (chạy e2e 2 lần).

---

## Thực thi (2026-09-22, inline)

Chạy inline trên `main` (convention cả session). Ledger nằm trong file này.

**Pre-flight scan (interface giữa các task):**

| Cặp | Produces vs Consumes | Kết quả |
|---|---|---|
| 1 → 4, 9 | bảng defect đã đối soát vs ghi chú #5/#18 | khớp — T1 làm trước |
| 2, 3 → 8 | route mới/sửa ở `apps/server` vs api-client (web) | không giao nhau |
| 3 → 8 | `GET /thinking` vs hooks.ts split | **lệch nhẹ**: T8 không bắt buộc thêm hook; ghi rõ "không thêm hook trong đợt này" |
| 5 → 9 | T5 thêm test vào `tests/e2e/app.spec.ts`, T9 cũng thêm | serial đúng thứ tự ✓ |
| 6 → 7 | cùng `packages/omp-adapter/src/` | serial ✓ |
| 9 → code cũ | guard border mới bắt `border border-(border\|ring\|input\|link\|warning)` | **xung đột**: `ChatPage.tsx:1007` (`border-warning`) và `PlanReview.tsx:24` (`border-link`) là **hộp cảnh báo ngữ nghĩa cố ý** → Ruling A |

- **Ruling A (Task 9):** guard border **không** cấm `border-warning`/`border-link` trên hộp alert (chúng là biên ngữ nghĩa, không phải chrome) — chỉ cấm form chrome: `border border-border`, `border border-ring`, `border-[lrtb] border-border`, conditional `'border-ring' :`, `hover:border-border-strong`. Cost nếu sai: hộp alert giữ 1px trong khi chrome dùng hairline (khác biệt có chủ ý, ghi trong docs).
- **Ruling B (Task 3):** không thêm hook web cho `GET /thinking` trong đợt này (không có nơi tiêu thụ); route + test là đủ, ghi lại để lần sau ai cần thì dùng.
- **Ruling C (Task 4):** #5 không hứa cải thiện tốc độ (nguồn là broker/SDK); chỉ chốt hợp đồng lỗi + ghi số đo.

| 1 Đối soát bảng defect | `b630aed` | Probe lại toàn bộ bằng `curl` trên server tươi (log: `ps` 1.27s warm / 9.95s cold, `describe` 400 trong 1.21s, `GET thinking` 404, browser `capabilities` 400 + computer 400 "computer is disabled", `move` 200 + tạo thư mục, `jobs` 404, `export` 42 909 434 B) → bảng §10 có cột **Trạng thái tại HEAD** + dòng **#18** (export 42 MB) + changelog; sửa ví dụ dead-export sai ở plan đợt 1. |

| 2 `/move` không tạo thư mục | `f90bf44` | Test mới `apps/server/src/routes/ops.test.ts`: RED (route trả `ok`, thư mục xuất hiện) → **GREEN 3 pass**; live sau khi restart server: `{"cwd":"/tmp/grove-defect9"}` → **400 `directory does not exist`** và `dir created: no`; thư mục tồn tại → 200. |

| 3 `GET /thinking` | `f8cd093` | Thêm `AgentRuntime.getThinkingLevel` + `SdkAdapter` impl + `getThinkingRoute` + nhánh GET trên `THINKING_PATH`; test mới RED (export thiếu) → **GREEN 3 pass**; live: `GET …/thinking` → **200 `{"thinking":"high"}`**, session lạ → 404, `POST banana` → 400. Ruling B: chưa thêm hook web (không có nơi tiêu thụ trong đợt này). |

| 4 Hợp đồng lỗi process plane | `b39e3ea` | Đo lại: `ps` **cold 9.95s / warm 1.27s**, `describe nope` 400 trong **1.21s** (warm) — nguồn là broker/SDK. Tách `unknownProcessTarget` + `mapProcessError` khỏi catch inline (không đổi hành vi) để test được; test mới `packages/omp-adapter/src/hub-process.test.ts` **4 pass**: promise treo → `RuntimeUnavailableError` nêu 20s + scope; `broker.sock` → 503; `InvalidRequestError` giữ 400; lỗi lạ giữ nguyên type. Ruling C: không hứa cải thiện tốc độ. |

| 5 Tách `ChatPage.tsx` | `269431e` | **1179 → 382 dòng**; thêm `tool-tabs.ts` (bảng tab, trước bị lặp 3 nơi), `ToolPane.tsx` (126), `ToolRail.tsx` (dùng `IconButton`), `use-chat-session.ts` (707), `chat-commands.ts` (98, nhận mutation qua deps có type). Verify: `bun run check` xanh + **`bun run e2e` 9/9** (spec sẵn có phủ session page/tabs/palette/theme). **Ruling D:** hook 707 dòng — 7 dòng trên ngưỡng 700 của plan, vì đây là một state machine; 5 file god mà spec nêu đều đã dưới 700. Ghi chú: invariant `icon-only controls` bắt được 2 nút trong pane/rail khi tách → chuyển sang `IconButton` luôn. |

| 7 Tách `omp-adapter/tools.ts` | `49191b9` | **1972 → 269 dòng**; thêm `tools/core.ts` (508, registry + `ensureEntry`/`runTool`), `tools/files.ts` (332), `tools/shell.ts` (447), `tools/lsp.ts` (372), `tools/debug.ts` (400), `tools/todos.ts` (196), `tools/prelude.ts` (208). Bảng tool không còn với tới từ core: `ensureEntry` hỏi qua `setToolTableFactory` do `createSessionTools` đăng ký — phá vòng core ↔ impl bằng đúng kiểu late-binding core đã dùng cho approval bridge. Verify: `bun run check` xanh + `bun run smoke:server` OK + smoke tạm gọi **mọi module qua HTTP** (files read/list/glob/grep, bash, cells, jobs, lsp status, debug sessions, todos, artifacts) đều OK. **Ruling C:** đổi thứ tự — làm Task 7 trước Task 6 vì tools.ts là hàm module (rủi ro thấp, oracle typecheck nhanh), còn sdk.ts là class 1733 dòng cần chuỗi base class. |
| 6 Tách `omp-adapter/sdk.ts` | `eadbd56` | **2091 → 533 dòng**; thêm `sdk/helpers.ts` (233), `sdk/core-base.ts` (571, abstract, fields+ctor+lifecycle+approvals+events), `sdk/goal-base.ts` (259, goal/loop), `sdk/modes-base.ts` (638, plan/vibe/queue/plugins/foreign/plan-review/worktree); `sdk.ts` chỉ còn `SdkAdapter extends SdkModesBase implements AgentRuntime`. Điểm mấu chốt: base class không thấy member của subclass nên mọi lời gọi hướng xuống được khai báo **abstract** (`ensureSession`, `attach`, `emit`, `infoOf`, `shareSettingsWithTools`, `runLoopIteration`) thay vì thành `any` âm thầm. Verify: test adapter 48/48, `bun run check` xanh, `bun run smoke:server` OK (tạo session thật qua runtime đã tách), tools smoke OK, `bun run e2e` 9/9. |
| 8 Tách api-client + export chết + formatter | `39e4ee4` | `rest.ts` 1388 → **5 dòng** (barrel) + `rest/{core 101, sessions 560, tools 435, hub 145, settings 265}`; `hooks.ts` 1235 → **5 dòng** + `hooks/{core 74, sessions 558, tools 291, hub 118, settings 248}` — mọi file < 700. Export chết: **11 symbol** có đúng 1 dòng tham chiếu (chính định nghĩa) → bỏ `export` (ui 10 props type + `SpawnEffort`); plan ghi core 4 nhưng nay đã sạch (0) — ledger ghi rõ sai lệch. Gộp `formatDuration` (2 bản: Message + BackgroundJobs) và `errorMessage` (LspPanel) về `lib/format.ts`, test pin 45ms/1.5s/1m30s. Verify: `bun run check` xanh + `bun run e2e` 9/9. |
| 9 Border active + guard + e2e + runbook | `fc7e56e` | 4 hàng active đổi sang recipe kit: `panel-plain` → `panel-plain-active` (utility **riêng**, không dùng `panel-plain` + `hairline-strong`, để thứ tự stylesheet không quyết định màu); card cảnh báo dùng `panel-link`/`panel-warning`; nav Settings dùng `hairline-r` mới. Guard mở rộng bắt `border border-(ring/input/link/warning)`, `border-<dir> border-border`, `'border-ring':` và `hover:border-*` — **đỏ trước, xanh sau**. **Phát hiện khi verify:** modal Settings thiếu wrapper hàng khi chuyển sang `<Dialog>` (root `flex flex-col`) → nav + pane xếp dọc, shell cao 2581px trong khung 85vh; đã sửa + e2e đo khung (fail trên markup cũ, pass sau). Thêm mục `## Verify UI` vào runbook, gồm phát hiện: Blink làm tròn `border-width` theo device pixel nên 0.5px đọc ra `1px` → phải assert trên stylesheet đã compile. Verify: `bun run check` xanh, `bun run e2e` **12/12 hai lần liên tiếp**. |
