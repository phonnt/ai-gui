# Grove UI Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm phần render của `apps/web` khớp recipe của OpenCode Desktop (type ramp Inter, hairline 0.5px, thang radius 4/6/8/10, elevation token, kit điều khiển + dialog + panel) và dồn recipe copy-paste vào `@grove/ui`.

**Architecture:** Token màu đã là `oc-2` (commit `75d1b84`). Plan này thêm một lớp theme Tailwind v4 (`@theme inline` + `@utility hairline*`) trong `apps/web/src/styles/globals.css`, biến `vars.css` thành nguồn duy nhất cho màu + elevation, rồi thay class thô `hsl(var(--x))` bằng utility (`bg-card`, `text-muted-foreground`). Sau đó dựng kit điều khiển/panel trong `packages/ui` theo đúng số đo của app, và migrate từng cụm màn hình. Mỗi task ship được độc lập và kết thúc bằng `bun run check` + probe computed style trong app thật.

**Tech Stack:** Bun ≥1.3.14, TypeScript strict, React 19, Tailwind v4 (`@import "tailwindcss"` + `@theme inline` + `@utility`), class-variance-authority, Biome, Vitest/bun test.

**Spec:** `docs/superpowers/specs/2026-09-21-grove-ui-parity-design.md` — bảng recipe đích trích từ bundle app nằm ở đó; plan này không nhắc lại toàn bộ, chỉ nhắc phần cần cho từng task.

## Global Constraints

- Token màu trong `packages/ui/src/styles/vars.css` là HSL triplet, dùng qua `hsl(var(--x))`; **không đổi tên token** đã có trong commit `75d1b84`.
- **Không hex/rgb trong component.** Màu chỉ đến từ token (trừ `box-shadow` elevation đặt trong `vars.css`).
- Sau mỗi task: `bun run format` (Biome) rồi `bun run check` phải xanh; commit một lần mỗi task.
- Không thêm file JS mới; TypeScript strict; không sửa nội dung lịch sử trong `docs/superpowers/**` của plan/spec khác.
- App đích để so: `/Applications/OpenCode.app` (theme `oc-2`); bundle CSS dẫn ở spec.
- Mọi con số trong task (height/padding/radius/type) lấy từ spec — không tự chế.
- Probe computed style dùng `browser` (tab đã mở) hoặc `tab.run`; mỗi probe phải ghi rõ giá trị mong đợi.

## Review Focus

1. **Tiếng Việt trong Inter** — nếu font bị subset latin, mọi dấu (ệ, ữ, ợ) rơi về fallback và chữ trộn hai kiểu. Bắt bằng probe `document.fonts.check('13px Inter', 'Cài đặt phiên mới')` phải `true` + ảnh chụp một dòng có dấu.
2. **Elevation ở dark mode** — app đổi hẳn bộ shadow (light: `#0000000a…`; dark: `#0000004d… + #ffffff29`). Nếu chỉ copy bộ light, panel/dialog ở dark mất viền sáng và chìm vào nền. Bắt bằng probe `box-shadow` ở cả 2 mode, phải khác nhau và dark phải chứa `255, 255, 255`.
3. **`@theme inline` bị set sai** — utility emit giá trị đã resolve thay vì `var(...)` thì theme ngừng đổi. Bắt bằng probe: đổi `.dark`, đọc `getComputedStyle(card).backgroundColor`, giá trị phải đổi.
4. **Hairline 0.5px mất tác dụng phân tách** — chỗ nào panel từng dựa vào viền 1px để tách khỏi nền cùng màu có thể mất ranh giới. Bắt bằng ảnh chụp light + dark trước/sau ở màn Chat và Settings.
5. **Tag 16px + radius 2px** — chip nhỏ hơn hiện tại (22–24px, radius 6) và vuông hơn; cạnh badge/segmented 28px dễ trông lệch. Bắt bằng ảnh chụp Transcript + Providers pane sau Task 4.

---

### Task 1: Nền tảng type + Inter self-host + theme block

**Files:**
- Create: `apps/web/public/fonts/InterVariable.woff2`, `apps/web/public/fonts/Inter-LICENSE.txt`
- Modify: `apps/web/src/styles/globals.css` (thêm `@font-face` + `@theme inline` + base type), `packages/ui/src/styles/vars.css` (thêm `--elevation-*` cho 2 mode), `apps/web/index.html` (preload font)

**Interfaces:**
- Produces: utility/ramp cho các task sau — `text-meta` (11/16, +0.05px), `text-small` (12/16, 0), `text-body` (13/20, −0.04px), `text-title` (15/20, −0.13px), `text-hero` (26/32, −0.02em); `font-regular` (440), `font-strong` (530); `font-sans`, `font-mono`; `rounded-sm|md|lg|xl` = 4/6/8/10px; `shadow-raised|floating|overlay|control`, `shadow-control-contrast` (map sang `--elevation-*`).

- [ ] **Step 1: Self-host Inter variable (bản đầy đủ, có tiếng Việt)**

```sh
mkdir -p apps/web/public/fonts
curl -L -o /tmp/inter.zip https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
unzip -l /tmp/inter.zip | grep -i 'InterVariable.woff2\|LICENSE'
# đường dẫn thật trong zip là 'web/InterVariable.woff2' (bản web = variable, full charset)
unzip -o -j /tmp/inter.zip 'web/InterVariable.woff2' 'LICENSE.txt' -d apps/web/public/fonts
mv apps/web/public/fonts/LICENSE.txt apps/web/public/fonts/Inter-LICENSE.txt
ls -l apps/web/public/fonts
```

Expected: `InterVariable.woff2` ≈ 300–400 KB (không phải bản subset ~100 KB), `Inter-LICENSE.txt` tồn tại. Nếu `unzip -l` không có `web/InterVariable.woff2` thì lấy TTF variable trong zip rồi nén bằng `bunx fonttools ttLib.woff2 compress` (ghi lại đường dẫn đã dùng trong commit message).

- [ ] **Step 2: Khai báo `@font-face` + preload**

`apps/web/src/styles/globals.css` (đầu file, sau `@import`):

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/InterVariable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

`apps/web/index.html`, trong `<head>`:

```html
<link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 3: Theme block (ramp + radius + shadow + font)**

`apps/web/src/styles/globals.css`, thêm block dưới đây (đặt trước `@layer base`):

```css
@theme inline {
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrainsMonoNerdFontMono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-meta: 11px;
  --text-meta--line-height: 16px;
  --text-meta--letter-spacing: 0.05px;
  --text-small: 12px;
  --text-small--line-height: 16px;
  --text-body: 13px;
  --text-body--line-height: 20px;
  --text-body--letter-spacing: -0.04px;
  --text-title: 15px;
  --text-title--line-height: 20px;
  --text-title--letter-spacing: -0.13px;
  --text-hero: 26px;
  --text-hero--line-height: 32px;
  --text-hero--letter-spacing: -0.02em;

  --font-weight-regular: 440;
  --font-weight-strong: 530;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 10px;

  --shadow-raised: var(--elevation-raised);
  --shadow-floating: var(--elevation-floating);
  --shadow-overlay: var(--elevation-overlay);
  --shadow-control: var(--elevation-control);
  --shadow-control-contrast: var(--elevation-control-contrast);
}
```

- [ ] **Step 4: Elevation token trong `vars.css` (cả 2 mode)**

`packages/ui/src/styles/vars.css` — thêm vào `:root` (light) và `.dark`, đúng bộ giá trị của app:

```css
/* :root (light) */
--elevation-raised: 0 2px 4px rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.12);
--elevation-floating: 0 8px 16px rgb(0 0 0 / 0.04), 0 4px 8px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.12);
--elevation-overlay: 0 16px 32px rgb(0 0 0 / 0.04), 0 8px 16px rgb(0 0 0 / 0.08), 0 0 0 0.5px rgb(0 0 0 / 0.12);
--elevation-control: 0 1px 1.5px rgb(0 0 0 / 0.1), 0 0 0 0.5px rgb(0 0 0 / 0.14);
--elevation-control-contrast: 0 1px 1.5px rgb(0 0 0 / 0.2), 0 0 0 0.5px rgb(58 58 58), inset 0 1px 2px rgb(255 255 255 / 0.14), inset 0 -1px 2px rgb(0 0 0 / 0.06);

/* .dark */
--elevation-raised: 0 2px 4px rgb(0 0 0 / 0.3), 0 1px 2px rgb(0 0 0 / 0.3), 0 0 0 0.5px rgb(255 255 255 / 0.16), 0 -0.5px 0 rgb(255 255 255 / 0.06);
--elevation-floating: 0 8px 16px rgb(0 0 0 / 0.3), 0 4px 8px rgb(0 0 0 / 0.3), 0 0 0 0.5px rgb(255 255 255 / 0.16), 0 -0.5px 0 rgb(255 255 255 / 0.06);
--elevation-overlay: 0 16px 32px rgb(0 0 0 / 0.3), 0 8px 16px rgb(0 0 0 / 0.3), 0 0 0 0.5px rgb(255 255 255 / 0.16), 0 -0.5px 0 rgb(255 255 255 / 0.06);
--elevation-control: 0 1px 2px rgb(0 0 0 / 0.4), 0 0 0 0.5px rgb(255 255 255 / 0.2), 0 -0.5px 0 rgb(255 255 255 / 0.1);
--elevation-control-contrast: 0 1px 2px rgb(0 0 0 / 0.4), 0 0 0 0.5px rgb(255 255 255 / 0.4), 0 -0.5px 0 rgb(255 255 255 / 0.3);
```

- [ ] **Step 5: Base type theo app**

`apps/web/src/styles/globals.css`, sửa `body`:

```css
body {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 440;
  line-height: 20px;
  letter-spacing: -0.04px;
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
```

- [ ] **Step 6: Probe font + ramp + shadow**

```js
// tab đang mở ở http://localhost:5173
const r = await tab.run(async ({ page }) => page.evaluate(() => ({
  inter: document.fonts.check('13px Inter', 'Cài đặt phiên mới — ữợệ'),
  bodyFont: getComputedStyle(document.body).fontFamily,
  bodyWeight: getComputedStyle(document.body).fontWeight,
  bodySpacing: getComputedStyle(document.body).letterSpacing,
  cardShadow: getComputedStyle(document.querySelector('[class*=shadow-raised]') ?? document.body).boxShadow,
  dark: document.documentElement.classList.contains('dark'),
})));
```

Expected: `inter: true`; `bodyFont` bắt đầu bằng `Inter`; `bodyWeight: "440"`; `bodySpacing: "-0.04px"`. Đổi `.dark` rồi đọc lại `--elevation-raised` → chuỗi chứa `255, 255, 255`.

- [ ] **Step 7: Gate + commit**

```sh
bun run format && bun run check
git add apps/web/public/fonts apps/web/index.html apps/web/src/styles/globals.css packages/ui/src/styles/vars.css
git commit -m "feat(web): self-host Inter and add the oc-2 type, radius, elevation theme layer"
```

---

### Task 2: Thay class thô `hsl(var(--x))` bằng utility theme

**Files:**
- Modify: `apps/web/src/styles/globals.css` (`@theme inline` thêm map màu), mọi file `.tsx` trong `apps/web/src` + `packages/ui/src` có `hsl(var(--`

**Interfaces:**
- Consumes: `@theme inline` từ Task 1.
- Produces: utility màu — `bg-background|card|popover|primary|primary-hover|secondary|muted|accent|destructive|success|warning|info|link|sidebar|terminal-bg|overlay`, `text-foreground|muted-foreground|primary-foreground|secondary-foreground|accent-foreground|destructive-foreground|link|success|warning|warning-strong|info|syntax-keyword|syntax-string|syntax-type`, `border-border|border-strong|input|ring|warning|link`, `outline-ring`. Hỗ trợ opacity modifier (`bg-card/40`, `outline-ring/60`) do `@theme inline`.

- [ ] **Step 1: Map màu vào theme block**

Thêm vào `@theme inline` (globals.css):

```css
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-hover: hsl(var(--primary-hover));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-border-strong: hsl(var(--border-strong));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-link: hsl(var(--link));
  --color-success: hsl(var(--success));
  --color-warning: hsl(var(--warning));
  --color-warning-strong: hsl(var(--warning-strong));
  --color-info: hsl(var(--info));
  --color-syntax-keyword: hsl(var(--syntax-keyword));
  --color-syntax-string: hsl(var(--syntax-string));
  --color-syntax-type: hsl(var(--syntax-type));
  --color-sidebar: hsl(var(--sidebar));
  --color-sidebar-foreground: hsl(var(--sidebar-foreground));
  --color-sidebar-border: hsl(var(--sidebar-border));
  --color-terminal: hsl(var(--terminal-bg));
  --color-overlay: hsl(var(--overlay));
```

- [ ] **Step 2: Rewrite token thô thành utility + opacity modifier**

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.ts' 'packages/ui/src/**/*.tsx')
for T in background foreground card card-foreground popover popover-foreground primary primary-hover primary-foreground \
         secondary secondary-foreground muted muted-foreground accent accent-foreground destructive destructive-foreground \
         border border-strong input ring link success warning warning-strong info \
         syntax-keyword syntax-string syntax-type sidebar sidebar-foreground sidebar-border terminal-bg overlay diff-add diff-del; do
  echo "$FILES" | xargs sd "\\[hsl\\(var\\(--$T\\)\\)\\]" "-$T" 2>/dev/null
done
# alpha: liệt kê đủ 8 giá trị đang dùng (thứ tự quan trọng: 0.12 trước 0.1; 0.65 trước 0.6)
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.12\)\]' '/12' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.1\)\]' '/10' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.65\)\]' '/65' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.6\)\]' '/60' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.4\)\]' '/40' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.09\)\]' '/9' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.08\)\]' '/8' 2>/dev/null
echo "$FILES" | xargs sd '\[hsl\(var\(--([a-z-]+)\)/0\.06\)\]' '/6' 2>/dev/null
# 2 shadow arbitrary (không khớp pattern trên vì nằm trong shadow-[…])
echo "$FILES" | xargs sd 'shadow-\[0_8px_24px_hsl\(var\(--foreground\)/0\.08\)\]' 'shadow-floating' 2>/dev/null
# kết quả dạng: bg-card/40 (Tailwind hiểu là color-mix với transparent)
grep -rn 'hsl(var(--' $FILES | wc -l
```

Chỗ duy nhất **không** đổi là 7 scrim — chúng không khớp pattern nào ở trên vì alpha là biến, nên thay bằng utility `scrim` ngay trong step này (Task 5 gom vào `Dialog`):

```sh
echo "$FILES" | xargs sd 'bg-\[hsl\(var\(--overlay\)/var\(--overlay-alpha\)\)\]' 'scrim'
```

Thêm 4 triplet state còn thiếu vào `vars.css` (hex từ `themes/oc-2.json` → HSL triplet; giá trị dưới đây đã tính):

```css
/* :root — light */
--destructive-bg: 4 74% 95%;        /* #fceceb */
--destructive-border: 4 69% 83%;    /* #f2bbb7 */
--info-bg: 223 90% 96%;             /* #ecf1fe */
--info-border: 222 94% 88%;         /* #c3d4fd */

/* .dark */
--destructive-bg: 359 54% 18%;      /* #461516 */
--destructive-border: 357 61% 37%;  /* #97252b */
--info-bg: 226 50% 21%;             /* #1b2852 */
--info-border: 229 63% 41%;         /* #263fa9 */
```

Map tương ứng vào `@theme inline`: `--color-destructive-bg`, `--color-destructive-border`, `--color-info-bg`, `--color-info-border`, `--color-success-bg`, `--color-success-border`, `--color-warning-bg`, `--color-warning-border`, `--color-diff-add`, `--color-diff-del`.

- [ ] **Step 3: Kiểm tra không còn class thô**

```sh
grep -rn 'hsl(var(--' apps/web/src packages/ui/src --include='*.tsx' --include='*.ts' | grep -v 'styles/globals.css' | wc -l
```

Expected: `0`.

- [ ] **Step 4: Probe theme đổi theo mode (chống lỗi `@theme` resolve sớm)**

```js
const probe = await tab.run(async ({ page }) => {
  const read = () => ({
    card: getComputedStyle(document.querySelector('[class*=rounded-md]')).backgroundColor,
    dark: document.documentElement.classList.contains('dark'),
  });
  const light = await page.evaluate(read);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await new Promise((r) => setTimeout(r, 300));
  const dark = await page.evaluate(read);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  return { light, dark };
});
```

Expected: `light.card !== dark.card` (`rgb(250, 250, 250)` vs `rgb(36, 36, 36)`).

- [ ] **Step 5: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): consume theme utilities instead of raw hsl(var()) class strings"
```

---

### Task 3: Hairline 0.5px + elevation thay border 1px / shadow-lg

**Files:**
- Modify: `apps/web/src/styles/globals.css` (`@utility hairline*`), `packages/ui/src/components/*.tsx`, các panel/dialog dùng `border border-border`
- Test: `scripts/` không đụng; verify bằng probe

**Interfaces:**
- Consumes: `shadow-raised|floating|overlay|control` (Task 1), utility màu (Task 2).
- Produces: `hairline` (inset 0 0 0 0.5px `--border`), `hairline-strong` (`--border-strong`), `hairline-muted` (alpha 8% qua `--overlay/80`), `hairline-none`. Task 4–7 dùng các utility này thay `border`.

- [ ] **Step 1: Định nghĩa utility hairline**

`apps/web/src/styles/globals.css`:

```css
@utility hairline {
  box-shadow: inset 0 0 0 0.5px hsl(var(--border));
}
@utility hairline-strong {
  box-shadow: inset 0 0 0 0.5px hsl(var(--border-strong));
}
@utility hairline-muted {
  box-shadow: inset 0 0 0 0.5px hsl(var(--overlay) / 0.08);
}
@utility hairline-b {
  box-shadow: inset 0 -0.5px 0 0 hsl(var(--border));
}
@utility hairline-t {
  box-shadow: inset 0 0.5px 0 0 hsl(var(--border));
}
@utility scrim {
  background-color: hsl(var(--overlay) / var(--overlay-alpha));
}
@utility hairline-none {
  box-shadow: none;
}
```

- [ ] **Step 2: Thay shadow rời bằng token elevation (12 chỗ)**

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx' 'packages/ui/src/**/*.tsx')
# menu/dropdown/popover -> floating ; dialog -> overlay ; nút/điều khiển -> control
echo "$FILES" | xargs sd 'shadow-lg' 'shadow-floating'
echo "$FILES" | xargs sd 'shadow-2xl' 'shadow-overlay'
```

Sau đó sửa 2 chỗ `shadow-floating` ở `router.tsx:111` và `Composer.tsx:181` — đã làm ở Task 2 Step 2 nếu chạy đúng thứ tự; nếu chưa, đặt `shadow-floating`.

- [ ] **Step 3: Panel/dialog/card từ border 1px sang hairline**

Các cụm (đếm từ inventory: 111 chỗ `rounded-md border border-border`). Chạy **đúng thứ tự** — lệnh đầu tách nhóm có `bg-card`, lệnh sau chỉ còn nhóm panel trần:

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx' 'packages/ui/src/**/*.tsx')
echo "$FILES" | xargs sd 'rounded-md border border-border bg-card' 'rounded-md bg-card hairline'
echo "$FILES" | xargs sd 'rounded-md border border-border' 'rounded-md hairline'
echo "$FILES" | xargs sd 'rounded-md border border-input bg-background' 'rounded-md bg-background hairline'
echo "$FILES" | xargs sd 'rounded-md border border-border bg-background' 'rounded-md bg-background hairline'
echo "$FILES" | xargs sd 'border-b border-border' 'hairline-b'
echo "$FILES" | xargs sd 'border-t border-border' 'hairline-t'
```

Các chỗ còn `border border-border` (không phải panel/card: divider, input nhỏ, chip) giữ 1px — kiểm bằng:

```sh
grep -rn 'border border-border\|border-b border-border\|border-t border-border' apps/web/src packages/ui/src --include='*.tsx' | wc -l
```

Expected: chỉ còn ≤ 12 dòng, tất cả thuộc input/chip/divider (liệt kê ra trong commit message).

- [ ] **Step 4: Probe hairline + elevation 2 mode**

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const panel = document.querySelector('section, aside, [class*=rounded-md]');
  const s = getComputedStyle(panel);
  return { shadow: s.boxShadow, borderWidth: s.borderTopWidth };
}));
```

Expected: `borderWidth: "0px"`; `shadow` chứa `inset` và `0.5px`. Ở dark, `shadow` phải chứa `255, 255, 255`.

- [ ] **Step 5: Ảnh chụp light/dark màn Chat + Settings (Review Focus 4)**

Chụp trước/sau ở `http://localhost:5173/s/<id>` và mở Settings; ghi vào commit message: ranh giới panel còn thấy ở cả 2 mode.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(web): 0.5px hairlines and oc-2 elevation tokens instead of 1px borders and shadow-lg"
```

---

### Task 4: Kit điều khiển trong `@grove/ui`

**Files:**
- Modify: `packages/ui/src/components/button.tsx`, `packages/ui/src/components/input.tsx`, `packages/ui/src/components/badge.tsx`
- Create: `packages/ui/src/components/icon-button.tsx`, `packages/ui/src/components/textarea.tsx`, `packages/ui/src/components/tag.tsx`
- Modify: `packages/ui/src/index.ts` (export mới), call sites dùng `size="sm"` (27 chỗ `<Button size="sm" variant="outline"`)

**Interfaces:**
- Consumes: ramp + radius + hairline (Task 1–3).
- Produces: `Button` variant `default|neutral|outline|ghost|ghost-muted|danger|warning|destructive|link`, size `sm|default|lg|icon` (24/28/32 px, radius 4/6/6); `IconButton({ size, variant, label })` 20/24/28 px; `Textarea` (min-h 80, radius 6, `padding 8px`, lh 1.35); `Tag` (16px, radius 2, 11px/530/+0.05px) với variants `neutral|accent|success|warning|danger|info`.

- [ ] **Step 1: Button theo số đo app**

`packages/ui/src/components/button.tsx`:

```tsx
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-strong transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-border-strong bg-primary text-primary-foreground hover:bg-primary-hover',
        neutral: 'hairline bg-secondary text-secondary-foreground hover:bg-accent',
        outline: 'hairline-muted bg-transparent text-foreground hover:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent',
        'ghost-muted': 'bg-transparent text-muted-foreground hover:bg-accent',
        danger: 'bg-transparent text-destructive hover:bg-accent',
        warning: 'bg-transparent text-warning-strong hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'bg-transparent text-link underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-6 rounded-sm px-[9px] text-small',
        default: 'h-7 px-[11px] text-body',
        lg: 'h-8 px-[15px] text-body',
        icon: 'size-6 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
```

- [ ] **Step 2: IconButton + Textarea + Tag**

`packages/ui/src/components/icon-button.tsx`:

```tsx
const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
    variants: { size: { sm: 'size-5 rounded-sm', default: 'size-6', lg: 'size-7' } },
    defaultVariants: { size: 'default' },
  },
);
export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  label: string;
}
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, size, label, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(iconButtonVariants({ size }), className)}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';
```

`packages/ui/src/components/textarea.tsx`:

```tsx
const textareaClassName =
  'min-h-20 w-full rounded-md bg-background hairline px-2 py-2 text-body text-foreground placeholder:text-muted-foreground outline-none hover:hairline-strong focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(textareaClassName, className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';
```

`packages/ui/src/components/tag.tsx`:

```tsx
const tagVariants = cva(
  'inline-flex items-center gap-1 rounded-sm font-strong text-meta uppercase hairline px-1 h-4 bg-muted text-muted-foreground',
  {
    variants: {
      variant: {
        neutral: '',
        accent: 'bg-primary text-primary-foreground hairline-none',
        success: 'bg-success-bg text-success hairline-none',
        warning: 'bg-warning-bg text-warning-strong hairline-none',
        danger: 'bg-destructive-bg text-destructive hairline-none',
        info: 'bg-info-bg text-info hairline-none',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);
```

(`bg-success-bg` v.v. cần thêm 6 map màu `*-bg` vào `@theme inline` trong Task 2 — nếu Task 2 đã xong mà thiếu, bổ sung ở task này.)

- [ ] **Step 3: Migrate call site (Button size `sm` → `default`, thêm variant mới)**

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx')
# 27 chỗ: nút nhỏ trong header/panel dùng 28px theo app
echo "$FILES" | xargs sd 'size="sm" variant="outline"' 'variant="outline"'
echo "$FILES" | xargs sd '<Button size="sm"' '<Button'
```

Các nút icon rời (`<button className="… p-1 …"><Icon/></button>`) chuyển sang `IconButton` — liệt kê bằng:

```sh
grep -rn '<button' apps/web/src --include='*.tsx' | grep -c 'p-1\|size-3.5'
```

Expected: ghi ra số chỗ, migrate hết trong task này.

- [ ] **Step 4: Probe số đo (Review Focus 5)**

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() =>
  [...document.querySelectorAll('[class*=rounded-md], [class*=rounded-sm]')].slice(0, 40).map((el) => {
    const s = getComputedStyle(el);
    return { h: s.height, r: s.borderTopLeftRadius, fs: s.fontSize, fw: s.fontWeight };
  })));
```

Expected: nút trong header có `h: "28px"`, `r: "6px"`, `fs: "13px"`, `fw: "530"`; tag `h: "16px"`, `r: "4px"` (radius-sm) và `fs: "11px"`.

- [ ] **Step 5: Ảnh chụp Transcript + Providers (chip/tag mới)**

Ghi kết luận (không cần lưu file vào repo): tag vuông hơn và thấp hơn — nếu trông lệch so với badge 28px thì báo lại trong commit message để chốt deviation.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(ui): control kit at oc-2 metrics (buttons, icon buttons, textarea, tag)"
```

---

### Task 5: Primitive Dialog, thay 9 dialog tự viết tay

**Files:**
- Create: `packages/ui/src/components/dialog.tsx`
- Modify: `apps/web/src/features/palette/CommandPalette.tsx`, `features/providers/ProvidersPane.tsx`, `features/sessions/DirBrowser.tsx`, `features/sessions/ForeignImportDialog.tsx`, `features/sessions/ModesPanel.tsx`, `features/sessions/SessionSwitcher.tsx`, `features/settings/SettingsModal.tsx`, `features/model/ModelPicker.tsx` (2 popover), `features/chat/ChatPage.tsx` + `features/sessions/PlanReview.tsx` (alertdialog)

**Interfaces:**
- Consumes: `IconButton` (Task 4), `shadow-overlay`, `hairline`, `--overlay`/`--overlay-alpha`.
- Produces: `Dialog({ open, onClose, label, size, children })` + `DialogHeader({ title, description, onClose })` + `DialogBody` + `DialogFooter`; `Popover({ open, onClose, label, align, children })` cho dropdown (ModelPicker, OpsBar menu). Kích thước: `md` 480×368, `lg` 640×480, `xl` `min(100vw - 32px, 980px)`; radius 6 (`xl` 12); header padding 16px; title 15px/530/−0.13px; footer padding 16px, gap 8px.

- [ ] **Step 1: Viết Dialog**

```tsx
export function Dialog({ open, onClose, label, size = 'md', children }: DialogProps) {
  useEscapeToClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn('relative flex flex-col overflow-hidden rounded-md bg-card shadow-overlay', dialogSizes[size])}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Migrate từng call site**

Mỗi file: bỏ `<button … aria-label="Close …" className="absolute inset-0 … bg-overlay/…"/>` + wrapper `<div role="dialog">`, thay bằng `<Dialog open onClose label=…>`; bỏ `useEscapeToClose` ở call site (chuyển vào Dialog). Danh sách + số dòng hiện tại:

```sh
grep -rn 'role="dialog"\|role="alertdialog"' apps/web/src --include='*.tsx'
```

Expected sau khi xong: `role=` chỉ còn trong `packages/ui/src/components/dialog.tsx`.

- [ ] **Step 3: Scrim token đúng mode**

```sh
grep -rn 'bg-overlay' apps/web/src packages/ui/src --include='*.tsx' | wc -l
```

Expected: chỉ còn trong `dialog.tsx` (1 chỗ).

- [ ] **Step 4: Probe dialog (radius, padding, scrim alpha)**

```js
const probe = await tab.run(async ({ page }) => {
  // mở Modes panel rồi đọc
  const el = document.querySelector('[role="dialog"]');
  const scrim = document.querySelector('[aria-label^="Close"]');
  return { r: getComputedStyle(el).borderTopLeftRadius, shadow: getComputedStyle(el).boxShadow, scrim: getComputedStyle(scrim).backgroundColor };
});
```

Expected: `r: "6px"`, `shadow` chứa `0 16px 32px`, scrim `rgba(0, 0, 0, 0.4)` (light) / `0.6` (dark).

- [ ] **Step 5: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): one Dialog primitive for every hand-rolled modal"
```

---

### Task 6: Kit panel + trạng thái (dồn recipe lặp)

**Files:**
- Create: `packages/ui/src/components/panel.tsx` (`Panel`, `PaneHeader`, `SectionLabel`), `packages/ui/src/components/state.tsx` (`ErrorState`, `EmptyState`, `StatusDot`)
- Modify: 38 file dùng `text-destructive` (71 chỗ), 10 file có box lỗi + Retry (12 chỗ), 13 file có nhãn `text-xs font-semibold uppercase tracking-wide` (28 chỗ), `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Button` (Task 4), `hairline`, ramp.
- Produces: `Panel({ children, className })` = `rounded-md bg-card hairline`; `PaneHeader({ title, actions })` = `h-10 px-3 hairline-b` + `SectionLabel` = `text-small font-strong text-muted-foreground`; `StatusDot({ tone })` với tone `success|warning|danger|muted`; `ErrorState({ message, onRetry })` (box giữa, `Button variant="neutral"` Retry); `EmptyState({ message, action })`.

- [ ] **Step 1: Viết kit**

```tsx
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md p-3 text-center hairline">
      <p className="text-small text-destructive">{message}</p>
      {onRetry ? <Button variant="neutral" onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

const dotTones = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground',
} as const;

export function StatusDot({ tone, className }: { tone: keyof typeof dotTones; className?: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dotTones[tone], className)} />;
}
```

- [ ] **Step 2: Migrate box lỗi + Retry (12 chỗ/10 file)**

Danh sách đích xác (từ inventory): `artifacts/ArtifactBrowser.tsx:52`, `explorer/ExplorerPane.tsx:210`, `lsp/LspPanel.tsx:146` (`ErrorBox` nội bộ — xoá, dùng `ErrorState`), `hub/HubPanel.tsx:346`, `hub/JobsPanel.tsx:101`, `knowledge/KnowledgePane.tsx:73,292`, `mcp/McpPane.tsx:87`, `providers/ProvidersPane.tsx:79`, `settings/SettingsPane.tsx:263`, `settings/ThemePicker.tsx:59`, `todos/TodoPanel.tsx:158`.

Verify:

```sh
grep -rn 'items-center gap-2 rounded-md.*p-3 text-center' apps/web/src --include='*.tsx' | wc -l
```

Expected: `0`.

- [ ] **Step 3: Migrate nhãn section (28 chỗ) + card cluster**

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx')
echo "$FILES" | xargs sd 'text-xs font-semibold uppercase tracking-wide text-muted-foreground' 'text-meta uppercase text-muted-foreground font-strong'
echo "$FILES" | xargs sd 'text-xs font-semibold uppercase tracking-wide' 'text-meta uppercase font-strong'
```

Expected sau đó: `grep -rn 'font-semibold\|tracking-wide' apps/web/src | wc -l` → `0`.

- [ ] **Step 4: Chuyển `text-destructive` sang `ErrorText`/`ErrorState`**

71 chỗ liệt kê ở `apps/web/src/**` (inventory `RecipeScout` §4a). Trong đó 12 chỗ là box lỗi (Step 2), phần còn lại là dòng chữ lỗi inline → dùng `text-small text-destructive`. Sửa từng file; verify:

```sh
grep -rn 'text-xs text-destructive' apps/web/src --include='*.tsx' | wc -l
```

Expected: `0`.

- [ ] **Step 5: Probe + ảnh chụp 3 pane có nhiều lỗi nhất (`DebugPanel`, `LspPanel`, `HubPanel`)**

Expected: box lỗi cùng kiểu (radius 6, hairline, chữ 12px đỏ), Retry là nút `neutral` 28px.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): shared panel and state kit replaces duplicated pane chrome"
```

---

### Task 7: Shell chrome + tab + scrollbar

**Files:**
- Modify: `apps/web/src/features/sessions/OpsBar.tsx` (header), `features/chat/ChatPage.tsx` (rail + tool panel header), `features/sessions/SessionSidebar.tsx` (row + group header + status card), `features/chat/SessionFooter.tsx`, `apps/web/src/styles/globals.css` (scrollbar + tab recipe), `packages/ui/src/components/scroll-area.tsx` (create) hoặc CSS thuần

**Interfaces:**
- Consumes: mọi thứ từ Task 1–6.
- Produces: `.tab-strip` / `.tab` / `.tab[data-selected]` (list 32px, gap 6, padding-inline 8, vạch dưới 1px `--border`, chữ 13/440/−0.04, selected chữ base + gạch chân `--muted-foreground`); `.scroll-area` (ẩn scrollbar gốc, thumb 12px + `::after` 4px radius 9999 màu `--border-strong`); số đo shell: header cao 40px, rail 48px, sidebar row 28px/radius 6.

- [ ] **Step 1: Tab strip theo `tabs-v2`**

```css
@utility tab-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding-inline: 8px;
  box-shadow: inset 0 -1px 0 0 hsl(var(--border));
}
@utility tab {
  display: flex;
  align-items: center;
  height: 100%;
  padding-inline: 6px;
  font-size: 13px;
  font-weight: 440;
  letter-spacing: -0.04px;
  color: hsl(var(--muted-foreground));
  border-bottom: 1px solid transparent;
}
@utility tab-selected {
  color: hsl(var(--foreground));
  border-bottom-color: hsl(var(--muted-foreground));
}
```

Áp vào tab hiện có trong `ChatPage.tsx`/`SettingsModal.tsx` (`tabs i.active`).

- [ ] **Step 2: Scrollbar (native, không ẩn — app ẩn scrollbar gốc rồi vẽ thumb bằng JS; ở đây giữ native nhưng tạo đúng cảm giác thumb 4px)**

```css
@layer base {
  .scroll-area {
    scrollbar-width: thin; /* Firefox */
    scrollbar-color: hsl(var(--border-strong)) transparent;
  }
  /* 12px track, thumb "4px" bằng border trong suốt + background-clip */
  .scroll-area::-webkit-scrollbar {
    width: 12px;
    height: 12px;
  }
  .scroll-area::-webkit-scrollbar-track {
    background: transparent;
  }
  .scroll-area::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border-strong));
    background-clip: content-box;
    border: 4px solid transparent;
    border-radius: 9999px;
  }
  .scroll-area::-webkit-scrollbar-thumb:hover {
    background-color: hsl(var(--foreground));
  }
  .scroll-area::-webkit-scrollbar-corner {
    background: transparent;
  }
}
```

Nếu cần ẩn hẳn (tab list, rail) thì thêm class `[&::-webkit-scrollbar]:hidden [scrollbar-width:none]` tại chỗ — không đặt thành mặc định của `.scroll-area`.

Gắn `scroll-area` vào: `Transcript.tsx:80`, `SessionSidebar.tsx:255`, `ChatPage.tsx:1148`, các scroller trong `DebugPanel.tsx`, transcript list ở `HubPanel.tsx`. Verify:

```sh
grep -rn 'overflow-y-auto' apps/web/src --include='*.tsx' | grep -vc 'scroll-area'
```

Expected: `0` (mọi scroller đều có `scroll-area`).

- [ ] **Step 3: Số đo shell**

- `OpsBar`: `px-3 py-1.5` → `h-10 px-3` (40px, khớp app 34–40).
- `ChatPage` tool panel header: như trên.
- `SessionSidebar` row: `px-2 py-1.5 text-body` → `h-7 rounded-md px-2 text-body`; group header dùng `SectionLabel` (Task 6) thay `text-[10px] font-semibold uppercase tracking-widest`.
- `SessionFooter`: `text-meta` + `hairline-t`.

- [ ] **Step 4: Probe shell**

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const header = document.querySelector('header, [class*=hairline-b]');
  const row = document.querySelector('a[href^="/s/"]');
  const tab = document.querySelector('.tab, [class*=tab-]');
  return { header: getComputedStyle(header).height, row: getComputedStyle(row).height, rowR: getComputedStyle(row).borderTopLeftRadius, tab: tab ? getComputedStyle(tab).fontWeight : null };
}));
```

Expected: `header: "40px"`, `row: "28px"`, `rowR: "6px"`, tab weight `"440"`.

- [ ] **Step 5: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(web): oc-2 shell metrics, tab strip recipe, custom scrollbars"
```

---

### Task 8: Guard tương phản + docs

**Files:**
- Create: `scripts/contrast.ts`, `scripts/contrast.test.ts`
- Modify: `package.json` (script `guard:tokens`), `docs/design-system.md` (bảng recipe + ramp), `docs/superpowers/specs/2026-09-21-grove-ui-parity-design.md` (đánh dấu deviation đã chốt)

**Interfaces:**
- Consumes: `packages/ui/src/styles/vars.css` (đọc bằng regex, không import CSS).
- Produces: `readTokens(cssText): { light: Record<string,string>, dark: Record<string,string> }`, `contrastRatio(a, b): number`, `checkTokens(tokens): Finding[]` với `Finding = { pair: string; ratio: number; min: number; ok: boolean }`.

- [ ] **Step 1: Viết test trước (RED)**

`scripts/contrast.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { checkTokens, contrastRatio, EXEMPT, readTokens } from './contrast';

const css = `
:root { --background: 0 0% 100%; --foreground: 0 0% 9%; }
.dark { --background: 0 0% 9%; --foreground: 0 0% 98%; }
`;

describe('token guard', () => {
  test('parses both theme blocks', () => {
    const t = readTokens(css);
    expect(t.light.background).toBe('0 0% 100%');
    expect(t.dark.foreground).toBe('0 0% 98%');
  });

  test('flags a pair below its floor', () => {
    const findings = checkTokens({ light: { background: '0 0% 100%', foreground: '0 0% 60%' }, dark: {} });
    expect(findings.find((f) => f.pair === 'foreground/background')?.ok).toBe(false);
  });

  test('contrastRatio matches the WCAG reference values', () => {
    expect(contrastRatio('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 0);
    expect(contrastRatio('0 0% 100%', '0 0% 100%')).toBeCloseTo(1, 1);
  });

  test('the real token file passes every non-exempt pair', () => {
    const tokens = readTokens(readFileSync('packages/ui/src/styles/vars.css', 'utf8'));
    const findings = checkTokens(tokens);
    const failures = findings.filter((f) => !f.ok).map((f) => f.pair);
    expect(failures.filter((p) => !EXEMPT.includes(p))).toEqual([]);
  });

  test('exemptions stay exactly the three documented upstream values', () => {
    expect([...EXEMPT].sort()).toEqual([
      'diff-del/background',
      'success/background',
      'success-bg/success',
    ]);
  });
});
```

- [ ] **Step 2: Chạy test cho đỏ**

Run: `bun test scripts/contrast.test.ts`
Expected: FAIL — `Cannot find module './contrast'`.

- [ ] **Step 3: Viết `scripts/contrast.ts`**

```ts
export type Tokens = { light: Record<string, string>; dark: Record<string, string> };
export type Finding = { pair: string; ratio: number; min: number; ok: boolean };

const PAIRS: { pair: string; fg: string; bg: string; min: number }[] = [
  { pair: 'foreground/background', fg: 'foreground', bg: 'background', min: 4.5 },
  { pair: 'muted-foreground/background', fg: 'muted-foreground', bg: 'background', min: 4.5 },
  { pair: 'muted-foreground/card', fg: 'muted-foreground', bg: 'card', min: 4.5 },
  { pair: 'primary-foreground/primary', fg: 'primary-foreground', bg: 'primary', min: 4.5 },
  { pair: 'link/background', fg: 'link', bg: 'background', min: 4.5 },
  { pair: 'warning-strong/background', fg: 'warning-strong', bg: 'background', min: 4.5 },
  { pair: 'ring/background', fg: 'ring', bg: 'background', min: 3 },
  { pair: 'success/background', fg: 'success', bg: 'background', min: 4.5 },
  { pair: 'success-bg/success', fg: 'success', bg: 'success-bg', min: 4.5 },
  { pair: 'diff-del/background', fg: 'diff-del', bg: 'background', min: 4.5 },
];

/** Ba cặp dưới 4.5:1 vì giữ nguyên giá trị của app (chỉ dùng trên nền tint của chính nó). */
export const EXEMPT: string[] = ['success/background', 'success-bg/success', 'diff-del/background'];

export function readTokens(cssText: string): Tokens { /* regex 2 block :root / .dark, mỗi dòng --name: H S% L%; */ }
export function contrastRatio(a: string, b: string): number { /* HSL -> sRGB -> WCAG */ }
export function checkTokens(tokens: Tokens): Finding[] { /* map PAIRS (mode lặp) -> Finding[] */ }
```

- [ ] **Step 4: Chạy test cho xanh**

Run: `bun test scripts/contrast.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Gắn vào gate**

`package.json`:

```json
"guard:tokens": "bun scripts/contrast.ts"
```

`scripts/contrast.ts` thêm entrypoint: đọc `packages/ui/src/styles/vars.css`, in bảng, `process.exit(findings.some((f) => !f.ok) ? 1 : 0)`; thêm dòng `$ bun run guard:tokens` vào `scripts/check.ts` sau bước test.

- [ ] **Step 6: Docs**

`docs/design-system.md`: thêm mục "Recipe (oc-2)" — bảng height/padding/radius/type/surface cho button/icon-button/tag/input/textarea/tab/dialog/row/scrollbar (copy từ spec §Recipe đích), mục "Ramp" (`text-meta/small/body/title/hero`, `font-regular/strong`), mục "Elevation" (`--elevation-*` + `shadow-*`), cập nhật "Grove App Decisions" (tag 16px/radius 2; CTA giữ layer-03; ring 2px).

- [ ] **Step 7: Gate + commit**

```sh
bun run format && bun run check && bun run guard:tokens
git add -A
git commit -m "test(tokens): contrast guard for the oc-2 token pairs, plus recipe docs"
```

---

## Self-Review

**Spec coverage:** type ramp + font → Task 1; utility hoá màu → Task 2; hairline/elevation → Task 3; button/icon-button/tag/input/textarea/segmented → Task 4 (segmented: dùng `Button variant="outline"` cho tới khi có nhu cầu thật, ghi trong commit); dialog/tooltip/menu/command palette → Task 5 (tooltip + menu gộp vào `Popover` của Task 5); panel/state/row → Task 6; tab/titlebar/scrollbar/shell → Task 7; guard + docs → Task 8. Ngoài scope theo spec: 40+ theme của app, layout lớn, god-file split.

**Placeholder scan:** không có TBD/TODO; mọi step có code hoặc lệnh kèm Expected. Hai chỗ cần đọc số tại chỗ khi thực thi: số nút icon rời (Task 4 Step 3) và danh sách `overflow-y-auto` (Task 7 Step 2) — cả hai đều có lệnh đếm kèm Expected dạng "liệt kê ra".

**Type consistency:** `readTokens/contrastRatio/checkTokens` định nghĩa ở Task 8 Step 3 và dùng đúng tên ở Step 1/4/5; `Dialog/DialogHeader/DialogBody/DialogFooter/Popover` (Task 5) là tên duy nhất; `Panel/PaneHeader/SectionLabel/ErrorState/EmptyState/StatusDot` (Task 6) và `IconButton/Textarea/Tag` (Task 4) không trùng tên; utility `hairline*` (Task 3) được Task 4–6 tiêu thụ đúng tên.

**Review Focus:** 1 → Task 1 Step 6; 2 → Task 1 Step 6 + Task 3 Step 4; 3 → Task 2 Step 4; 4 → Task 3 Step 5; 5 → Task 4 Step 5.

---

## Thực thi (2026-09-21, inline)

Chạy inline trong session này, **trên `main`**, không tách worktree — theo đúng convention đã dùng suốt session (plan `2026-09-21-hardening-and-gates` ghi: user chỉ định commit trực tiếp). Ledger nằm trong file này (harness không có `scripts/sdd-workspace`/`task-start` của skill).

**Pre-flight scan (giao diện giữa các task):**

| Cặp | Produces vs Consumes | Kết quả |
|---|---|---|
| 1 → 2 | ramp/radius/shadow/`@theme inline` vs map màu trong cùng block | khớp — Task 2 nối tiếp cùng file |
| 2 → 4 | `@theme` map `--color-*-bg` vs `Tag` dùng `bg-success-bg/…` | **thiếu** `--destructive-bg/-border`, `--info-bg/-border` → đã bổ sung vào Task 2 Step 2 (giá trị HSL tính sẵn) |
| 3 → 4,5,6 | `hairline*`/`scrim`/`shadow-*` vs kit dùng | khớp |
| 3 → 4 | `outline-ring` vs Button viết `focus-visible:outline-2 … outline-ring` | **lệch**: 13 dòng `focus-visible:ring-1 ring-ring` cũ không có task nào chuyển → gộp vào Task 3 (Ruling 2) |
| 5 → web | `Dialog` trong `packages/ui` cần `useEscapeToClose` đang ở `apps/web/src/lib` | **vi phạm biên monorepo** → Ruling 1 |
| 7 → 2,3 | `tab`/`tab-strip`/`scroll-area` vs class cũ | khớp (thay thế) |
| 8 → tất cả | guard đọc `vars.css` | khớp |

- **Ruling 1 (Task 5):** chuyển `useEscapeToClose` vào `packages/ui/src/hooks/use-escape-close.ts` và re-export; `apps/web` import từ `@grove/ui`. Lý do: `packages/ui` không được import `apps/web` (rule monorepo). Cost nếu sai: một lần move file + 6 import.
- **Ruling 2 (Task 3):** gộp việc đổi 13 dòng `focus-visible:ring-1 focus-visible:ring-ring` → `focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring` vào Task 3 (recipe focus của app), để Task 4–6 khỏi phải sửa lại. Cost nếu sai: 13 chỗ phải sửa ở task khác.
- **Ruling 3 (TDD cho công việc CSS):** jsdom không áp stylesheet nên không thể assert computed style trong unit test; thay bằng (a) test hợp đồng CSS (parse `globals.css`/`vars.css`: mọi `--color-x: hsl(var(--y))` phải có `y` ở **cả** `:root` và `.dark`; ramp/elevation phải tồn tại), viết trước và chạy đỏ; và (b) **probe computed style trong app thật** chạy TRƯỚC khi sửa (ghi giá trị đỏ) rồi SAU khi sửa (ghi giá trị xanh) cho mọi task có thay đổi hình. Cost nếu sai: verification yếu hơn unit test ở phần hình, bù bằng probe + ảnh chụp.
- **Ruling 4 (Task 2):** Task 2 là migration cơ học không thêm hành vi; test của nó là invariant "không còn `hsl(var(--` trong source component" (đỏ trước, xanh sau) + probe theme đổi theo mode.
