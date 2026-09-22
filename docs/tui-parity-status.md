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
| Gate | `bun run check` = typecheck + lint + test (**101** pass / 19 file) + **server smoke** | ✅ | `bun run check` → `101 pass, 0 fail` + `server smoke OK (health + global routes + session routes)`; verify: import hỏng → smoke fail kèm module error |
| Desktop shell | Tauri v2 (`apps/desktop`) serve web dist + sidecar `grove-server`; bundle `Grove.app`, DMG/zip `Grove-0.1.0-*`; CI job `verify`/`windows` xanh. Auto-update **wired nhưng chưa verify e2e** (chưa host manifest) | ✅ | `bun run smoke:sidecar` → `sidecar smoke OK (health + session)`; `bun run smoke:bundle` → `bundle smoke OK` (launch `.app`, sidecar thoát theo app); `cd apps/desktop/src-tauri && cargo test` → 4 passed; `docs/runbook.md#desktop`, `docs/desktop-release.md`, commit `cdf8b47` |

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
| `/append` (subcommand của `/todo`) | Todos pane có đủ 6 op (`init/start/done/block/unblock/append`) | ✅ | không cần cú pháp lệnh |
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
| `/pin` | sidebar pin, lưu `localStorage` | ✅ | verify: `store.ts` loadPins/togglePin ghi localStorage |
| `/resume <id|title>` | `/resume <id hoặc một phần title>` → nhảy session | ✅ | sidebar + switcher vẫn là đường chính |
| **`/resume @claude\|@codex`** (import session ngoài) | nút Import ở sidebar + `/resume @codex` → dialog chọn nguồn/lọc/import | ✅ | verify: 52 session Codex liệt kê; import 1 → session mới trong list, transcript 62 message, **file nguồn không đổi** |
| `/switch <model\|provider/id\|@role>[:level]` | `/switch` dùng resolver của SDK (`resolveCliModel`) | ✅ | verify: `glm-5.1` (fuzzy), `opencode-go/deepseek-v4-pro:high` (model+level), `@slow` (role), rác → 400 |
| `/exit`, `/quit` | — | 🚫 | thoát process: tab là app, server phục vụ nhiều client |
| `/rewind` (tool), checkpoint | chỉ `retryTurn` | 🟡 | |

## 4. Modes

| TUI | Web | Trạng thái | Evidence |
|---|---|---|---|
| Plan enter/exit + propose→approve | adapter proposal handler + panel Approve&execute / keep / Refine | ✅ | verify: `xd://propose` → "Plan ready for review", approve → file thực thi |
| Plan deep: role model `plan` + restore, `/plan-review` | đủ (toolset snapshot không cần: SDK guard đã ép read-only, toolset không đổi) | ✅ | verify: `deepseek-v4.1-flash` → plan on → `deepseek-v4-flash` → approve&keep/toggle off → về `deepseek-v4.1-flash`; `GET /plan` trả draft `'/Users/phonnt/.omp/agent/sessions/-Documents-00.AI-Grove/2026-09-14T04-09-00-028Z_01a09e1a-9f7c-7000-9d28-3c143a628cfd/local/readme-badge-plan.md'` 3923 bytes + title |
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
| `/browser`, `/computer` | tab Browser: mode Web/Desktop — open/url/title/ariaSnapshot/screenshot/click/type (Web), capabilities/displays/windows/screenshot (Desktop); row của ariaSnapshot click được (`aria-ref=eN`) | 🟡 | prelude passthrough `POST /api/sessions/:id/{browser,computer}` (gate `browser.enabled`/`computer.enabled` đọc **live** settings). verify: `browser.enabled=false` → 400 rõ ràng; open → `https://example.com/` + title `Example Domain`; ariaSnapshot → ref `e2…e6`, click row → `aria-ref=e6`; `evaluate` chạy JS → url đổi sang `www.iana.org/…`; `computer.enabled=false` → 400, `capabilities` → `Computer capabilities unavailable`, `displays` → `PermissionDenied: macOS Screen Recording permission is not granted`. Còn 🟡: máy này thiếu display/native input nên `click`/`screenshot` fail (`cannot use null as rangeable`) kể cả khi gọi thẳng prelude trong process, và `/computer` cần Screen Recording permission → phải verify lại trên desktop thật |
| `/security` (security scan) | tab Security: preflight/scan/status/cancel + raw report | ✅ | verify: preflight trả lỗi actionable của scanner (cần OAuth cho provider) thay vì "disabled"; action sai → 400 |
| `/wt` (worktree), `/move` | `/wt [branch]` → tạo worktree + session theo sang đó | ✅ | verify: `{"path":"…/wt/wt-probe-3-…","branch":"wt/probe-3"}`; tool cwd theo (`pwd` = worktree); write/read ở worktree, source checkout sạch |
| `/ssh` (quản lý host) | section **SSH hosts** trong tab Explorer: chọn scope user/project, form name+host, xoá từng host | ✅ | adapter bọc `ssh/config-writer` của SDK (`addSSHHost`/`removeSSHHost`/`listSSHHosts`/`validateHostName`) + `getSSHConfigPath`; route `GET/POST/DELETE /api/sessions/:id/ssh`. Verify live (dev server :8787): list rỗng → `{"hosts":[]}`, add → `{"hosts":["probe"]}`, trùng → 400 `ssh host already exists: probe`, body thiếu → 400 nêu tên field, delete → `{"hosts":[]}`; config ghi vào `<cwd>/.omp/ssh.json`. e2e `the explorer manages ssh hosts end to end` (thêm qua UI → có trong server → xoá) · commit `23c040a` |
| `/git` | section **Git** trong tab Explorer: branch (hoặc `detached HEAD`), danh sách file đổi kèm ký tự trạng thái + `+n −m`, click xem diff inline | ✅ | adapter `gitStatus`/`gitDiff` chạy git qua chính tool path của bash (cwd session, sandbox, approval) và parse bằng `parseNumstat` của SDK (không kéo native `pi-natives/vcs`); route `GET /api/sessions/:id/git?action=status|diff&path=`. Verify: adapter 2/2 (repo tạm: branch, file, insertions; ngoài repo degrade `{}`), route 3/3, e2e `the explorer reports the git branch of the session cwd` (cwd = repo thật), `bun run check` xanh, `bun run e2e` 15/15 · commit `c1fd0a4` |
| `/mcp` (server + tools + discover) | McpPane | ✅ | `mcp.ts` |
| `/plugins list`, `/extensions` | tab Plugins: name/version/enabled/source + extension roots, Refresh | ✅ | verify: plugin probe trong `~/.omp/agent/plugins` → liệt kê `probe-plugin@1.0.0 npm enabled`; gỡ → 0. **Audit 2026-09-21** phát hiện `GET /api/plugins` → `{"plugins":[]}` dù `~/.omp/plugins/installed_plugins.json` có plugin marketplace → **đã sửa**: `listPlugins()` merge registry `installed_plugins.json`, verify `superpowers 6.3.0 (source superpowers-marketplace)` + `caveman 2.7.0` (xem §10 #4) |
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
| Supervised processes (`hub start/ps/logs/stop`) | section **Supervised processes** trong tab Terminal: form start (name/application/args/ready log/ready port/timeout), list kèm state/pid/uptime/ready match, Logs + Follow (live tail), Restart, Stop | 🟡 | route `POST /api/sessions/:id/process` (gate `launch.enabled` đọc live settings; op `start/ps/logs/stop/restart/describe/send/wait`). **Audit 2026-09-21 + fix**: start/ready(log+port)/logs/stop/cleanup chạy thật (process chết thật sau stop, không leak). Đã sửa: `describe` tên lạ → **400**, session lạ → **404**, call bound **20s** → **503** kèm hint thay vì treo 23–35s+ rồi 500; broker sống đo được **4ms/2ms**, cold spawn ~12s (vẫn là chi phí của SDK). Daemon đã stop vẫn hiện trong `ps` (theo semantics của SDK, giữ nguyên cho parity). verify: `ps` → 14 daemon (chung broker với harness: `omp.lsp.mux`, `omp.browser.headless`, process do `hub` start); start `bun -e …` + ready log → `ready pid=31102`, `Ready log matched: probe-ready`; port readiness → `ready pid=35699` + port trả HTTP 200; `logs` → `probe-ready\ntick\n[…cursor=19]`; `send` stdin → `cat` echo `hello-stdin`; `stop` → `exited exit=1`; `describe` → command + cwd; op sai → 400, thiếu `application` → 400. UI verify (browser): Start từ form → row `ready pid=51068`; Logs → window `f-1…f-35`; Follow → window trượt `f-28…f-126` (cap 99 dòng, không nhân bản); Stop khi đang follow → `exited`. Lưu ý: mỗi call `logs` spawn worker render nên tốn ~10-20s/lần — Follow là long-poll tuần tự, không poll nhanh |
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

## 10. Defect chức năng đã xác nhận (audit 2026-09-21)

Audit 1 lượt: HTTP plane (4 slice: file/tool, sessions, settings, hub/runtime — 79 check) + UI/model turn thật (stream, tool card, abort, plan, 21 pane). Các lỗi dưới đây **tôi tự tái hiện bằng tay** (trừ khi ghi rõ "agent"). Thứ tự theo mức độ.

| # | Mức | Defect | Trạng thái tại HEAD (đối soát 2026-09-22) | Evidence (lệnh → kết quả) |
|---|---|---|---|---|
| 1 | **major** | Session vừa tạo **vô hình** trong `GET /api/sessions` cho tới khi có journal trên đĩa (`listSessions` = `SessionManager.listAll()` đọc đĩa) | ĐÃ SỬA (đợt 1) | `POST /api/sessions` → 200 (id `01a0c193…`), `ls ~/.omp/agent/sessions/*/*01a0c193*` → rỗng, `GET /api/sessions` → `new present: False` (lặp 4 lần, 3 lần do agent) |
| 2 | **major** | Fork session **chưa flush** → session **nguồn biến mất**: `POST …/fork` 200 rồi nguồn 404 + không còn trong list. Session đã có journal thì nguồn sống bình thường (200) | ĐÃ SỬA (đợt 1) | `POST …/fork` (nguồn 0 file journal) → `fork in list: True / source in list: False`, `GET …/source/messages` → `404 not found` |
| 3 | **major** | Lỗi phía client bị map thành **5xx** (client không phân biệt được lỗi người dùng vs lỗi server): edit tag cũ → 500; `process` session không tồn tại → 500 (route `debug` cùng id trả 404); `process describe` tên lạ → 500 sau **12.9s**; `debug stack_trace` không có session → 500; `lsp symbols` không có server → 500; `memory mm-list` khi backend local → 500; branch/tree/compact → 500 (agent) | ĐÃ SỬA (đợt 1) | `POST …/edit {"tag":"0000"}` → `500 hash #0000 is not from this session…`; `POST /api/sessions/does-not-exist/process` → `500 session not found`; `{op:"describe",name:"nope"}` → `500 Unknown daemon nope` (12.9s) |
| 4 | major | `/api/plugins` **luôn rỗng** với plugin cài qua marketplace: adapter đọc `~/.omp/plugins/package.json` (không tồn tại) và nuốt lỗi (`.catch(() => [])`) | ĐÃ SỬA (đợt 1) | `GET /api/plugins` → `{"plugins":[]}` trong khi `~/.omp/plugins/installed_plugins.json` có `superpowers@superpowers-marketplace` 6.3.0 + `caveman@caveman` 2.7.0 |
| 5 | major | Process/broker: `ps` hợp lệ **12.8s**; scope chưa có broker sống → `500 connect ENOENT …/broker.sock` sau **35.4s/23.3s** (child broker chết êm, SDK `stderr:"ignore"`); daemon đã `stop` vẫn nằm trong `ps` | MỞ — độ trễ còn lại thuộc broker/SDK (đã đo lại + chốt hợp đồng lỗi) | đo lại 2026-09-22: `ps` **cold 9.95s / warm 1.27s**, `describe <lạ>` 400 trong 1.21s; hợp đồng lỗi tách thành `unknownProcessTarget`/`mapProcessError` + test `packages/omp-adapter/src/hub-process.test.ts` (4 pass) · commit `b39e3ea` |
| 6 | major | `POST /thinking` **không validate** level (nhận mọi chuỗi) và **không có GET** để đọc lại → UI có thể hiển thị mức không tồn tại | ĐÃ SỬA — validate level (`banana` → 400 kèm vocab) **và** `GET …/thinking` đọc lại được | verify 2026-09-22 trên server tươi (session `01a0c802…`): `POST …/thinking {"level":"banana"}` → 400; `GET …/thinking` → **200 `{"thinking":"high"}`**; session lạ → 404 · commit `f8cd093` | | minimal | …)`; `GET /thinking` → `404` |
| 7 | minor | `GET /api/sessions/<lạ>/jobs` → **200 `{"jobs":[]}`** (nên 404, khác với `debug`/`process` cùng id) | ĐÃ SỬA — `GET …/does-not-exist/jobs` → 404 | `GET /api/sessions/does-not-exist/jobs` → `200 {"jobs":[]}` · **đối soát:** `GET …/does-not-exist/jobs` → `404 session not found` |
| 8 | minor | `lsp diagnostics` trả **200 `[]`** khi không có language server (không có tín hiệu "no server"), trong khi `symbols` trả 500 → không nhất quán | ĐÃ SỬA (đợt 1) | `POST …/lsp {"action":"diagnostics"}` → `200 {"result":[]}` (12.9s) vs `{"action":"symbols"}` → `500 No language server found` |
| 9 | minor | `POST /move` **tự tạo thư mục đích** (side effect không hỏi; `/workspace/dirs` thì validate) | ĐÃ SỬA — validate đích, không tạo thư mục | verify 2026-09-22 trên server tươi: `POST …/move {"cwd":"/tmp/grove-parity-moved"}` → **400 `directory does not exist`**, `dir created: no`; thư mục tồn tại → 200 · commit `f90bf44`, test `apps/server/src/routes/ops.test.ts` |
| 10 | minor | Thông điệp lỗi lặp đôi: `session not found: session not found: <id>` | ĐÃ SỬA (đợt 1) | `GET /api/sessions/does-not-exist/messages` → `404 {"error":"session not found: session not found: does-not-exist"}` |
| 11 | minor | `PreludeActionSchema` cho `browser` nhận `capabilities` nhưng SDK browser chỉ có `open/close/run/call` → client hợp lệ theo protocol vẫn 400 (UI chỉ dùng `capabilities` cho computer) | ĐÃ SỬA — `prelude.ts:15-19` chọn schema theo endpoint: browser `capabilities` → 400, computer nhận (400 vì computer.enabled, không phải schema) | `POST …/browser {"action":"capabilities"}` → `400 action must be operation (was "capabilities")` · **đối soát:** browser `capabilities` → `400 invalid_enum_value`; computer `capabilities` → `400 computer is disabled` (schema nhận, cờ tắt) |
| 12 | minor | Tạo session **flaky**: 1 lần `500 {"error":"Agent \"Main\" was replaced during session initialization."}`, retry cùng body thì OK | **ĐÓNG** — 6 lần chạy 8 create song song: 0 lỗi; bỏ `runExclusive` thì 7/8 fail cùng message (chứng minh nhân quả) | test `packages/omp-adapter/src/session-create-race.test.ts` · commit `f3d9175` |
| 13 | minor | Providers pane chờ **model catalog 506 kB** (`/api/models` 0.4–6s) nên skeleton chiếm cả pane ~5s | MỘT NỬA — UI không còn chặn (`ProvidersPane.tsx:56-64`); `GET /api/models` = 508 424 B / 3.50s | `curl /api/models` → `200 506572 bytes` (cold 5.9s, warm 0.42s) |
| 14 | dev-only | `TypeError … reading 'dimensions'` từ `@xterm/xterm` (`syncScrollArea`) khi mở pane Terminal — chỉ ở Vite dev (StrictMode double-effect), **bản production sạch** | ĐÃ SỬA — fit dời sang rAF có huỷ (`TerminalPane.tsx:64`) | dev: pageerror khi mở Terminal; prod (`GROVE_WEB_DIST` + dist): `errs: []`, `.xterm` mount OK |
| 15 | note | Latency bimodal: `/api/health` 0.5 ms khi rảnh, 2–11s khi 4 audit chạy song song; tool-plane mỗi call 7–12s; `POST /api/sessions` ~75s (agent). Chưa kết luận là defect — cần đo lại trên server tươi, một client | GHI CHÚ — không code | health idle `0.0005s` ×2 vs contended `5.27s / 11.6s / 10.5s` |
| 16 | minor | Đường **export HTML để lại file trong cwd của server**: trong audit xuất hiện `apps/server/omp-session-2026-09-20T10-58-52-037Z_<id>.html` (457.9 KB, untracked) — route `share.ts` chỉ trả `{html}` nên file là side effect của SDK `exportHtml()`; file này còn **làm `bun run check` đỏ** (Biome lint file HTML trong repo). Đã xoá; nên thêm vào `.gitignore` hoặc ép export ra temp dir | ĐÃ SỬA — `exportHtml` ghi `mkdtemp` rồi `rm -rf`; không còn `.html` trong `apps/server` | `git status --porcelain` → `?? apps/server/omp-session-…html`; `bun run lint` → `noImportantStyles` trong chính file đó · **đối soát:** không còn `*.html` trong `apps/server`; `exportHtml` dùng `mkdtemp`+`rm -rf` |
| 17 | minor | `POST …/export` trên session **chưa có journal** → `404 {"error":"not found"}` (không phân biệt được với session không tồn tại), nên export session rỗng là không thể | ĐÃ SỬA — session rỗng → 400 `session has no journal yet, nothing to export` | `POST …/export` (session mới tạo) → `404 not found` (2 lần) · **đối soát:** session chưa journal → `400 session has no journal yet, nothing to export` |
| 18 | minor | `GET /api/sessions/:id/export` trên session dài trả **42 MB** trong một response (UI tải trọn vào bộ nhớ) | MỞ (ngoài phạm vi đợt hardening 2) | `curl -s -o /dev/null -w '%{http_code} %{size_download}' …/export` → `200 42909434` trong 0.35s |

**Đã sửa cùng ngày (2026-09-21, đợt fix #1–#4):** #1 (session mới giờ nằm trong `GET /api/sessions`), #2 (fork session chưa có journal **giữ** nguồn), #3 (mọi lỗi client ở bảng trên giờ trả 4xx; route `/process` dùng `errorToStatus` thay vì regex message), #4 (`/api/plugins` liệt kê plugin marketplace: `superpowers 6.3.0`, `caveman 2.7.0`), #8 (`lsp diagnostics` báo lỗi rõ khi không có server), #10 (hết lặp `session not found: session not found:`). Thêm: `read`/`edit`/`list` trên file/thư mục không tồn tại trước đây 500 → giờ **404**.

**Đợt fix #5–#7:** #5 giảm nhẹ (xem dưới) · #6 **đã sửa**: `/thinking` validate theo vocab của SDK (`off|minimal|low|medium|high|xhigh|max|auto`, nhận viết tắt), level không được model hỗ trợ → **400** kèm danh sách hợp lệ, đọc lại qua `GET /model.thinking` giờ khớp (`off`→`off`, `auto`→`auto`) · #7 **đã sửa**: `GET …/jobs` và `POST …/jobs/:id/cancel` trên session lạ → **404**. #5: broker sống trả lời **4ms/2ms** (đo), còn cold-spawn ~12s; call được bound **20s** và trả **503** kèm hint thay vì treo 23–35s+ rồi 500 (`withDeadline` + `RuntimeUnavailableError`→503). Các mục #12–#17 xử lý ở đợt 3.

**Đợt fix #3 (#11–#17):** #11 **đã sửa** — schema tách theo endpoint (`BrowserActionSchema` không có `capabilities`): `POST …/browser {"action":"capabilities"}` → 400 zod liệt kê action hợp lệ (trước: 400 sâu trong SDK "must be operation"), `computer` vẫn có `capabilities` · #12 **đã sửa** — nghiêm trọng hơn báo cáo: **5–7/8 create đồng thời fail**, gốc là mọi session top-level đăng ký cùng entry `Main` trong registry dùng chung; serialize `createAgentSession` → **24/24 ok** (3 vòng × 8) · #13 **đã sửa** — Providers pane render bảng provider ngay (**722ms**) thay vì chờ cả model catalog (trước ~5s skeleton toàn pane) · #14 **đã sửa** — fit xterm hoãn sang frame có thể cancel → mở Terminal ở dev **0 pageerror** (trước: `TypeError … dimensions`) · #16 **đã sửa** — export ghi vào temp dir rồi xoá; không còn file `omp-session-*.html` trong cwd server (+ `.gitignore` dự phòng); verify: export session có transcript → **200, 562.726 bytes**, không file lạ · #17 **đính chính + sửa**: bằng chứng cũ dùng sai phương thức (export là **GET**, tôi đã POST) nên 404 là do route; hành vi thật của session **chưa có journal** trước đây là `not found` mơ hồ → nay **400** `session has no journal yet, nothing to export`.

**Phát hiện thêm khi sửa (đã fix):** #18 prelude gate chạy **sau** khi build tool session (prelude probe OS → screen-recording) nên `computer capabilities` khi bị tắt mất **25–33s** mới trả lời → nay gate bằng settings sống trước → **6ms** · #19 `browser close --all` no-op mất **~24s** (chi phí cold prelude/browser daemon của SDK — ghi nhận, chưa xử lý).

**PASS đáng ghi nhận (bằng chứng dương):** jail chặn traversal 403 ở read/write/list/bash-cwd; masking credential đúng (9 key, không rò giá trị, 486 setting); cells py/js + reset; glob/grep + 400 khi thiếu pattern; bash sync/env/async + job list/cancel; edit tag hợp lệ + conflicts + artifacts; process start/ready(log+port)/logs/stop/cleanup không leak; debug/lsp validation + 403 ngoài jail; UI: stream thật (TTFT 427ms), tool card bash/write/read đủ output + thời gian, abort (Esc giữ draft, status `aborted`, API abort huỷ bash → `[Command cancelled]`), plan mode toggle, 21 pane render sau khi load.

**Chưa phủ:** luồng plan propose→approve (nỗ lực đầu bị nhiễu do draft cũ, chưa chạy lại sạch), hub spawn/steer/inbox (tốn model turn), collab live, browser/computer thật, debug launch/attach, security scan thật, bash `pty:true`, `conflicts/resolve`, import session ngoài.

---

## Changelog

- 2026-09-21 · **Fix đợt 3 (audit §10 #11–#17 + 2 phát hiện mới)**: serialize `createAgentSession` (**#12**: 5–7/8 create đồng thời fail → 24/24 ok); schema prelude tách theo endpoint (**#11**); Providers pane render tiến dần (**#13**: bảng provider 722ms thay vì chờ catalog); xterm fit hoãn sang frame cancel được (**#14**: dev 0 pageerror); export ghi temp dir + 400 rõ cho session chưa có journal (**#16/#17**, #17 đính chính bằng chứng cũ dùng sai GET/POST); gate prelude bằng settings sống trước khi build tool session (**#18**: 25–33s → 6ms); `.gitignore` cho `omp-session-*.html`. Ghi nhận chưa xử lý: **#19** `browser close --all` no-op ~24s (cold prelude của SDK), **#15** latency bimodal khi tải song song. `bun run check` 116 pass, `bun run e2e` 8/8 · commit _pending_

- 2026-09-21 · **Fix đợt 2 (audit §10 #5–#7)**: `/thinking` validate theo vocab SDK + 400 khi model không hỗ trợ level (`off|auto` cho `deepseek-v4.1-flash`), `GET /model.thinking` đọc lại đúng (`configuredThinkingLevel`); `jobs`/`jobs/cancel` session lạ → 404; call supervised-process bound **20s** bằng `withDeadline` → **503** kèm hint thay vì 23–35s+ rồi 500 (broker sống: 4ms/2ms đo được). Test: +4 unit (`deadline.test.ts`, 503 mapping) + 1 e2e contract (`caller conditions answer 4xx`) → `bun run check` 116 pass, `bun run e2e` 8/8 · commit _pending_

- 2026-09-21 · **Fix đợt 1 (audit §10)**: session mới hiện ngay trong list + fork session chưa có journal không còn làm mất nguồn (`SdkAdapter.listSessions` merge session sống, `forkSession` chỉ retire nguồn khi journal đã ở đĩa); taxonomy lỗi mới `InvalidRequestError`/`PathNotFoundError` + classifier `client-errors.ts` (edit tag cũ, compact quá nhỏ, branch sai node, memory sai backend, lsp thiếu server, debug thiếu session → **400**; file/thư mục không tồn tại → **404**, trước là 500); `/process` dùng `errorToStatus` (session lạ → 404, daemon lạ → 400); `/api/plugins` merge `installed_plugins.json`; `lsp diagnostics` không server → lỗi rõ; `SessionNotFoundError` hết lặp text. Test: +11 unit (`errors.test.ts`, `client-errors.test.ts`) + 2 e2e regression (create→list, fork giữ nguồn) → `bun run check` 112 pass, `bun run e2e` 7/7 · commit _pending_

- 2026-09-21 · **Audit chức năng 1 lượt** (4 slice HTTP song song, 79 check + UI/turn thật): thêm **§10** (15 defect đã xác nhận kèm lệnh + kết quả), hạ `/plugins list` và **Supervised processes** từ ✅ → 🟡, ghi phần PASS quan trọng (jail, masking, abort, cells, process lifecycle) · commit _pending_

- 2026-09-20 · README gốc + sửa tracker: dòng **Desktop shell** §1 từ ⬜ → ✅ (evidence smoke:sidecar/smoke:bundle/cargo test 4 passed), số test của gate (92/16 → 101/19), allowlist `docs/superpowers/spikes/**` (spec §7), hook troubleshooting cache cargo cũ sau khi đổi tên thư mục repo · commit `f308f1b`

- 2026-09-19 · `/resume @claude|@codex` (import session ngoài) + `/switch <selector>` (dùng resolver SDK) · đóng `/append`, `/pin`, `/exit`, `/quit` (đã phủ / non-goal) · verify như trên · commit `3014c38`

- 2026-09-19 · gate `goal.enabled` cho `/goal set` + `/guided-goal` · verify như trên · commit `913ea51`

- 2026-09-19 · `/wt` (worktree) + **fix**: cwd của out-of-turn tools (và jail) giờ theo session khi move/worktree (trước đó ghi vào checkout cũ) · commit `e1cd103`

- 2026-09-19 · `/plugins list` + `/extensions` (tab Plugins) · verify với plugin probe · commit `1b8ecd1`

- 2026-09-19 · `/btw` (ephemeral side question) · verify: không tăng message count · commit `66052e3`

- 2026-09-19 · `/security` (raw passthrough + tab), `/memory mm …`, memory-file buttons, `/guided-goal` · **fix gốc**: out-of-turn tools giờ đọc settings/registry/auth/model thật của session (trước đó dùng stub isolated → mọi tool bỏ qua config người dùng) · verify như trên · commit `270ea4f`

- 2026-09-19 · `/tools`: `GET /api/sessions/:id/tools` + tab Tools (active/source/filter) · verify như trên · commit _pending_

- 2026-09-19 · Plan deep: role model `plan` (+restore cả 2 đường exit) + `GET /api/sessions/:id/plan` + `/plan-review` · verify như trên · commit `b0155c7`
- 2026-09-20 · Supervised processes: route `POST /api/sessions/:id/process` + section trong Terminal pane (start/ps/logs/follow/restart/stop) · verify như trên · evidence: `bun run check` green

- 2026-09-20 · `/browser` + `/computer`: tab Browser (Web/Desktop) + route prelude passthrough; ariaSnapshot parse thành row click được (`aria-ref=eN`); fix settings staleness: tool session re-seed từ live session trước mỗi prelude call (trước đó `browser.headless=false` không có tác dụng) · verify như trên · evidence: `bun run check` green

- 2026-09-19 · Phát hiện harness rewrite `local` scheme literal trong file ghi ra → đã sửa 4 chỗ + ghi rule vào `.omp/RULES.md`

- 2026-09-19 · grep out-of-turn + search trong Explorer · verify như trên · commit `b0155c7`

- 2026-09-19 · Message actions: copy từng message, branch/edit-and-resend ở user message (kèm `entryId` trên `ChatMessage` + guard khớp branch) · verify như trên · commit `6c5f052`

- 2026-09-19 · Background jobs: session jobs route + live tail + cancel, section trong Terminal pane (kèm badge running, Output expander, Stop) · verify như trên · commit `f085965`

- 2026-09-19 · Composer autocomplete: `/` menu (Enter/Tab nhận, Esc đóng, đóng sau khi commit) + `@file` mention; thêm route `glob` out-of-turn · verify bằng browser: `@features/chat/Co` → 2 gợi ý, click chèn path; `/pl` Enter → `/plan ` không gửi tin · commit `c7b8630`

- 2026-09-19 · Tạo file · tổng hợp từ verify các lượt: sessions/stats, workspace, plan, goal, loop, vibe, memory · commits `de98fb3`, `9a02a7d`, `dcb6f51`, `730edc7`, `6ac6b4c`
| 2026-09-21 | Theme + UI kit oc-2 | `75d1b84..HEAD` (theme token → adoption); `bun run check` xanh (gồm `guard:tokens`), 16 invariant trong `apps/web/src/lib/ui-invariants.test.ts` + 4 trong `styles/theme.test.ts`; probe computed-style cho từng nhóm (button 28px/530, tag 16px/2px, menu 28px/12px, keybind 14px, segmented 28px, hairline 0.5px) |
| 2026-09-22 | Đối soát bảng defect §10 | Probe lại bằng `curl` trên server tươi: #7/#11/#14/#16/#17 **đã sửa**, #6 còn thiếu `GET /thinking`, #5 chỉ còn độ trễ broker (cold 9.95s / warm 1.27s), #9 còn nguyên; thêm #18 (export 42 MB) |
| 2026-09-22 | Hardening round 2 (5 task cuối) | Tách 5 file god (`ChatPage` 1179→382, `sdk.ts` 2091→533, `tools.ts` 1972→269, `rest.ts` 1388→5, `hooks.ts` 1235→5 — mọi file < 700), bỏ `export` ở 11 symbol chết, gộp `formatDuration`/`errorMessage` về `lib/format.ts`, 4 hàng active dùng `panel-plain-active` + guard border chặt hơn (Ruling A: alert giữ 1px), sửa hồi quy modal Settings (shell 2581px trong khung 85vh) · verify: `bun run check` xanh, `bun run e2e` 12/12, `bun run smoke:server` OK · commits `269431e`, `49191b9`, `eadbd56`, `39e4ee4`, `fc7e56e`, `1362363` · hàng #6 và #9 chuyển sang ĐÃ SỬA theo probe trên |
