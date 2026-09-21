# Grove UI parity with OpenCode Desktop — design

> Trạng thái: spec để viết plan `docs/superpowers/plans/2026-09-21-grove-ui-parity.md`.
> Đợt 1 (palette + token) đã xong ở commit `75d1b84`; spec này phủ phần *render* còn lệch.

## Goal

Sau khi token đã là `oc-2`, làm phần nhìn của Grove khớp design system của OpenCode Desktop: type ramp, viền hairline 0.5px, thang radius, elevation, recipe điều khiển (button/input/tag/tab/dialog/row) và chrome shell — đồng thời dồn các recipe đang bị copy-paste vào `@grove/ui`.

## Nguồn sự thật (đã verify, không suy đoán)

| Nguồn | Nội dung |
|---|---|
| `/Applications/OpenCode.app/Contents/Resources/app.asar:out/renderer/assets/main-7M-wWqep.css` (594 KB) | recipe v2: `button-v2`, `icon-button-v2`, `tag`, `keybind-v2`, `menu-v2`, `dialog-v2`, `text-input-v2`, `textarea-v2`, `segmented-control-v2`, `tooltip-v2`, scrollbar |
| `…/assets/index-Cx_fm644.css` | `tabs-v2` (normal/pill/settings), `radio-v2`, override dialog |
| `…/assets/dialog-command-palette-v2-*.css`, `dialog-edit-project-v2-*.css`, `dialog-select-directory-v2-*.css` | row 36px, `field-v2`, directory picker |
| `…/assets/main-UX7jf0vb.js:38164-38168` | `oc2ThemeJson` (palette light/dark + v2Overrides) |
| `…/renderer/oc-theme-preload.js` | theme mặc định `oc-2`, `data-color-scheme`, nền `#080808`/`#fafafa` |
| `packages/ui/src/styles/vars.css` | token HSL triplet của Grove (đã là `oc-2`) |

## Recipe đích (trích nguyên văn từ bundle)

Đơn vị: px · `--v2-*` là token của app; cột "Grove" là token tương ứng đã có trong `vars.css`.

### Button (`button-v2`)

| size | height | padding | radius | type | surface | hover | focus |
|---|---|---|---|---|---|---|---|
| small | 24 | `0 9px` (icon `left 9px`) | 4 | 13/530/−0.04px | `--v2-background-bg-button-neutral` | `overlay-hover` | outline 2px `border-focus`, offset 2.5 |
| normal | 28 | `0 11px` | 6 | 13/530/−0.04px | nt | nt | nt |
| large | 32 | `0 15px` | 6 | 13/530/−0.04px | nt | nt | nt |

Variant: `outline` = `inset 0 0 0 1px --v2-border-border-muted`, nền trong suốt; `contrast` = `--v2-background-bg-contrast` + `--v2-text-text-contrast`; `ghost` = trong suốt; `ghost-muted` = chữ `--v2-text-text-muted`; `danger` = chữ `--v2-state-fg-danger`; `warning` = chữ `--v2-state-fg-warning`; `loading` = nền `layer-02` + hairline `0.5px`; disabled opacity `.5` (contrast `.4`).

**Quyết định của user (giữ):** CTA mặc định của Grove = nền `layer-03` (`--primary`) + hairline `--border-strong`, hover `layer-04` — mạnh hơn `button-neutral` của app nhưng là lựa chọn đã chốt; nút phụ `secondary` = `bg-button-neutral`.

### Icon button (`icon-button-v2`)

| size | kích thước | radius | hover | focus |
|---|---|---|---|---|
| small | 20×20 | 4 | `overlay-hover` (ghost) | outline 2px `border-focus`, offset 2.5 |
| normal | 24×24 | 6 | nt | nt |
| large | 28×28 | 6 | nt | nt |

### Tab (`tabs-v2`)

- `normal`: list 32px, `padding-inline 8px`, gap 6; trigger 13/440/−0.04px; vạch dưới list 1px `--v2-border-border-base`; inactive chữ `--v2-text-text-muted`, hover/selected `--v2-text-text-base`; selected gạch chân `--v2-text-text-faint`.
- `pill`: wrapper 24px, radius 4, `border 0.5px solid transparent`; hover/selected nền `layer-03` + viền `--v2-border-border-muted` + chữ `--v2-text-text-base`.
- `settings` (dọc): list `padding 12px`, gap 4, `border-inline-end 1px`; wrapper 28px, radius 4; section title 12px/500.

### Titlebar session tab (`[data-titlebar-tab]`)

height 28 (`h-7`) · `px-1.5` (6px) · gap 6 · radius 6 · link 13/500 · nền `bg-deep`, hover/pressed `layer-02` + overlay · chữ `--v2-text-text-faint` → active `--v2-text-text-base` · separator `1.5px×12px` radius 9999 màu `layer-03` (dark `layer-02`) · nút close chỉ hiện khi hover (`w-0 opacity-0` → `w-6 opacity-100`).

### Row (session sidebar)

`rounded-md` (6) · icon slot `size-6` · indent `8 + level*16` px · `pr-3` · gap 8 (trong row 4) · hover `--surface-raised-base-hover` · active/expanded `--surface-base-active` · dot trạng thái `bg-surface-warning-strong` / `bg-text-diff-delete-base` / `bg-text-interactive-base` · nút archive chỉ hiện khi hover/focus-within.

### Tag / chip (`tag`)

height 16 (legacy 18/22) · `0 4px` · gap 4 · radius **2** · 11/530/+0.05px · viền **0.5px** `--v2-border-border-base` · nền `layer-02`, chữ `--v2-text-text-muted` · variant `accent`: bỏ viền, nền `--v2-background-bg-accent`, chữ `--v2-text-text-contrast`.

### Keybind / badge

height 14 (keybind) và 16 (badge) · `0 4px` · radius 2 · 11/530/+0.05px (keybind uppercase) · nền `layer-03` (keybind neutral) / `layer-02` (badge) · chữ `--v2-text-text-muted` · badge có viền 0.5px.

### Segmented control

wrapper 28px, radius 6, nền `layer-01`, `box-shadow 0 0 0 0.5px --v2-border-border-base`; item 28px `0 12px` 13/440; pressed: nền `bg-base`, chữ base, `box-shadow 0 0 0 0.5px --v2-border-border-strong`; focus outline 2px offset 1px; disabled opacity `.45`.

### Text input / textarea

height 28 (`[data-appearance="large"]` 32) · radius 6 · 13/440/−0.04px · `outline 1px solid transparent` (focus → `--v2-border-border-focus`) · `box-shadow --v2-elevation-button-neutral` · nền `linear-gradient(180deg, --v2-alpha-light-2, --v2-alpha-light-0), --v2-background-bg-base` · placeholder `--v2-text-text-faint` · hover overlay-hover · focus-within: bỏ shadow, outline focus. Textarea: `min-height 80px`, `padding 8px`, `line-height 1.35`.

### Dialog

container 480×368 (large 640×480; x-large `min(100vw-32,980)`) · radius 6 (command palette 12) · nền `layer-01` + `--v2-elevation-overlay` · header `padding 16px`, title 15/530/−0.13px lh 20, description 13/440 `--v2-text-text-muted`, close `--v2-icon-icon-muted` · footer `padding 16px`, gap 8 · body `padding 0`.

### Menu item / command palette row / tooltip

- menu item: 28px, `0 12px`, gap 8, radius 4, 13/440; highlighted = `overlay-hover`; `[data-checked]` chữ `--v2-text-text-accent` + weight 530; disabled opacity `.5`.
- command palette row: 36px, `0 12px`, gap 8, radius 6; active/focus = `overlay-hover`; group title 13/440.
- tooltip: `padding 5px 6px`, gap 6, radius 4, 11/530/+0.05px, nền `layer-01`, shadow `--v2-elevation-floating`.

### Scrollbar

viewport ẩn scrollbar gốc (`scrollbar-width: none` + `::-webkit-scrollbar{display:none}`); thumb 12px chứa `::after` 4px radius 9999 (tree 16/6), nền `--border-weak-base` → hover/drag `--border-strong-base`, `backdrop-filter blur(4px)`.

## Hiện trạng Grove (đo được, 2026-09-21)

| Hạng mục | Con số |
|---|---|
| Border | 219 utility, **tất cả 1px**, 0 chỗ 0.5px; `border-[hsl(var(--border))]` ×202 |
| Radius | 178 chỗ: `rounded-md` ×158, `rounded-full` ×11, `rounded-sm` ×4, `rounded` ×3; `--radius` không map vào Tailwind |
| Shadow | chỉ 12 chỗ: `shadow-lg` ×8, `shadow-2xl` ×2, arbitrary ×2; 0 `box-shadow` CSS |
| Chữ | `text-xs` 286, `text-[13px]` 80, `text-[11px]` 51, `text-[10px]` 30; weight 82 (`semibold` 57); `tracking-wide` 42; `tabular-nums` 5 |
| Font | không có file font, không `@font-face`, không token `--font-*`; stack `DM Sans, CursorGothic, Inter, …` (2 cái đầu không cài) |
| Lặp recipe | `text-[hsl(var(--muted-foreground))]` ≈274/49 file; `rounded-md border … border` ≈111/38; `… + bg card` 33/19; `text-xs text-destructive` 56/34; box lỗi + Retry 12/10 file; `Retry` 22/17 file; `role="dialog"` 9 + `role="alertdialog"` 2 tự viết tay; scrim 7 chỗ |
| Shell | gutter 8px; header OpsBar ≈40px (`px-3 py-1.5` + button 28); rail tool `w-12` (48); sidebar mặc định 240 (200–480); panel tool 540 (320–900); sash hit 8px/thumb 3px |
| Focus | 26 class ring, **luôn 1px**, không offset; `outline-none` 28 chỗ |
| Scrollbar | 0 rule |

## Phạm vi

Trong: type ramp + font; hairline 0.5px; thang radius; elevation token; kit điều khiển trong `@grove/ui`; primitive Dialog; kit panel/state; số đo shell + tab + scrollbar; dồn recipe lặp; guard script + docs.

Ngoài (không làm ở đây): đổi token/đổi palette lần nữa; port 40+ theme của app; đổi layout lớn (vị trí panel, route); tính năng mới; god-file split (`sdk.ts`, `ChatPanel`…) — việc riêng.

## Deviation có chủ ý

1. **CTA** giữ `layer-03` + `--border-strong` (user chốt), không dùng `button-neutral` của app.
2. **Tag radius 2px** theo app thay vì 5–6px hiện tại của Grove — đổi hình dạng chip, cần user thấy trước khi merge.
3. **Ring focus** giữ cam kết cũ: 2px outline `--ring` (blue-600/blue-400) offset 2.5px; app dùng `--v2-border-border-focus` (blue-500) — 2.4:1 trên trắng, không đủ cho outline 1px.
4. **Font**: self-host Inter variable (OFL) — nếu không muốn thêm ~350 KB vào bundle thì giữ stack hệ thống và **bỏ** phần weight 440/530 (dùng 400/500), phần còn lại của ramp giữ nguyên.

## Acceptance (đo được)

1. `bun run check` xanh sau mỗi task; `bun run guard:tokens` xanh.
2. Trong app đang chạy, computed style khớp: button md `height 28px`/`border-radius 6px`/`font-size 13px`/`font-weight 530`/`letter-spacing -0.04px`; tag `height 16px`/`radius 2px`/`border-width 0.5px`; input `height 28px`/`radius 6px`; dialog container `radius 6px` + shadow chứa `0 16px 32px`; tab list `height 32px`; session row `border-radius 6px`; scrollbar thumb `width 12px` + `::after` 4px.
3. Không còn trong `apps/web/src`: `hsl(var(--` (trừ `@theme`/globals), `shadow-lg`, `shadow-2xl`, `text-[10px]`, `text-[13px]`, `tracking-wide`, `rounded-sm`, `role="dialog"` viết tay, box lỗi lặp.
4. Light + dark đều đúng: hairline thấy được, elevation khác nhau theo mode, không có chữ nào < 4.5:1 (trừ 3 ngoại lệ đã ghi trong `vars.css`).

## Rủi ro

- `@theme inline` sai mode → utility chỉ emit giá trị đã resolve và theme sáng/tối ngừng đổi. Verify bằng cách build CSS và grep `var(--background)` trong output.
- Hairline 0.5px trên màn non-retina có thể mờ hơn 1px cũ; kiểm bằng ảnh chụp ở cả 2 màn hình nếu có.
- Font Inter phải phủ tiếng Việt — dùng bản variable đầy đủ, không subset latin.
- Đổi `text-xs` (12px) hàng loạt ảnh hưởng 286 chỗ: chia task theo feature, sau mỗi nhóm chụp lại màn hình tương ứng.
