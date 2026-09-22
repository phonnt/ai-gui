# Grove UI adoption (parity part 2) — design

> Spec cho plan `docs/superpowers/plans/2026-09-21-grove-ui-parity-2.md`.
> Phần 1 (`75d1b84..d739364`) đã dựng token + kit + recipe nền; spec này phủ việc **áp** chúng vào app và làm nốt recipe còn thiếu.

## Goal

Đưa `apps/web` từ "kit có sẵn nhưng chưa dùng" về trạng thái: mọi cỡ chữ/weight đi qua ramp, mọi chrome lặp đi qua component kit, và 5 recipe còn thiếu của OpenCode Desktop (`menu-v2`, `field-v2`, `segmented-control-v2`, `keybind-v2`, `tooltip-v2`) có mặt.

## Nguồn sự thật

| Nguồn | Dùng cho |
|---|---|
| `apps/web/src/styles/globals.css` (`@theme inline`) | ramp `text-meta/small/body/title/hero`, `font-regular` 440 / `font-strong` 530, radius, shadow |
| `packages/ui/src/components/*` | Panel, PaneHeader, SectionLabel, EmptyState, StatusDot, IconButton, Textarea, Dialog(+Header/Body/Footer), Popover |
| `docs/superpowers/specs/2026-09-21-grove-ui-parity-design.md` §Recipe đích | số đo của app cho 5 recipe còn thiếu |
| `/Applications/OpenCode.app/.../main-7M-wqep.css` | đối chiếu khi cần thêm chi tiết recipe |

## Hiện trạng (đo 2026-09-21, read-only scout)

| Hạng mục | Số |
|---|---|
| Cỡ chữ ad-hoc | **354 chỗ / 100 file**: `text-xs` 194 (42 file) · `text-[13px]` 77 (34) · `text-[11px]` 51 (27) · `text-[10px]` 29 (15) · `text-[12px]` 1 · `text-[0.9em]` 1 · `text-sm` 1; trong đó **132 chỗ nằm cạnh `font-mono`** |
| Weight ad-hoc | `font-semibold` 27 · `font-medium` 20 · `font-bold` (landing) 1; `font-strong` (ramp) đã dùng ở 30 chỗ |
| Tracking ad-hoc | 16 chỗ (`tracking-wide` 15, `tracking-widest` 1) |
| Nút chỉ-icon nên là `IconButton` | **39** (tất cả đã có `aria-label`) |
| `<textarea>` tự viết | **11** (2 hằng className trùng nhau: `HubPanel.tsx:32-33`, `SpawnWizard.tsx:11-12`) |
| Khối rỗng nên là `EmptyState` | **34** |
| Dot trạng thái nên là `StatusDot` | **6** |
| Nhãn nhóm uppercase nên là `SectionLabel` | **33** (4 kiểu padding khác nhau) |
| Hàng header pane nên là `PaneHeader` | **46** (2 recipe: `h-10` shell vs section `text-meta font-strong uppercase`) |
| Khối card nên là `Panel` | **69** (29 `rounded-md bg-card hairline` + 40 `rounded-md hairline`) + ~40 biến thể input |
| Menu row (`menu-v2`) | `OpsBar.tsx:197-198` (dùng 10×), `CommandPalette.tsx:161-163`, `ModelPicker.tsx:100/110/126/189-191` |
| Field row (`field-v2`) | `SettingsModal.tsx:35` (Row cục bộ, 1 call site) |
| Segmented (`segmented-control-v2`) | `ModesPanel.tsx:85-90` (4 nút) + `:143-166` (QueueRow 2 nút) · `ProvidersPane.tsx:165-181` · `SpawnWizard.tsx:118-155` |
| Keybind chip | `router.tsx:128-129`, `Composer.tsx:340-341` |
| Tooltip | chưa có primitive; `title=` dày nhất ở `SessionFooter.tsx` (10) |
| Chip agent | `HubPanel.tsx:104/168/373/375` (kind, role, status) |
| Màu danh tính | `ProviderIcon.tsx:9-33` + `providerIcons.ts:94-97` (fallback hsl tự chế) |
| Border 1px còn sót | `Message.tsx:12` (`role=tool`), `HubPanel.tsx:123` (`border-l`) |
| Font mono | `--font-mono` = stack hệ thống; xterm không set `fontFamily` (`TerminalPane.tsx:49-56`) |

## Quy tắc map (bắt buộc, không tự chế)

| Đang dùng | Thành | Ghi chú |
|---|---|---|
| `text-xs` (12px) | `text-small` | nếu là nhãn uppercase → `text-meta` |
| `text-[13px]` | `text-body` | |
| `text-[11px]` | `text-meta` | |
| `text-[10px]` | `text-meta` | app không có 10px; nhích lên 11px là chủ ý |
| `text-[12px]` | `text-small` | |
| `text-sm` | `text-body` | |
| `text-2xl`/`text-4xl` + `font-bold` + `tracking-tight` (landing) | `text-hero` + `font-strong` | landing là ngoại lệ duy nhất được dùng `text-hero` |
| `font-semibold` 600 · `font-medium` 500 · `font-bold` 700 | `font-strong` 530 | ramp chỉ có 440/530 |
| `font-regular` | dùng khi cần ghim 440 giữa chỗ đậm | |
| `tracking-wide` / `tracking-widest` / `tracking-tight` | **bỏ** | ramp đã mang tracking (+0.05px cho meta, −0.04/−0.13 cho body/title) |
| `text-[0.9em]` (inline `<code>`) | **giữ** | kích thước tương đối là đúng cho code trong prose |
| Cỡ chữ trong ngữ cảnh `font-mono` | vẫn map theo bảng trên | mono chỉ đổi family, không đổi cỡ |

## Phạm vi

Trong: ramp toàn app; `Input` 28px + `text-body`; áp `IconButton`/`Textarea`/`Panel`/`PaneHeader`/`SectionLabel`/`StatusDot`/`EmptyState`; 5 recipe còn thiếu + chip agent + màu danh tính; 2 border 1px sót; mono self-host; docs.

Ngoài: đổi palette/token (đã chốt ở phần 1); layout lớn (vị trí panel, route); port 40+ theme của app; god-file split; thêm tính năng; tooltip dạng rich (chỉ dùng `title` + primitive nhẹ).

## Acceptance (đo được)

1. `bun run check` xanh (gồm `guard:tokens`); test invariant mới xanh.
2. `grep -c 'text-xs\|text-\[1[0-9]px\]\|font-semibold\|tracking-wide\|tracking-widest'` trong `apps/web/src/{features,app,lib}` = **0** (ngoại lệ ghi rõ: `text-[0.9em]`).
3. `grep -c 'rounded-md bg-card hairline\|rounded-md hairline'` trong features giảm còn ≤ 10 (những chỗ là layout đặc thù, liệt kê trong commit).
4. Không còn `<textarea` tự viết recipe; không còn `<button>` chỉ-icon ngoài kit.
5. Trong app đang chạy: input cao **28px**; menu row **28px**/padding `0 12px`/radius 4; segmented **28px**/radius 6 + item pressed hairline strong; keybind chip **14px** cao, 11px/530 uppercase; empty state + header pane dùng đúng component (kiểm bằng class của element).
6. Light + dark đều đúng; không pane nào mất viền/đổi cỡ chữ ngoài dự kiến (ảnh chụp từng nhóm pane).

## Rủi ro

- **Đổi 354 cỡ chữ** là diff lớn, dễ lệch ở bảng/mono. Giảm thiểu: chia theo feature, sau mỗi nhóm chụp lại pane đó; map `text-[10px]` → 11px làm chữ to hơn 1px ở 15 file.
- **`PaneHeader` có padding cố định** (`h-10 px-3`) trong khi 46 hàng hiện có 2 recipe (shell 40px vs section ~28px) → phải thêm prop `variant="section"` (thấp hơn, không `h-10`) chứ không ép tất cả về 40px.
- **`Panel` có `bg-card` cố định**, nhưng 40 chỗ hiện dùng `rounded-md hairline` trên nền khác → cần prop `tone="card|plain"`.
- **`EmptyState`/`SectionLabel` padding cố định** khác 4 kiểu hiện có → chấp nhận chuẩn hoá (đúng tinh thần kit) và ghi rõ trong commit; nếu pane nào trông lệch thì chỉnh prop.
- **`title=` → tooltip primitive** đụng a11y: primitive phải giữ `title` làm fallback và thêm `aria-describedby`.
