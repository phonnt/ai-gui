# Grove — bộ nhận diện (logo) — Design Spec

- Status: proposed (chờ user review)
- Ngày: 2026-09-24
- Phạm vi: mark, wordmark/lockup, favicon + PWA, app icon (Tauri), OG/avatar, bản 1 màu, chỗ đặt mark trong app, và pipeline sinh asset
- Ngoài phạm vi: redesign UI, đổi token màu oc-2 của app, theme/typography, logo động
- Liên quan: `docs/design-system.md` (tokens), `apps/desktop/app-icon.svg` (nguồn icon Tauri hiện tại), `apps/web/index.html`

## 1. Mục tiêu & nguyên tắc

Mốc tham chiếu do user chốt: **OpenAI / Anthropic**. Hai mark đó có 4 đặc điểm chung, và đó là luật của spec này:

1. **Trừu tượng** — không minh hoạ đồ vật (không cây, không terminal, không chữ cái).
2. **Một màu duy nhất** — không gradient nhảy hue, không nhiều hue trên một mark.
3. **Mark không có ô nền** — ô nền là chuyện của *app icon*, không phải của mark.
4. **Đối xứng quay** — hình sinh ra từ một phần tử lặp lại theo góc, không phải hình vẽ tay.

Hai quyết định ràng buộc xuyên suốt:

- **(a) Mark trong UI phẳng.** Hiệu ứng (bóng) chỉ áp cho asset, không áp cho mark trong app.
- **Bóng chỉ sống ở ≥32px.** Ở 16px bóng thành vệt/nhiễu (đã đo), nên bản 16px luôn phẳng.

### Đã gạt (ghi lại để không relitigate)

| Hướng đã thử | Lý do gạt |
|---|---|
| Canopy / Branch nét mảnh / Monogram G / Sapling tile | Không đúng chất dev tool |
| Prompt `>_`, bracket, hex, terminal window, chữ G vuông | Quá literal, hoặc phổ biến trong giới CLI tool |
| Gradient tím→cyan, tím bão hoà `#522EF5` | Cảm giác "AI startup 2020s" — user gọi là màu cùi |
| Ô màu bão hoà phủ kín (tile + knockout) làm mark | Mảng màu lớn gây cảm giác rẻ |
| Long shadow, emboss, glow, bevel | Rẻ / nhiễu ở 16px / không hợp ngôn ngữ flat của app |

## 2. Quyết định đã chốt

| Hạng mục | Chốt | Lý do / bằng chứng |
|---|---|---|
| Hình mark | **A6 · Branch pinwheel** — 3 cành cong + điểm, đối xứng 120° | Trừu tượng, đối xứng quay, không minh hoạ; giữ được hàm ý "mọc/nhánh" mà không vẽ cây |
| Độ dày nét | **W3** — stroke `4.2`, dot `r=3.8`, bán kính cành `R=9.7` (hệ 32) | Nét đậm nhất mà hình còn đọc ra "cành"; W4 (5.0) dính thành khối 3 thuỳ |
| Màu | **Ember** — `#F54E00` trên nền sáng, `#FF7A3D` trên nền tối | Một hue duy nhất; cặp mực/ember đã có trong style reference của repo |
| Nhấn nét | **S2 · ember drop shadow**, chỉ cho asset ≥32px | Bản duy nhất đọc được trên cả nền sáng lẫn nền tối (bóng đen vô hình ở dark mode) |
| Mark trong UI | **Phẳng, không ô, không bóng** (quyết định a) | Không lệch với phần chrome phẳng của app |
| App icon | **IC1** — ô graphite `#1C1C1C` + mark ember + bóng S2 | Ô nền cho app icon là bắt buộc (mark trần trong dock không có cạnh); graphite làm ember nổi nhất |

## 3. Đặc tả mark (hình học chính xác)

- `viewBox="0 0 32 32"`, mark vẽ trên nền trong suốt.
- Stroke: `width=4.2`, `linecap=round`, không fill trên path. Điểm đầu cành: `circle r=3.8`, filled.
- **3 nhánh**, góc gốc `θ = −90° + k·120°` với `k ∈ {0,1,2}`.
- Tham số: `r0 = 1.5 + 0.3·w = 2.76` (bán kính điểm bắt đầu), `R = 9.7` (bán kính đầu cành).
- Mỗi nhánh là một cubic bezier trong hệ toạ độ cực quanh tâm `(16,16)`:

  | Điểm | Góc | Bán kính |
  |---|---|---|
  | bắt đầu | `θ − 14°` | `r0` |
  | control 1 | `θ − 26°` | `r0 + 0.42·(R − r0)` |
  | control 2 | `θ + 10°` | `r0 + 0.78·(R − r0)` |
  | kết thúc | `θ + 16°` | `R` |

  Điểm tròn của nhánh đặt tại `(θ + 16°, R)`, `r = 3.8`.

- Path data tham chiếu (làm tròn 2 chữ số thập phân). **`packages/ui/src/brand/mark.ts` là nguồn sự thật** — asset sinh ra từ nó, và test §9.3 so bản đã commit với bản phát ra để bắt drift:

  ```text
  M15.33 13.32 C13.51 10.9 17.42 7.95 18.67 6.68      (nhánh 1, dot 18.67,6.68)
  M18.65 16.76 C21.66 16.4 22.26 21.25 22.74 22.98    (nhánh 2, dot 22.74,22.98)
  M14.02 17.92 C12.83 20.71 8.32 18.8 6.59 18.35      (nhánh 3, dot 6.59,18.35)
  ```

- **Biên ngoài:** `R + r_dot + w/2 = 9.7 + 3.8 + 2.1 = 15.6` → chừa `0.4` đơn vị mỗi phía trong khung 32. Không được vẽ tràn.
- **Cấm tự ý bo nét khi sinh asset.** Cap là `round` theo thiết kế, nhưng pipeline icon không được thay `linejoin`/bán kính/độ dày. Nếu một rasterizer làm tròn nét thành khác đi thì đó là bug của pipeline, không phải của mark.
- **Kích thước tối thiểu:** 16px. Dưới 16px không cam kết.

## 4. Màu

| Tên | Giá trị | Dùng ở đâu |
|---|---|---|
| `ember` | `#F54E00` | mark trên nền sáng (nền ≥ `#F0F0F0`) |
| `ember-dark` | `#FF7A3D` | mark trên nền tối (nền ≤ `#3A3A3A`) |
| `graphite` | `#1C1C1C` | ô nền app icon / favicon / maskable |
| `ink` | `#171717` | bản 1 màu trên nền sáng |
| `white` | `#FFFFFF` | bản 1 màu trên nền tối, knockout |
| `parchment` | `#F7F7F4` | ô nền sáng (tuỳ chọn, không dùng cho app icon) |
| `hairline` | `#CDCDC9` | viền ô nền sáng |
| `shadow` | `#7A2200` @ `0.65` | bóng S2 |

**Tương phản đã đo** (ngưỡng cho graphic không phải chữ là 3:1):

| Cặp | Tỉ lệ | Kết luận |
|---|---|---|
| ember trên trắng | 3.52:1 | đạt |
| ember trên parchment | 3.28:1 | đạt nhưng là cặp yếu nhất → không dùng parchment làm ô app icon |
| ember trên ô graphite | 4.85:1 | đạt |
| ember-dark trên card dark `#242424` | 5.99:1 | đạt |
| ember-dark trên mực `#0F0F0F` | 7.4:1 | đạt |

Màu thương hiệu **nằm ngoài** hệ token oc-2 của app (oc-2 là palette trung tính, màu rực chỉ ở chip/status). Đây là chủ ý, không phải thiếu sót: `bun run guard:tokens` không chấm các màu này, và spec này không thêm chúng vào `vars.css`.

## 5. Hiệu ứng bóng (S2)

```xml
<filter id="mark-shadow" x="-50%" y="-50%" width="200%" height="200%">
  <feDropShadow dx="0" dy="2.6" stdDeviation="2.4" flood-color="#7A2200" flood-opacity="0.65" />
</filter>
```

Áp cho **toàn bộ mark** (cả path lẫn dot) trong một `<g>` duy nhất — nếu áp riêng từng phần tử, bóng của các nhánh sẽ chồng lên nhau thành vệt bẩn.

- Dùng cho: **app icon**, **OG**, **avatar**, và lockup khi được rasterize.
- **Không** dùng cho: favicon (mọi kích thước — bản 16px bị bết, bản 32px để đồng nhất với bản 16px), mark trong UI, bản 1 màu.

## 6. Bộ asset

### 6.1 Nguồn (commit vào repo, sinh ra từ `mark.ts`)

| File | Nội dung |
|---|---|
| `assets/brand/mark.svg` | mark ember, phẳng, nền trong suốt |
| `assets/brand/mark-dark.svg` | mark ember-dark, phẳng |
| `assets/brand/mark-shadow.svg` | mark ember + bóng S2 (asset ≥32px, nền sáng) |
| `assets/brand/mark-shadow-dark.svg` | mark ember-dark + bóng S2 |
| `assets/brand/mark-mono-black.svg` | 1 màu `#171717` |
| `assets/brand/mark-mono-white.svg` | 1 màu `#FFFFFF` |
| `assets/brand/favicon.svg` | ô graphite `rx=7.4` + mark ember **phẳng** (bản 16px, không bóng) |
| `assets/brand/app-icon.svg` | 1024×1024: ô graphite `rx=230.4` (22.5%) + mark scale `0.62` + bóng S2 |
| `assets/brand/lockup.svg` | mark 16 + wordmark "Grove" dạng **text sống** (Inter 530, `letter-spacing −0.04px`) — dùng cho web/in-app nơi font đã có. **Không** dùng file này để rasterize: asset có wordmark (OG, README) render từ template HTML bằng Chromium để dùng đúng Inter woff2 |

### 6.2 Sinh ra — web (`apps/web/public/`)

| File | Kích thước | Nguồn |
|---|---|---|
| `favicon.svg` | 32 | `favicon.svg` (copy) |
| `favicon.ico` | 16/32/48 | `favicon.svg` phẳng, không bóng |
| `apple-touch-icon.png` | 180 | ô graphite **full-bleed** (iOS tự bo góc) + mark |
| `icon-192.png`, `icon-512.png` | 192/512 | `favicon.svg` (ô có alpha) |
| `icon-maskable-512.png` | 512 | graphite full-bleed + mark ở `55%` (safe zone 80%) |
| `og.png` | 1200×630 | template HTML render bằng Chromium: nền `#0F0F0F`, mark ember-dark + bóng ở 160px, wordmark Inter 530 72px, tagline `Web UI with the full capability set of the OMP TUI` (Inter 400, 28px, `#A1A19F`) |
| `manifest.webmanifest` | — | name/short_name `Grove`, icons, `theme_color` `#1C1C1C`, `background_color` `#0F0F0F` |

Wiring trong `apps/web/index.html`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`, `<link rel="icon" sizes="any" href="/favicon.ico">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color">` cho light/dark.

### 6.3 Sinh ra — desktop (`apps/desktop/`)

- `app-icon.svg` — **thay** placeholder hiện tại bằng nguồn 1024 mới.
- `src-tauri/icons/*` — sinh lại toàn bộ (`icon.icns`, `icon.ico`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, bộ Windows Store `Square*Logo.png`, `StoreLogo.png`) bằng `tauri icon` từ **PNG 1024** (không phải từ SVG — xem §7).

### 6.4 Khác

- `assets/brand/avatar-512.png` — avatar vuông cho GitHub/repo (render của `app-icon.svg`).
- README: chèn **mark** (không phải lockup) ở đầu file — `<img src="assets/brand/mark.svg">`. Không dùng lockup vì GitHub render SVG bằng font của người xem, chữ "Grove" sẽ không phải Inter.

## 7. Pipeline sinh asset

`scripts/gen-brand-assets.ts`, chạy bằng `bun run brand`.

1. Import hình học từ `packages/ui/src/brand/mark.ts` → ghi `assets/brand/*.svg`. Script **idempotent**: chạy hai lần cho ra byte giống nhau.
2. Rasterize bằng **Chromium qua Playwright** (đã có sẵn: `@playwright/test` là devDependency, Chromium đã cài cho `bun run e2e`), `screenshot({ omitBackground: true })` ở đúng kích thước pixel.
3. Viết `favicon.ico` bằng tay: header ICO + 3 entry (16/32/48) chứa PNG. Không thêm dependency.
4. Render `app-icon.svg` → `app-icon-1024.png`, rồi gọi `tauri icon app-icon-1024.png` trong `apps/desktop` để sinh bộ icns/ico/PNG/Store.
5. Render `og.png` từ template HTML (dùng đúng Inter woff2 của app → không cần file TTF).

**Vì sao không đưa SVG thẳng cho `tauri icon`:** `tauri icon` nhận cả SVG, nhưng rasterizer của nó (resvg) phải tự dựng `feDropShadow`. Bóng là phần cốt lõi của mark, nên ta rasterize bằng Chromium (đúng engine đã thiết kế) rồi đưa PNG đã có bóng cho Tauri — loại bỏ rủi ro khác biệt renderer.

**Bằng chứng đã kiểm tra trong phiên thiết kế:**
- Playwright Chromium rasterize đúng bóng `feDropShadow` (render 256px, kiểm tra ảnh: bóng ember đổ xuống dưới mark, không bị mất).
- `@tauri-apps/cli` đã cài tại `apps/desktop/node_modules`, `tauri icon --help` xác nhận nhận `[INPUT]` là "squared PNG or SVG file with transparency" và xuất vào thư mục `icons` cạnh `tauri.conf.json`.

## 8. Chỗ đặt trong app

| Bề mặt | File | Nội dung |
|---|---|---|
| Header sidebar | `apps/web/src/features/sessions/SessionSidebar.tsx` | mark 16px **phẳng** cạnh chữ "Grove" (hiện chỉ có chữ) |
| Landing | `apps/web/src/app/router.tsx` | lockup mark + "Grove" phía trên "How Can I Assist You?" |
| Component dùng chung | `packages/ui/src/components/Mark.tsx` | SVG inline (không fetch asset), props `size` (default 16), `title`, `className`. Vẽ bằng `currentColor` — **không** nhận hex và không tự quyết theme |
| Token màu cho mark | `apps/web/src/styles/globals.css` | `:root { --mark-ember: #F54E00 }` / `.dark { --mark-ember: #FF7A3D }`, comment trỏ về `mark.ts`; caller dùng `className="text-[var(--mark-ember)]"` |
| Nguồn hình học | `packages/ui/src/brand/mark.ts` | hằng số + path data + 2 hex ember; `Mark.tsx`, `gen-brand-assets.ts` cùng import — không có hai bản sao |

## 9. Verification

1. `bun run brand` → ghi đủ file ở §6; chạy lần hai → `git diff --stat` rỗng (tính idempotent).
2. `bun run check` xanh (typecheck + lint + test + smoke:server).
3. Test bất biến `packages/ui/src/brand/mark.test.ts`: đúng 3 nhánh; 3 điểm đầu cành cùng bán kính (sai số `0.01`); nhánh 2 và 3 là phép quay 120°/240° của nhánh 1 (sai số `0.01`); biên ngoài `≤ 15.7`; `assets/brand/mark.svg` (đã commit) khớp path data phát ra từ `mark.ts`; và `--mark-ember`/`--mark-ember-dark` trong `apps/web/src/styles/globals.css` khớp 2 hex trong `mark.ts` — ba test cuối là guard chống drift giữa nguồn, asset và CSS.
4. Web: mở `bun run dev:web` → kiểm tra tab favicon, mark trong header sidebar, lockup ở landing, cả light và dark.
5. 16px: mở trực tiếp `favicon.ico`/`favicon.svg` ở 16px và kiểm tra mắt thường — không bóng, không nhoè.
6. Desktop: `bun run build:desktop` → `cd apps/desktop && bun run tauri icon <path>/app-icon-1024.png` → `apps/desktop/src-tauri/icons/icon.icns`; mở app đã build, xác nhận icon dock là ô graphite + mark ember.
7. `bun run smoke:bundle` xanh (bộ icon Windows Store không bị thiếu sau khi sinh lại).

## 10. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| 1 | Rasterizer bỏ `feDropShadow` → asset mất bóng | Trung | Đã verify Chromium dựng đúng; `tauri icon` nhận PNG đã có bóng. Fallback nếu vẫn hỏng: bake bóng thành lớp path offset nhiều bước (không dùng filter) |
| 2 | 16px bị bết | Trung | Favicon dùng bản ô đặc phẳng, không bóng; verify bằng bước 5 |
| 3 | Mark chìm ở dark mode | Thấp | Có step `ember-dark` riêng; đo 5.99:1 trên card dark |
| 4 | Asset và nguồn hình học lệch nhau | Trung | Test bất biến §9.3 đọc file đã commit và so với `mark.ts` |
| 5 | Sinh lại icon Tauri làm mất bộ Windows Store | Thấp | `tauri icon` sinh lại toàn bộ; `smoke:bundle` là cổng kiểm |
| 6 | Ô vuông góc app icon lệch chuẩn macOS (22.37%) | Thấp | Dùng 22.5% (`rx=230.4`/1024); kiểm bằng mắt trong dock |
| 7 | Wordmark phụ thuộc font | Thấp | Wordmark trong app là text với Inter woff2 sẵn có; asset rasterize qua Chromium nên dùng đúng font, không cần TTF |

## 11. Thứ tự thực thi (cho plan)

1. `packages/ui/src/brand/mark.ts` + test bất biến.
2. `scripts/gen-brand-assets.ts` + script `brand` trong `package.json`; sinh `assets/brand/*.svg` và commit.
3. Asset web + wiring `apps/web/index.html` + `manifest.webmanifest`.
4. `Mark.tsx` + đặt vào header sidebar và landing.
5. App icon desktop: `apps/desktop/app-icon.svg` + sinh lại `src-tauri/icons/*`.
6. OG + avatar + lockup README.
7. Docs: thêm mục "Brand mark" vào `docs/design-system.md`, thêm `assets/brand/` vào Key Directories của `AGENTS.md`.
8. Verification §9 + `bun run check`.
