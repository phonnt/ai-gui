# Grove hardening round 2 — design

> Spec cho plan `docs/superpowers/plans/2026-09-22-hardening-round-2.md`.
> Phủ 3 nhóm user yêu cầu: (1) defect audit còn mở, (2) nợ cấu trúc, (4) việc nhỏ + harness verify.

## Goal

Đóng phần còn lại sau 2 lượt theme/kit: sửa **đúng** các defect audit còn thật sự mở (bảng trong `docs/tui-parity-status.md` đã cũ), tách các god file theo biên rõ ràng, dọn export chết/hàm trùng, và thay quy trình "probe tay + screenshot" bằng **Playwright trong CI**.

## Nguồn sự thật (đo tại HEAD `1398c90`, 2026-09-22)

### Nhóm 1 — defect (probe trực tiếp, server tươi)

| # | Bảng đang ghi | Thực tế tại HEAD | Kết luận |
|---|---|---|---|
| #5 | `ps` 12.8s, scope chết → 500 sau 35s | `POST /process {op:ps}` → 200 sau **9.95s**; `describe nope` → **400 sau 9.9s**; `health` 0.0007s | **CÒN MỞ** (độ trễ + thời gian chết khi tên sai) |
| #6 | `/thinking` không validate, không có GET | `banana` → **400** kèm vocab; `GET /thinking` → **404** | **MỘT NỬA**: validate xong, thiếu read-back |
| #7 | `jobs` session lạ → 200 `{"jobs":[]}` | `GET …/does-not-exist/jobs` → **404 session not found** | ĐÃ SỬA → bảng cũ |
| #9 | `/move` tự tạo thư mục đích | `POST /move {"cwd":"/tmp/grove-defect9"}` → 200 và **thư mục được tạo** | **CÒN MỞ** |
| #11 | `PreludeActionSchema` nhận `capabilities` cho browser | `POST …/browser {"action":"capabilities"}` → **400 invalid_enum_value** | **CÒN MỞ** (schema quảng cáo thứ handler từ chối) |
| #12 | Tạo session flaky | 1 lần đo: **200 trong 0.51s**; adapter có `runExclusive` (`sdk.ts:140-153`); e2e đã có test tạo song song | Không tái hiện — theo dõi, không code |
| #13 | Providers chờ catalog 506 kB | `GET /api/models` = **508 424 bytes trong 3.50s**; `ProvidersPane.tsx:56-64` render tiến dần | Payload/độ trễ còn; UI không còn chặn → hạ ưu tiên |
| #14 | xterm lỗi chỉ ở dev | fit đã dời sang rAF có huỷ (`TerminalPane.tsx:64`) | ĐÃ SỬA → bảng cũ |
| #15 | Latency bimodal | chỉ là ghi chú | Không code |
| #16 | export để lại file trong cwd | `exportHtml` ghi vào `mkdtemp` rồi `rm -rf` (`sdk.ts:1543-1568`); không còn `.html` trong `apps/server` | ĐÃ SỬA → bảng cũ |
| #17 | export session rỗng → 404 không phân biệt | session chưa có journal → **400 `session has no journal yet, nothing to export`** | ĐÃ SỬA → bảng cũ |

**Phát hiện mới (khi probe):** `GET /api/sessions/<id>/export` trả **42 MB** HTML cho session dài (0.43s) — UI tải trọn trong bộ nhớ; cần quyết định (stream/zip/giới hạn).

### Nhóm 2 — nợ cấu trúc

| File | Dòng | Cấu trúc hiện tại |
|---|---|---|
| `packages/omp-adapter/src/sdk.ts` | **2085** | 1 class `SdkAdapter` (359-2085) ~90 method + helper file-local (1-358) |
| `packages/omp-adapter/src/tools.ts` | **1972** | 23 export + ~45 impl (`readFileImpl`, `runBashImpl`, `lsp*Impl`, `debug*Impl`, …) |
| `apps/web/src/lib/api-client/rest.ts` | **1388** | ~140 import type DTO + alias cục bộ (795-798, 910-919, 467-483) |
| `apps/web/src/lib/api-client/hooks.ts` | **1235** | import type (2-32) + re-export (671-684) |
| `apps/web/src/features/chat/ChatPage.tsx` | **1179** | 1 component; state/hook 159-745; mảng palette 752-811; JSX 813-1179 |

**Export chết** (0 chỗ dùng ngoài file định nghĩa): `@grove/core` **4**, `@grove/ui` **7** (gồm `DialogHeader`/`DialogBody`/`DialogFooter` — `Dialog` không compose chúng), `@grove/agent-runtime` **11**.
**Hàm trùng**: `formatDuration` ở `Message.tsx:26` và `BackgroundJobsSection.tsx:12` (+4 formatter thời lượng khác cùng chức năng); `errorMessage` ở web LSP và `apps/server/src/routes/errors.ts`.
**Sai trong tài liệu cũ**: `docs/superpowers/plans/2026-09-21-hardening-and-gates.md:367` liệt kê `Card`, `reset*ForTest`, "18 barrel feature" — tại HEAD **không tồn tại** (0 barrel, 0 `Card`). `ThinkingElapsed` **không** bị trùng (1 khai báo, 3 call site).

### Nhóm 4 — việc nhỏ + harness

- **Border 1px trạng thái active** (4 chỗ): `KnowledgePane.tsx:289`, `McpPane.tsx:108`, `SettingsPane.tsx:271`, `ThemePicker.tsx:79` — dạng `rounded-md border` + `active ? 'border-ring' : 'border-border'` (chia 2 dòng nên guard hiện tại không bắt).
- **Divider 1px**: `SettingsModal.tsx:181` (`border-r border-border`).
- **Border 1px ngữ nghĩa** (giữ 1px, có chủ ý): `ChatPage.tsx:1007` (`border-warning`, hộp duyệt tool), `PlanReview.tsx:24` (`border-link`).
- **Guard hiện tại chỉ bắt literal** `border border-border` trên **một dòng** (`ui-invariants.test.ts:129-136`, `theme.test.ts:89-118`).
- **Harness**: Playwright **đã có sẵn** — `playwright.config.ts`, `tests/e2e/app.spec.ts` (9 test), script `bun run e2e`, job `e2e` trong CI, chromium đã cache. Không có stack DOM (jsdom/happy-dom/testing-library) trong repo. Không tài liệu nào nói cách verify UI.

## Quyết định phạm vi

**Làm:** #5, #9, #11, read-back `/thinking`; reconcile bảng defect; tách `ChatPage.tsx`, `sdk.ts`, `tools.ts`, `rest.ts`, `hooks.ts`; xoá export chết; gộp hàm trùng; 4 border active + divider; guard border mạnh hơn; e2e spec cho số đo kit; mục verify trong runbook.

**KHÔNG làm:** #12 (chỉ theo dõi), #13 payload catalog (hạ ưu tiên, có thể làm sau), #15 (ghi chú), đổi palette/token, thêm tính năng, viết lại giao thức.

## Acceptance (đo được)

1. `bun run check` xanh; `bun run e2e` xanh (kể cả spec mới).
2. #9: `POST /move` với thư mục không tồn tại → **400** kèm thông báo; thư mục **không** được tạo; với thư mục tồn tại → 200.
3. #11: `POST …/browser {"action":"capabilities"}` → **400** với thông báo khớp schema mới; `PreludeActionSchema` không còn liệt kê `capabilities` sai endpoint (test protocol).
4. #5: `describe` tên lạ → **< 500 ms** (validate trong danh sách trước) và `ps` warm → **< 2 s**.
5. `GET /thinking` → 200 với level hiện tại; `GET` không tồn tại session → 404.
6. Không file nào > **700 dòng** trong 5 file god nêu trên; mọi export còn lại có ≥1 chỗ dùng (script kiểm + test invariant).
7. `grep -rn "border-ring' : 'border-border'" apps/web/src` → 0; `grep -rn 'border-r border-border'` → 0.
8. e2e có spec khẳng định số đo: button 28px, tag 16px/radius 2, menu 28px/12px, keybind 14px, hairline 0.5px; `docs/runbook.md` có mục "Verify UI".

## Rủi ro

- **Tách `sdk.ts`/`tools.ts`** đụng 2000+ dòng, dễ vỡ hành vi (SDK call, mapping lỗi). Giảm thiểu: tách **theo nhóm hàm, giữ nguyên thân**, không đổi chữ ký; mỗi bước `bun run check` + `bun test packages/omp-adapter` + `bun run smoke:server`.
- **Tách `ChatPage.tsx`** dễ làm hỏng luồng state phức tạp (stream/abort/fork). Giảm thiểu: chỉ tách JSX thành component nhận props tường minh và tách hook `useChatSession` giữ nguyên thứ tự hook; verify bằng e2e + mở màn chat.
- **Playwright spec mới** có thể flaky nếu đo sau animation; giảm thiểu: chỉ đo computed style (không phụ thuộc thời gian), `waitForLoadState('networkidle')` tránh.
- **#5 độ trễ** có thể đến từ broker ngoài tầm kiểm soát (SDK); nếu đo lại thấy không cải thiện được thì ghi kết quả và hạ thành "validate nhanh + deadline rõ ràng" (đã có), không hứa con số.
