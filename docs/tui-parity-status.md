# TUI parity status — single source of truth

> Cập nhật file này **mỗi khi làm xong bất kỳ phần nào** (kể cả khi phát hiện gap mới). Đây là bảng theo dõi duy nhất; `docs/architecture.md` §9b giữ *lịch sử đợt* và trỏ về đây.
>
> **Trạng thái:** ✅ done (có surface + đã verify chạy thật) · 🟡 partial (có nhưng thiếu phần sâu) · ⬜ not done · 🚫 non-goal (cố ý không làm)

## Cách cập nhật (bắt buộc)

1. Khi xong 1 mục: đổi trạng thái, ghi **Evidence** = lệnh/route/UI cụ thể đã chạy và kết quả quan sát được (không ghi "đã implement").
2. Mục mới phát hiện (gap TUI chưa có trong bảng): thêm dòng vào đúng khu vực, mặc định `⬜`.
3. Thêm 1 dòng vào **Changelog** ở cuối: `YYYY-MM-DD · <mục> · <evidence ngắn> · commit`.
4. Nếu đổi non-goal → ghi lý do trong mục "Quyết định".

---

## 1. Nền tảng

| Hạng mục | Hiện tại | Trạng thái | Evidence |
|---|---|---|---|
| Kiến trúc | web thin client → server gateway → `AgentRuntime` (SDK OMP in-process, SDK-only) | ✅ | `packages/agent-runtime/src/runtime.ts` (55 method), `apps/server/src/routes/` (26 module) |
| Wire contract | zod + version compat check | ✅ | `packages/protocol/src/` |
| Web surface | 18 feature dir, 17 tab trong ChatPage | ✅ | `apps/web/src/features/`, `ChatPage.tsx` |
| Gate | `bun run check` = typecheck + lint + 76 test / 13 file | ✅ | `bun run check` green |
| Desktop shell | spec + plan, chưa scaffold | ⬜ | `docs/desktop-*.md` |

## 2. Chat

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Streaming text | delta qua WS, virtualized transcript | ✅ | `Transcript.tsx`, `stream/` |
| Reasoning riêng | channel `thinking-delta`, render collapse | ✅ | `Message.tsx`, mapping |
| Enter steer / Ctrl+Enter queue | per-message behavior + shorthand `->`/`=>` | ✅ | `Composer.tsx`, `prompt.ts` |
| Esc abort giữ draft | abort, draft giữ | ✅ | `ChatPage.tsx` |
| Retry turn | `/retry` + menu | ✅ | `ops.ts` |
| Approval modal | Approve/Deny, timeout 120s = deny (in-turn + out-of-turn) | ✅ | `ChatPage.tsx`, `tools.ts` |
| Đính ảnh | paste/file, base64 | ✅ | `PromptImageSchema` |
| Command palette | Cmd+K, session actions | ✅ | `features/palette/` |
| Composer autocomplete: `/` + `@file` | menu lệnh (Tab/Enter nhận, Esc đóng, đóng khi đã commit) + mention file qua glob workspace | ✅ | verify: `/pl` → 5 gợi ý, Enter → `/plan `, không gửi; `@features/chat/Co` → 2 file, click → `@apps/web/src/features/chat/Composer.tsx ` |
| Footer stats | token/cost/context%/tools/msgs + ngưỡng màu như TUI | ✅ | `SessionFooter.tsx`, `context-usage.ts` |
| `/btw`, `/append`, `/live`, `/skillful`, `/tan`, `/omfg` | — | ⬜ | không có surface |

## 3. Sessions & tree

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| List + metadata | messageCount/sizeBytes/status (interrupted/aborted/error/pending) | ✅ | `sessions.ts`, `SessionSidebar.tsx` |
| fork / clear / fresh / compact / retry / drop | OpsBar + menu | ✅ | `OPS` route, `OpsBar.tsx` |
| rename / move (re-root) | menu inline | ✅ | `sessions.ts` |
| share / export HTML / dump journal | menu, `?theme=user` | ✅ | `share.ts`, `ops.ts` |
| Tree: navigate/branch/label/search/filter | TreePanel | ✅ | `tree.ts`, `TreePanel.tsx` |
| Session stats | panel đầy đủ + context breakdown | ✅ | verify: `tokens.total 19822`, breakdown 5 category = usedTokens |
| Workspace multi-root (`/add-dir`, `/dirs`, `/remove-dir`) | panel session info + picker | ✅ | verify: add/remove/403/409/restart persistence |
| Goal (`/goal set/show/pause/resume/drop/budget`) | GoalStrip + `/goal` | ✅ | verify: budget in-place giữ id+usage, 409 khi streaming |
| Goal auto-continuation | adapter-owned loop 800ms | ✅ | verify: `goal_continuation_requested` path |
| `/guided-goal` | — | ⬜ | |
| `/resume`, `/switch`, `/pin`, `/exit`, `/quit` | sidebar switch/pin/delete | 🟡 | không có cú pháp lệnh |
| `/rewind` (tool), checkpoint | chỉ `retryTurn` | 🟡 | |

## 4. Modes

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Plan enter/exit + propose→approve | adapter proposal handler + panel Approve&execute / keep / Refine | ✅ | verify: `xd://propose` → "Plan ready for review", approve → file thực thi |
| Plan phần sâu: role model `plan` + restore, toolset snapshot/restore, `/plan-review`, `plan.defaultOnStartup` | — | ⬜ | |
| Vibe toolset swap + worker registry + killAll | đủ | ✅ | verify: worker `fast` chạy `echo worker-ok`; tắt → tool biến mất |
| Goal mode | GoalStrip | ✅ | |
| Loop (`/loop`, limit, `loop.mode`, pause/stop) | LoopStrip + `/loop` | ✅ | verify: limit 3 → 3 iteration rồi tự tắt; pause/stop OK |
| Advisor / Fast tier | ModesPanel | ✅ | |
| steering / followUp / interrupt, prewalk | ModesPanel | ✅ | |
| Loại trừ plan↔vibe↔goal | 409 + UI blocker | ✅ | verify: `/vibe` khi plan on → 409 `exit plan mode first` |
| `plan.enabled` / `goal.enabled` gate | adapter check (`plan.enabled`) | 🟡 | goal.enabled chưa check |

## 5. Tools

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| read/write/edit/list (out-of-turn) | `/api/sessions/:id/files*` | ✅ | `files.ts` |
| bash (env/pty/background/jobId) | route + pane | ✅ | `bash.ts` |
| Background jobs: list + live tail + cancel | `GET /api/sessions/:id/jobs`, `POST .../jobs/:id/cancel`; section trong Terminal pane | ✅ | verify: detach `seq 1 20` → tail `line-1..8` lớn dần; cancel → `{"cancelled":true}`, status `cancelled`, **process gone**; job lỗi → `failed` + `errorText`; UI: `1 running` → Stop → `0 running`/`cancelled`, Output hiện `live-1..5` |
| Notebook cells | NotebookPane | ✅ | `cells.ts` |
| LSP 14 action | LspPanel + raw passthrough | ✅ | `lsp.ts` |
| Debug 28 action | DebugPanel | ✅ | `debug.ts` |
| Todo | TodosPane | ✅ | `todos.ts` |
| Artifacts | ArtifactsPane | ✅ | `artifacts.ts` |
| Conflict resolve (`@ours/@theirs/@base/@both`) | panel + bulk | ✅ | `conflicts.ts` |
| Multiple selectors (`archive:`, `db.sqlite:`, internal schemes) | qua jail | ✅ | `jail.ts` |
| Truncation + next page + artifact link | Transcript/tool view | ✅ | `SessionFooter`/tool render |
| `/tools` (liệt kê tool đang bật) | — | ⬜ | |
| glob/grep out-of-turn (nền cho mention + search) | `GET /api/sessions/:id/glob` (SDK `find` tool) | 🟡 | verify: `**/*Composer*` → 1 path; `packages/core/src/*.ts` → 8 path; thiếu pattern → 400. `grep` chưa có |
| `/browser`, `/computer` | — | ⬜ | tool là eval prelude (`browser.enabled`), chưa verify, chưa có pane |
| `/security` (security scan) | — | ⬜ | |
| `/ssh`, `/wt` (worktree), `/git` | — | ⬜ | spawn isolation có `worktree` nhưng không có lệnh/quản lý |
| `/mcp` (server + tools + discover) | McpPane | ✅ | `mcp.ts` |
| Extensions/hooks/marketplace (`/install`, `/marketplace`, `/plugins`, `/reload-plugins`, `/extensions`, `/smithery-search`) | — | ⬜ | 0 tham chiếu trong repo |

## 6. Hub & jobs

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Roster + metrics + unread + revivable | HubPanel | ✅ | `hub.ts` |
| Transcript (live/journal) | viewer | ✅ | |
| Jobs snapshot (running + recent + result) | JobsPanel | ✅ | |
| Spawn đủ option (model/effort/isolation/detached/schemaMode) | SpawnWizard | ✅ | |
| Per-agent knobs (model override/prewalk/advisor) | AgentKnobsPane | ✅ | |
| Messaging send/inbox/wait | qua IrcBus | ✅ | |
| Persisted roster restore | sau restart | ✅ | |
| Supervised processes (`hub start/ps/logs/stop`) | — (đã thử, revert) | ⬜ | `start` timeout 65s môi trường này |
| `/collab`, `/join`, `/leave` (live host/guest, E2EE) | — | ⬜ | `/share` là snapshot tĩnh |

## 7. Settings plane

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Toàn bộ settings schema (476 key) | SettingsPane schema-driven, enum dùng select/chip | ✅ | `settings.ts`, `SettingsModal.tsx` |
| Masking secret | credential flag; `auth.broker.*Url` không ẩn; chặn ghi rỗng | ✅ | verify ở đợt P4 |
| Model roles table + gán model | ModelRolesPane | ✅ | verify: PUT role → spawn nhận giá trị mới |
| Theme 2 slot dark/light | ThemesPane | ✅ | |
| Providers (status/auth mode) | ProvidersPane | 🟡 | OAuth login/logout chưa làm (cần callback/TTY) |
| Skills | session-scoped, preview SKILL.md | ✅ | verify: cwd repo → 2 skill, cwd khác → skill riêng |
| Memory | session-scoped, 8 op + search + backend switch re-init | ✅ | verify: `off → local` status active; search unsupported → 400 |
| Memory mental models (`/memory mm …`) | — | ⬜ | |
| Memory file `memory://` browse/edit | read path có, UI chưa | ⬜ | |

## 8. Quyết định (non-goal)

- 🚫 Không fork OMP; không re-implement session store / model registry / MCP lifecycle / credential ladder ở frontend.
- 🚫 Browser không parse JSONL; mọi state chuẩn ở gateway + SDK.
- 🚫 Không host collab relay (dùng relay OMP mặc định, local-only là chính).
- 🚫 Surface browser-first: pane/modal thay vì lệnh; chỉ giữ slash command cho thao tác hay dùng.

## 9. Caveat đã biết

- `bun run check` **không** bắt import tới module đã xoá (`export {} from './x.js'`): lọt typecheck, crash lúc runtime. Đã gặp 1 lần (settings-knowledge).
- Skills pane khớp session discovery, **không** khớp 100% danh sách model thấy (plugin skills như opencode provider không nằm trong `session.skills`).
- Loop pause: turn đang chạy vẫn xong, chỉ dừng re-submit.
- Mode loại trừ enforce ở adapter (409); gọi API trực tiếp không tự exit mode kia.

---

## Changelog

- 2026-09-19 · Background jobs: session jobs route + live tail + cancel, section trong Terminal pane (kèm badge running, Output expander, Stop) · verify như trên · commit `f085965`

- 2026-09-19 · Composer autocomplete: `/` menu (Enter/Tab nhận, Esc đóng, đóng sau khi commit) + `@file` mention; thêm route `glob` out-of-turn · verify bằng browser: `@features/chat/Co` → 2 gợi ý, click chèn path; `/pl` Enter → `/plan ` không gửi tin · commit `c7b8630`

- 2026-09-19 · Tạo file · tổng hợp từ verify các lượt: sessions/stats, workspace, plan, goal, loop, vibe, memory · commits `de98fb3`, `9a02a7d`, `dcb6f51`, `730edc7`, `6ac6b4c`
