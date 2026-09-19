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
| Gate | `bun run check` = typecheck + lint + test (92/16) + **server smoke** | ✅ | smoke boot server + 13 route probe; verify: import hỏng → smoke fail kèm module error |
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
| Message actions: copy / branch / edit-and-resend | nút copy mọi message; user message có "Branch from here" (mới nhất: "Edit and resend") → tạo session mới, text thành draft | ✅ | verify: click Edit&resend → URL session mới + composer `Reply with exactly: second-turn`; session mới giữ 3 message root→branch; copy đổi icon; assistant không hiện nút branch. **Cần transcript khớp branch** (adapter gắn `entryId` chỉ khi khớp, ngược lại ẩn nút) |
| Composer autocomplete: `/` + `@file` | menu lệnh (Tab/Enter nhận, Esc đóng, đóng khi đã commit) + mention file qua glob workspace | ✅ | verify: `/pl` → 5 gợi ý, Enter → `/plan `, không gửi; `@features/chat/Co` → 2 file, click → `@apps/web/src/features/chat/Composer.tsx ` |
| Footer stats | token/cost/context%/tools/msgs + ngưỡng màu như TUI | ✅ | `SessionFooter.tsx`, `context-usage.ts` |
| `/btw` (side question, không vào transcript) | `/btw <câu hỏi>` + panel kết quả, dismiss được | ✅ | verify: hỏi "last user message" → trả lời đúng; `totalMessages` 2 → 2 (không ghi transcript); câu hỏi rỗng → 400 |
| `/append` (todo subcommand) | — | ⬜ | Todos pane có op riêng, chưa có cú pháp |
| `/live`, `/skillful`, `/tan`, `/omfg` | — | 🚫 | voice realtime / skill listing / background agent clone / TUI-only: không có giá trị cho web |

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
| `/guided-goal` | `/guided-goal [idea]` → interview kickoff, tool `goal` được bật | ✅ | verify: kickoff → agent hỏi đúng 1 câu; `goal` tool active |
| `/resume`, `/switch`, `/pin`, `/exit`, `/quit` | sidebar switch/pin/delete | 🟡 | không có cú pháp lệnh |
| `/rewind` (tool), checkpoint | chỉ `retryTurn` | 🟡 | |

## 4. Modes

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Plan enter/exit + propose→approve | adapter proposal handler + panel Approve&execute / keep / Refine | ✅ | verify: `xd://propose` → "Plan ready for review", approve → file thực thi |
| Plan deep: role model `plan` + restore, `/plan-review` | đủ (toolset snapshot không cần: SDK guard đã ép read-only, toolset không đổi) | ✅ | verify: `deepseek-v4.1-flash` → plan on → `deepseek-v4-flash` → approve&keep/toggle off → về `deepseek-v4.1-flash`; `GET /plan` trả draft `'/Users/phonnt/.omp/agent/sessions/-Documents-00.AI-AI-GUI/2026-09-14T04-09-00-028Z_01a09e1a-9f7c-7000-9d28-3c143a628cfd/local/readme-badge-plan.md'` 3923 bytes + title |
| `plan.defaultOnStartup` | — | ⬜ | |
| Vibe toolset swap + worker registry + killAll | đủ | ✅ | verify: worker `fast` chạy `echo worker-ok`; tắt → tool biến mất |
| Goal mode | GoalStrip | ✅ | |
| Loop (`/loop`, limit, `loop.mode`, pause/stop) | LoopStrip + `/loop` | ✅ | verify: limit 3 → 3 iteration rồi tự tắt; pause/stop OK |
| Advisor / Fast tier | ModesPanel | ✅ | |
| steering / followUp / interrupt, prewalk | ModesPanel | ✅ | |
| Loại trừ plan↔vibe↔goal | 409 + UI blocker | ✅ | verify: `/vibe` khi plan on → 409 `exit plan mode first` |
| `plan.enabled` / `goal.enabled` gate | adapter check cả hai (409 + lý do) | ✅ | verify: `goal.enabled=false` → `/goal set` và `/guided-goal` đều 409 `goal mode is disabled in settings (goal.enabled)`; bật lại → chạy |

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
| `/tools` (liệt kê tool đang bật) | tab Tools: name + active/inactive + source + filter | ✅ | verify: idle 19 tool/11 active; plan on → `write` active; vibe on → active chỉ còn `read, todo, vibe_*` |
| glob/grep out-of-turn | `GET /api/sessions/:id/glob` (SDK `find`) + `GET …/grep` (SDK `grep`) | ✅ | verify: glob `**/*Composer*` → 1; grep `onBudgetMutated` → 2 file + text render của SDK; scope `path=packages/core` → 3 file; thiếu pattern → 400 |
| Search nội dung trong Explorer | ô search + results (file + count) + click mở file | ✅ | verify UI: `createAgentSession` → 3 file (2/3/5 match), click row → mở editor |
| `/browser`, `/computer` | — | ⬜ | tool là eval prelude (`browser.enabled`), chưa verify, chưa có pane |
| `/security` (security scan) | tab Security: preflight/scan/status/cancel + raw report | ✅ | verify: preflight trả lỗi actionable của scanner (cần OAuth cho provider) thay vì "disabled"; action sai → 400 |
| `/wt` (worktree), `/move` | `/wt [branch]` → tạo worktree + session theo sang đó | ✅ | verify: `{"path":"…/wt/wt-probe-3-…","branch":"wt/probe-3"}`; tool cwd theo (`pwd` = worktree); write/read ở worktree, source checkout sạch |
| `/ssh` (quản lý host), `/git` | — | ⬜ | ssh đi qua `read ssh://`; git dùng qua bash |
| `/mcp` (server + tools + discover) | McpPane | ✅ | `mcp.ts` |
| `/plugins list`, `/extensions` | tab Plugins: name/version/enabled/source + extension roots, Refresh | ✅ | verify: plugin probe trong `~/.omp/agent/plugins` → liệt kê `probe-plugin@1.0.0 npm enabled`; gỡ → 0 |
| `/install`, `/marketplace`, `/reload-plugins`, `/smithery-search` (install/enable) | — | ⬜ | cần package-manager TTY; tab Plugins chỉ đọc |

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
| Memory mental models (`/memory mm …`) | op `mm-list/show/history/refresh/delete` (Hindsight) + UI trong Knowledge pane | ✅ | verify: `mm-list` không có Hindsight → lỗi rõ ràng `hindsight backend is not active` (500) |
| Memory file `memory://` browse | nút summary/MEMORY.md/learned.md trong Knowledge pane | ✅ | verify: scheme resolve được (`Memory file not found` thay vì `Unknown protocol`), nút đọc qua `files?path=memory://root/...` |

## 8. Quyết định (non-goal)

- 🚫 Không fork OMP; không re-implement session store / model registry / MCP lifecycle / credential ladder ở frontend.
- 🚫 Browser không parse JSONL; mọi state chuẩn ở gateway + SDK.
- 🚫 Không host collab relay (dùng relay OMP mặc định, local-only là chính).
- 🚫 Surface browser-first: pane/modal thay vì lệnh; chỉ giữ slash command cho thao tác hay dùng.

## 9. Caveat đã biết

- ~~`bun run check` không bắt import tới module đã xoá~~ → **đã fix**: gate giờ boot server (`scripts/smoke-server.ts`), verify bằng cách cố tình thêm import hỏng.
- Skills pane khớp session discovery, **không** khớp 100% danh sách model thấy (plugin skills như opencode provider không nằm trong `session.skills`).
- Loop pause: turn đang chạy vẫn xong, chỉ dừng re-submit.
- Mode loại trừ enforce ở adapter (409); gọi API trực tiếp không tự exit mode kia.

---

## Changelog

- 2026-09-19 · gate `goal.enabled` cho `/goal set` + `/guided-goal` · verify như trên · commit `913ea51`

- 2026-09-19 · `/wt` (worktree) + **fix**: cwd của out-of-turn tools (và jail) giờ theo session khi move/worktree (trước đó ghi vào checkout cũ) · commit `e1cd103`

- 2026-09-19 · `/plugins list` + `/extensions` (tab Plugins) · verify với plugin probe · commit `1b8ecd1`

- 2026-09-19 · `/btw` (ephemeral side question) · verify: không tăng message count · commit `66052e3`

- 2026-09-19 · `/security` (raw passthrough + tab), `/memory mm …`, memory-file buttons, `/guided-goal` · **fix gốc**: out-of-turn tools giờ đọc settings/registry/auth/model thật của session (trước đó dùng stub isolated → mọi tool bỏ qua config người dùng) · verify như trên · commit `270ea4f`

- 2026-09-19 · `/tools`: `GET /api/sessions/:id/tools` + tab Tools (active/source/filter) · verify như trên · commit _pending_

- 2026-09-19 · Plan deep: role model `plan` (+restore cả 2 đường exit) + `GET /api/sessions/:id/plan` + `/plan-review` · verify như trên · commit `b0155c7`
- 2026-09-19 · Phát hiện harness rewrite `local` scheme literal trong file ghi ra → đã sửa 4 chỗ + ghi rule vào `.omp/RULES.md`

- 2026-09-19 · grep out-of-turn + search trong Explorer · verify như trên · commit `b0155c7`

- 2026-09-19 · Message actions: copy từng message, branch/edit-and-resend ở user message (kèm `entryId` trên `ChatMessage` + guard khớp branch) · verify như trên · commit `6c5f052`

- 2026-09-19 · Background jobs: session jobs route + live tail + cancel, section trong Terminal pane (kèm badge running, Output expander, Stop) · verify như trên · commit `f085965`

- 2026-09-19 · Composer autocomplete: `/` menu (Enter/Tab nhận, Esc đóng, đóng sau khi commit) + `@file` mention; thêm route `glob` out-of-turn · verify bằng browser: `@features/chat/Co` → 2 gợi ý, click chèn path; `/pl` Enter → `/plan ` không gửi tin · commit `c7b8630`

- 2026-09-19 · Tạo file · tổng hợp từ verify các lượt: sessions/stats, workspace, plan, goal, loop, vibe, memory · commits `de98fb3`, `9a02a7d`, `dcb6f51`, `730edc7`, `6ac6b4c`
