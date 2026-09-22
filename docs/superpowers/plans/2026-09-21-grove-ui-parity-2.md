# Grove UI Adoption Implementation Plan (parity part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Áp ramp chữ + component kit vào toàn `apps/web`, và làm nốt 5 recipe còn thiếu của OpenCode Desktop (`menu-v2`, `field-v2`, `segmented-control-v2`, `keybind-v2`, `tooltip-v2`) cùng chip agent và màu danh tính.

**Architecture:** Phần 1 đã dựng token (`@theme inline`) + kit (`packages/ui/src/components/*`) nhưng app còn 354 cỡ chữ ad-hoc và 7 component kit chưa được import ở đâu. Plan này đi theo 3 lớp: (a) ramp — thay cơ học theo bảng map, gác bằng test invariant; (b) adoption — thêm prop cần thiết cho kit (`PaneHeader.variant`, `Panel.tone`, `SectionLabel`/`EmptyState` nhận `className`) rồi migrate theo từng nhóm pane; (c) recipe mới — mỗi recipe 1 component trong kit + migrate call site. Mỗi task ship độc lập, kết thúc bằng probe computed-style trong app thật.

**Tech Stack:** Bun ≥1.3.14, TypeScript strict, React 19, Tailwind v4 (`@theme inline`, `@utility`), class-variance-authority, Biome, `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-21-grove-ui-adoption-design.md` (bảng hiện trạng + bảng map bắt buộc). Recipe số đo gốc: `docs/superpowers/specs/2026-09-21-grove-ui-parity-design.md` §Recipe đích.

## Global Constraints

- Bảng map trong spec là **bắt buộc** — không tự chọn cỡ khác. Ngoại lệ duy nhất: `text-[0.9em]` cho `<code>` inline, `text-hero` chỉ ở landing.
- Không đổi token màu / không đổi tên token; `packages/ui` **không** được import từ `apps/web` ngược lại.
- Class Tailwind chỉ được sinh nếu có trong file được Tailwind quét — `apps/web/src/styles/globals.css` đã có `@source` cho `packages/ui`; thêm package mới phải thêm `@source`.
- Sau mỗi task: `bun run format` + `bun run check` (đã gồm `guard:tokens`) phải xanh, rồi commit một lần.
- `apps/web/src/lib/ui-invariants.test.ts` giữ các invariant source-text; mọi đổi tên class phải cập nhật test trong cùng task.
- Probe: dùng tab `browser` đã mở (`http://localhost:5173`), ghi rõ giá trị mong đợi; mỗi nhóm pane đổi hình phải có ảnh chụp light + dark.
- Font binary thêm vào `apps/web/public/fonts/` tự động vào bundle web + desktop (`scripts/build-desktop.ts` copy `apps/web/dist`) — không cần sửa packaging.

## Review Focus

1. **Chữ trong ngữ cảnh `font-mono`** (132 chỗ) — map cỡ mà quên family sẽ làm code/meta đổi mặt chữ. Kiểm: probe `fontFamily` của một dòng tool/mono sau T1, phải còn `ui-monospace`.
2. **`text-[10px]` → 11px** làm 15 file dày hơn 1px; bảng/rail hẹp có thể tràn. Kiểm: ảnh chụp `SessionSidebar`, `SupervisedProcessesSection`, `SessionStatsPanel` trước/sau.
3. **`PaneHeader` ép `h-10`** lên 46 hàng trong đó nhiều hàng là section ~28px → nếu quên `variant="section"` thì pane dài ra và mất mật độ. Kiểm: chiều cao header trước/sau ở `DebugPanel` (7 hàng).
4. **`Panel` có `bg-card`** trong khi 40 chỗ là nền khác (`bg-background`, `bg-popover`) → sai tone là panel chìm/mất tương phản. Kiểm: computed background của panel trong `LspPanel`/`HubPanel`.
5. **Tooltip primitive** — nếu bỏ `title` mà không thêm `aria-describedby` thì mất cả tooltip native lẫn a11y. Kiểm: element có `title` gốc vẫn còn `title` hoặc có `aria-describedby`.

---

### Task 1: Ramp chữ toàn app

**Files:**
- Modify: mọi `.tsx` trong `apps/web/src/{features,app,lib}` (100 file có cỡ ad-hoc)
- Modify: `apps/web/src/app/router.tsx` (landing: `text-2xl`/`text-4xl`/`font-bold`/`tracking-tight` → `text-hero font-strong`)
- Test: `apps/web/src/lib/ui-invariants.test.ts` (thay invariant recipe cũ bằng invariant ramp)

**Interfaces:**
- Consumes: ramp trong `@theme inline` (`text-meta|small|body|title|hero`, `font-regular|strong`).
- Produces: toàn app dùng ramp; không còn cỡ ad-hoc để task sau tham chiếu.

- [ ] **Step 1: Viết invariant trước (RED)**

Trong `apps/web/src/lib/ui-invariants.test.ts`, thay test `no feature re-declares the error box or the section label recipe` bằng:

```ts
  test('every type size and weight comes from the ramp', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /\btext-(xs|sm|base|lg|2xl|4xl)\b|text-\[1[0-9]px\]|text-\[0\.[0-9]+em\]|\bfont-(semibold|medium|bold)\b|tracking-(wide|widest|tight)/.test(
            line,
          ) && !/text-\[0\.9em\]/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — danh sách dài (≈354 dòng).

- [ ] **Step 3: Migrate theo bảng map (giữ nguyên family mono)**

```sh
FILES=$(git ls-files 'apps/web/src/**/*.tsx' | grep -v 'lib/ui-invariants.test.ts')
# cỡ
echo "$FILES" | xargs perl -pi -e 's/\btext-\[13px\]/text-body/g'
echo "$FILES" | xargs perl -pi -e 's/\btext-\[12px\]/text-small/g'
echo "$FILES" | xargs perl -pi -e 's/\btext-\[11px\]/text-meta/g'
echo "$FILES" | xargs perl -pi -e 's/\btext-\[10px\]/text-meta/g'
echo "$FILES" | xargs perl -pi -e 's/\btext-sm\b/text-body/g'
# weight + tracking
echo "$FILES" | xargs perl -pi -e 's/\bfont-(semibold|medium|bold)\b/font-strong/g'
echo "$FILES" | xargs perl -pi -e 's/\btracking-(wide|widest|tight)\b//g'
# text-xs sau cùng, và chỉ khi KHÔNG phải nhãn uppercase (nhãn để lại cho Step 4)
echo "$FILES" | xargs perl -pi -e 's/\btext-xs\b/text-small/g'
# (không cần dọn khoảng trắng: class attribute tách theo whitespace nên `a  b` vẫn hợp lệ)
```

Landing (`router.tsx`) sửa tay:

```tsx
// trước: className="text-4xl font-semibold tracking-tight"
// sau:   className="text-hero font-strong"
// trước: className="text-2xl font-bold"
// sau:   className="text-hero font-strong"
```

- [ ] **Step 4: Nhãn uppercase về `text-meta`**

```sh
echo "$FILES" | xargs perl -pi -e 's/\btext-small\b(?=[^"\n]*uppercase)/text-meta/g'
```

Kiểm: `grep -rn 'text-small.*uppercase\|uppercase.*text-small' apps/web/src --include='*.tsx' | wc -l` → `0`.

- [ ] **Step 5: Chạy test cho xanh**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: PASS (11 test).

- [ ] **Step 6: Probe cỡ chữ + family mono trong app**

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const pick = (sel) => document.querySelector(sel);
  const mono = [...document.querySelectorAll('[class*="font-mono"]')][0];
  const body = pick('[class*="text-body"]');
  return {
    bodySize: body ? getComputedStyle(body).fontSize : null,
    monoFamily: mono ? getComputedStyle(mono).fontFamily.slice(0, 30) : null,
    monoSize: mono ? getComputedStyle(mono).fontSize : null,
  };
}));
```

Expected: `bodySize: "13px"`; `monoFamily` bắt đầu bằng `ui-monospace`; `monoSize` thuộc {11px, 12px, 13px}.

- [ ] **Step 7: Ảnh chụp 3 pane dày nhất (Review Focus 2)**

Chụp `SessionSidebar` + `SupervisedProcessesSection` (Terminal pane) + `SessionStatsPanel` ở light; ghi vào commit message: có tràn/ lệch hàng không.

- [ ] **Step 8: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): every type size and weight comes from the oc-2 ramp"
```

---

### Task 2: `Input` 28px + áp `Textarea`

**Files:**
- Modify: `packages/ui/src/components/input.tsx`, `packages/ui/src/components/textarea.tsx`
- Modify: `apps/web/src/features/hub/HubPanel.tsx:32-33,187`, `apps/web/src/features/hub/SpawnWizard.tsx:11-12,91,98,106`, các `<textarea>` còn lại (tổng 11)
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Produces: `Input` cao 28px, `text-body`, hairline; `Textarea` (đã có) được dùng ở mọi chỗ.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('textareas and the input follow the kit recipe', () => {
    // The composer's auto-growing textarea stays hand-written (no chrome, grows with content).
    const raw = appSources()
      .filter((rel) => rel !== 'features/chat/Composer.tsx')
      .flatMap((rel) =>
        readFileSync(resolve(WEB_SRC, rel), 'utf8')
          .split('\n')
          .flatMap((line, i) => (/\bresize-none\b/.test(line) ? [`${rel}:${i + 1}`] : [])),
      );
    expect(raw).toEqual([]);
    const input = readFileSync(resolve(UI_SRC, 'components/input.tsx'), 'utf8');
    expect(input).toContain('h-7');
    expect(input).toContain('text-body');
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — 11 dòng `resize-none`; `input.tsx` còn `h-8`/`text-[13px]`.

- [ ] **Step 3: `Input` theo app**

`packages/ui/src/components/input.tsx` — đổi className thành:

```tsx
'flex h-7 w-full rounded-md bg-background px-2 text-body text-foreground hairline placeholder:text-muted-foreground outline-none hover:hairline-strong focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50'
```

- [ ] **Step 4: Thay 11 `<textarea>` bằng kit**

`HubPanel.tsx`: xoá `steerBoxClassName` (`:32-33`), thay `<textarea className={steerBoxClassName} …>` (`:187`) bằng `<Textarea …>`; thêm `Textarea` vào import `@grove/ui`.
`SpawnWizard.tsx`: xoá `textareaClassName` (`:11-12`), 3 chỗ dùng (`:91,98,106`) → `<Textarea …>`.
Các file còn lại: `grep -rn '<textarea' apps/web/src --include='*.tsx'` → thay từng chỗ, giữ nguyên props (`value`/`onChange`/`placeholder`/`rows`), chuyển class kích thước đặc thù qua `className`.

- [ ] **Step 5: Test xanh**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: PASS (12 test).

- [ ] **Step 6: Probe**

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const input = document.querySelector('input[type="text"], input:not([type])');
  const ta = document.querySelector('textarea');
  return {
    inputHeight: input ? getComputedStyle(input).height : null,
    inputSize: input ? getComputedStyle(input).fontSize : null,
    textareaRadius: ta ? getComputedStyle(ta).borderTopLeftRadius : null,
    textareaMinHeight: ta ? getComputedStyle(ta).minHeight : null,
  };
}));
```

Expected: `inputHeight: "28px"`, `inputSize: "13px"`, `textareaRadius: "6px"`, `textareaMinHeight: "80px"`.

- [ ] **Step 7: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(ui): input at oc-2 metrics and Textarea adopted everywhere"
```

---

### Task 3: Áp `IconButton` (39 nút chỉ-icon)

**Files:**
- Modify: `apps/web/src/features/chat/ChatPage.tsx:1078,1170` (rail + header), `apps/web/src/features/sessions/SessionSidebar.tsx` (nút nhóm/hover), `apps/web/src/features/chat/Message.tsx` (actions), `apps/web/src/features/chat/CodeBlock.tsx` (copy), và các nút chỉ-icon khác trong 39 chỗ
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Consumes: `IconButton({ label, variant?, size? })` từ kit (đã export).
- Produces: mọi nút chỉ-icon dùng kit; rail tool dùng `size="default"` (24px) trừ khi cần `sm`.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('hand-written buttons are down to the documented few', () => {
    // Count-based on purpose: multiline JSX defeats a line regex. The number is
    // whatever remains after migration (menus, rows, segmented items, form
    // submits) and is pinned here so new raw <button>s cannot slip in unnoticed.
    const count = appSources().reduce((n, rel) => {
      const text = readFileSync(resolve(WEB_SRC, rel), 'utf8');
      return n + (text.match(/<button\b/g)?.length ?? 0);
    }, 0);
    expect(count).toBeLessThanOrEqual(24);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — danh sách 39 chỗ.

- [ ] **Step 3: Migrate theo nhóm**

```sh
grep -rn '<button' apps/web/src --include='*.tsx' | grep -c 'aria-label'
```

Thay từng chỗ: `<button type="button" aria-label="X" className="…">` + icon → `<IconButton label="X" …>`; bỏ `type="button"` (kit tự set), bỏ class padding/size cũ, giữ `onClick`/`disabled`. Với nút trong rail (`ChatPage.tsx:1170`): dùng `<IconButton label={tab.label} size="default" variant={toolTab === tab.id ? 'plain' : 'ghost'} />`.

- [ ] **Step 4: Test xanh + probe**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (13 test).

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const btns = [...document.querySelectorAll('button[aria-label]')].slice(0, 5);
  return btns.map((b) => ({ label: b.getAttribute('aria-label'), size: getComputedStyle(b).height, radius: getComputedStyle(b).borderTopLeftRadius }));
}));
```

Expected: mỗi nút cao `24px` (hoặc `20px`/`28px` nếu `sm`/`lg`), radius `6px`, `aria-label` giữ nguyên.

- [ ] **Step 5: Ảnh chụp header + rail**

Chụp màn chat: rail phải 48px, nút 24px, không lệch tâm.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): icon-only buttons come from the kit"
```

---

### Task 4: `Panel` + `PaneHeader` + `SectionLabel`

**Files:**
- Modify: `packages/ui/src/components/chrome.tsx` (thêm `Panel.tone`, `PaneHeader.variant`)
- Modify: `apps/web/src/features/debug/DebugPanel.tsx` (7 panel + 7 header), `apps/web/src/features/lsp/LspPanel.tsx` (6 + 4), `apps/web/src/features/hub/HubPanel.tsx` (4 + 4 nhãn), và các pane còn lại (tổng 69 panel / 46 header / 33 nhãn)
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Produces: `Panel({ tone?: 'card' | 'plain' | 'inset' })`, `PaneHeader({ variant?: 'shell' | 'section' })`; `SectionLabel` nhận `className` để giữ padding đặc thù.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('pane chrome comes from the kit', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /rounded-md (bg-card )?hairline\b/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders.length).toBeLessThanOrEqual(10);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — ≈102 dòng.

- [ ] **Step 3: Thêm prop cho kit**

`packages/ui/src/components/chrome.tsx`:

```tsx
const panelTones = {
  card: 'bg-card hairline',
  plain: 'hairline',
  inset: 'bg-background hairline',
} as const;

export function Panel({ tone = 'card', className, ...props }: React.HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof panelTones }) {
  return <div className={cn('rounded-md', panelTones[tone], className)} {...props} />;
}

export function PaneHeader({ variant = 'shell', … }) {
  return (
    <header className={cn(
      'flex shrink-0 items-center gap-2 px-3 hairline-b',
      variant === 'shell' ? 'h-10 text-body' : 'h-7 text-meta font-strong uppercase text-muted-foreground',
      className,
    )} …>
```

- [ ] **Step 4: Migrate theo pane, mỗi pane một lần chụp**

Thứ tự (nhiều → ít): `DebugPanel`, `LspPanel`, `HubPanel`, `TodoPanel`, `NotebookPane`, `TreePanel`, `ExplorerPane`, `KnowledgePane`, `McpPane`, `ProvidersPane`, `SettingsPane`, `TerminalPane` + các section còn lại.

```sh
grep -rn 'rounded-md bg-card hairline\|rounded-md hairline\|uppercase text-muted-foreground' apps/web/src --include='*.tsx' | wc -l
```

Sau mỗi file: `bun run check` nhanh (chỉ typecheck) rồi chụp pane đó ở light.

- [ ] **Step 5: Test xanh + probe tone**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (14 test).

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const panels = [...document.querySelectorAll('[class*="rounded-md"]')].filter((e) => e.className.includes('hairline')).slice(0, 4);
  return panels.map((p) => getComputedStyle(p).backgroundColor);
}));
```

Expected: mỗi panel có nền `rgb(250,250,250)` (card, light) hoặc `rgb(255,255,255)` (inset) — không panel nào trong suốt.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): pane chrome (panel, header, section label) comes from the kit"
```

---

### Task 5: `StatusDot` + `EmptyState`

**Files:**
- Modify: `apps/web/src/features/sessions/SessionSidebar.tsx` (dot + ping ring), `apps/web/src/features/providers/ProvidersPane.tsx:7-17`, `apps/web/src/features/chat/ChatPage.tsx:860,876`, `apps/web/src/features/chat/Transcript.tsx:124-130`, `apps/web/src/features/sessions/GoalStrip.tsx`, `apps/web/src/features/sessions/SessionStatsPanel.tsx`
- Modify: 34 khối rỗng → `EmptyState`
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Consumes: `StatusDot({ tone, size? })`, `EmptyState({ message, action? })`.
- Produces: dot/ping giữ animation ở call site (`className="animate-ping"` truyền vào `StatusDot`).

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('status dots and empty panes come from the kit', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /rounded-full (bg-(success|warning|destructive|muted-foreground|info))/.test(line) ||
          /text-center text-muted-foreground/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — 6 dot + 34 khối rỗng.

- [ ] **Step 3: Migrate dot**

Mỗi dot: `<span className="size-2 rounded-full bg-success" />` → `<StatusDot tone="success" />`; dot 1.5px → `size="sm"`; ping ring (`SessionSidebar.tsx:76`) → giữ `<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />` **hoặc** `StatusDot` + `className="animate-ping"` (chọn cách sau).

- [ ] **Step 4: Migrate khối rỗng**

Mỗi khối `<div className="flex flex-col items-center gap-2 p-3 text-center"><p className="text-small text-muted-foreground">No X.</p></div>` → `<EmptyState message="No X." />`; nếu có nút → truyền `action={<Button …/>}`.

- [ ] **Step 5: Test xanh + probe**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (15 test).

Probe: mở một pane rỗng (ví dụ Jobs với 0 job) → `document.querySelector('[role="alert"]')` không tồn tại, khối rỗng cao đúng, chữ 12px `--muted-foreground`.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "refactor(web): StatusDot and EmptyState replace hand-rolled dots and empty panes"
```

---

### Task 6: `menu-v2` row + palette row + `field-v2`

**Files:**
- Create: `packages/ui/src/components/menu.tsx` (`MenuSurface`, `MenuItem`), `packages/ui/src/components/field.tsx` (`Field`)
- Modify: `apps/web/src/features/sessions/OpsBar.tsx:197-198,246`, `apps/web/src/features/palette/CommandPalette.tsx:139,161-163`, `apps/web/src/features/model/ModelPicker.tsx:100,110,126,189-191,202-203`, `apps/web/src/features/settings/SettingsModal.tsx:35,225,229`, `apps/web/src/features/settings/SettingsPane.tsx`
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Produces: `MenuItem({ icon?, selected?, disabled?, children })` = 28px, `padding 0 12px`, gap 8, radius 4, `hover:bg-accent`; `PaletteRow` = 36px, `0 12px`, radius 6, title 13/530 + description 13/440 muted; `Field({ label, description, children })` = label 12/530, description 11/440 muted, gap 12, padding dọc 12px.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('menu rows and field rows come from the kit', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /rounded-md px-2 py-1\.5 text-left text-body/.test(line) || /\bmenuItemClass\b/.test(line)
            ? [`${rel}:${i + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — `OpsBar` (hằng + 10 chỗ), palette rows, ModelPicker rows.

- [ ] **Step 3: Viết `menu.tsx`**

```tsx
export function MenuItem({ icon, selected, className, children, ...props }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-sm px-3 text-left text-body text-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
        selected && 'font-strong text-link',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
```

`PaletteRow` cùng file: `flex h-9 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-accent`, title `text-body font-strong`, meta `text-body text-muted-foreground`.

- [ ] **Step 4: Viết `field.tsx`**

```tsx
export function Field({ label, description, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-3 py-3', className)}>
      <div className="flex flex-col gap-1">
        <span className="text-small font-strong text-foreground">{label}</span>
        {description ? <span className="text-meta text-muted-foreground">{description}</span> : null}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Migrate**

`OpsBar.tsx`: xoá `menuItemClass`, 10 `<button role="menuitem">` → `<MenuItem …>`.
`CommandPalette.tsx`: row → `<PaletteRow …>` (giữ `onMouseMove`, `aria-selected`).
`ModelPicker.tsx`: 4 nhóm row → `MenuItem`/`PaletteRow` theo chiều cao.
`SettingsModal.tsx`: `Row` cục bộ → `Field`; `SettingsPane.tsx`: `Editor` dùng `Field` cho label/description.

- [ ] **Step 6: Test xanh + probe**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (16 test).

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const item = document.querySelector('[role="menuitem"]');
  const s = item ? getComputedStyle(item) : null;
  return { height: s?.height, paddingLeft: s?.paddingLeft, radius: s?.borderTopLeftRadius };
}));
```

Expected: `height: "28px"`, `paddingLeft: "12px"`, `radius: "4px"`.

- [ ] **Step 7: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(ui): menu, palette row and field recipes from oc-2"
```

---

### Task 7: `segmented-control-v2` + `keybind-v2` + tooltip + chip agent + màu danh tính

**Files:**
- Create: `packages/ui/src/components/segmented.tsx`, `packages/ui/src/components/keybind.tsx`, `packages/ui/src/components/tooltip.tsx`, `packages/ui/src/components/agent-chip.tsx`
- Modify: `apps/web/src/features/sessions/ModesPanel.tsx:85-90,143-166`, `apps/web/src/features/providers/ProvidersPane.tsx:165-181`, `apps/web/src/features/hub/SpawnWizard.tsx:118-155`, `apps/web/src/app/router.tsx:128-129`, `apps/web/src/features/chat/Composer.tsx:340-341`, `apps/web/src/features/chat/SessionFooter.tsx` (10 `title=`), `apps/web/src/features/hub/HubPanel.tsx:104,168,373,375`, `apps/web/src/features/model/ProviderIcon.tsx:9-33`, `apps/web/src/features/model/providerIcons.ts:94-97`

**Interfaces:**
- Produces: `Segmented({ value, options, onChange })` (28px, radius 6, nền `layer-01`, item pressed `bg-background` + `hairline-strong`); `Keybind({ keys })` (14px cao, 11px/530 uppercase, nền `layer-03`); `Tooltip({ label, children })` (giữ `title` + `aria-describedby`, bề mặt `layer-01` + `shadow-floating`); `AgentChip({ kind })` (plan/build/explore/review/writer, mỗi kind một cặp màu); token màu danh tính `--identity-*` cho avatar.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('segmented groups, keybind hints and agent chips come from the kit', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /↵|⇧↵/.test(line) || /agent\.kind\b/.test(line) ? [`${rel}:${i + 1}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Chạy cho đỏ**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts`
Expected: FAIL — keybind hints (`router.tsx:128`, `Composer.tsx:340`) + `agent.kind` (`HubPanel.tsx:104,375`).

- [ ] **Step 3: Viết 4 component**

`segmented.tsx`:

```tsx
export function Segmented<T extends string>({ value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div role="group" className={cn('inline-flex h-7 items-center gap-0.5 rounded-md bg-muted p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-6 rounded-sm px-3 text-body transition-colors',
            value === o.value
              ? 'bg-background font-strong text-foreground hairline-strong'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

`keybind.tsx`:

```tsx
export function Keybind({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((k) => (
        <kbd
          key={k}
          className="inline-flex h-3.5 items-center rounded-[2px] bg-muted px-1 font-strong text-meta uppercase text-muted-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}
```

`tooltip.tsx`: bọc children trong `<span title={label} aria-describedby={id}>` + `role="tooltip"` element ẩn chỉ hiện khi hover/focus (`group-hover:opacity-100`), bề mặt `bg-popover shadow-floating text-meta`.

`agent-chip.tsx` + token danh tính: thêm vào `vars.css` 5 cặp `--agent-plan|build|explore|review|writer` (light/dark) lấy từ spec §Recipe (pink-800/blue-800/yellow-900/green-800/purple-700 và bản dark tương ứng) rồi map vào `@theme inline`.

- [ ] **Step 4: Migrate**

`ModesPanel.tsx`: 4 nút FLAG_MODES → `<Segmented options={…} value={…} onChange={…} />`; QueueRow 2 nút → `Segmented`.
`ProvidersPane.tsx:165-181`: filter provider → `Segmented`.
`SpawnWizard.tsx:118-155`: effort 3 mức → `Segmented`; 3 toggle → giữ `Button` nhưng `variant` theo trạng thái.
`router.tsx:128-129` + `Composer.tsx:340-341`: hint text → `<Keybind keys={['↵']} />` + chữ thường.
`HubPanel.tsx`: `agent.kind` → `<AgentChip kind={agent.kind} />`; `row.role` → `Badge variant="neutral"`.
`ProviderIcon.tsx` + `providerIcons.ts`: fallback hsl → dùng token danh tính (`--agent-*` hoặc `--info/--hint`), bỏ `fallbackHue`.
`SessionFooter.tsx`: 10 `title=` → `<Tooltip label={…}>` giữ nguyên `title` bên trong.

- [ ] **Step 5: Test xanh + probe**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (17 test).

```js
const probe = await tab.run(async ({ page }) => page.evaluate(() => {
  const group = document.querySelector('[role="group"]');
  const pressed = group?.querySelector('[aria-pressed="true"]');
  const kbd = document.querySelector('kbd');
  return {
    groupHeight: group ? getComputedStyle(group).height : null,
    pressedBg: pressed ? getComputedStyle(pressed).backgroundColor : null,
    pressedBorder: pressed ? getComputedStyle(pressed).borderTopWidth : null,
    kbdHeight: kbd ? getComputedStyle(kbd).height : null,
  };
}));
```

Expected: `groupHeight: "28px"`; `pressedBg` = nền `--background`; `pressedBorder: "1px"` (0.5px làm tròn); `kbdHeight: "14px"`.

- [ ] **Step 6: Gate + commit**

```sh
bun run format && bun run check
git add -A
git commit -m "feat(ui): segmented control, keybind, tooltip and agent chips from oc-2"
```

---

### Task 8: Dọn nốt + mono self-host + docs

**Files:**
- Modify: `apps/web/src/features/chat/Message.tsx:12`, `apps/web/src/features/hub/HubPanel.tsx:123`, `apps/web/src/styles/globals.css` (`--font-mono`), `apps/web/src/features/terminal/TerminalPane.tsx:49-56`, `apps/web/public/fonts/` (thêm JetBrains Mono), `docs/design-system.md`, `docs/tui-parity-status.md`
- Test: `apps/web/src/lib/ui-invariants.test.ts`

**Interfaces:**
- Produces: `--font-mono` = `"JetBrains Mono", ui-monospace, …`; xterm `fontFamily` = cùng stack, `fontSize: 12`.

- [ ] **Step 1: Invariant trước (RED)**

```ts
  test('no 1px border recipes survive', () => {
    const offenders = appSources().flatMap((rel) =>
      readFileSync(resolve(WEB_SRC, rel), 'utf8')
        .split('\n')
        .flatMap((line, i) => (/border border-border\b/.test(line) ? [`${rel}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
```

- [ ] **Step 2: Chạy cho đỏ** → FAIL `Message.tsx:12` (và `HubPanel.tsx:123` nếu là `border-l border-border`).

- [ ] **Step 3: Sửa 2 chỗ**

`Message.tsx:12`: `tool: 'border border-border bg-card'` → `tool: 'bg-card hairline'`.
`HubPanel.tsx:123`: `border-l border-border` → `border-l border-border` giữ 1px **hoặc** `hairline` + `border-l-0`? Chọn: thay bằng `hairline` (viền quanh) nếu panel cần viền trái đơn thì dùng `border-l-[0.5px] border-border`.

- [ ] **Step 4: Self-host mono**

```sh
curl -sL -o /tmp/jb.zip https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
unzip -l /tmp/jb.zip | grep -i 'Regular.woff2\|OFL'   # xác nhận đường dẫn thật trước khi giải nén
unzip -o -j /tmp/jb.zip 'fonts/webfonts/JetBrainsMono-Regular.woff2' 'OFL.txt' -d apps/web/public/fonts
mv apps/web/public/fonts/OFL.txt apps/web/public/fonts/JetBrainsMono-LICENSE.txt
```

`globals.css`: thêm `@font-face` cho `JetBrains Mono` (weight 400) + đổi `--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;`.
`TerminalPane.tsx`: xterm options thêm `fontFamily: 'JetBrains Mono, ui-monospace, monospace'`, giữ `fontSize: 12`.

- [ ] **Step 5: Docs**

`docs/design-system.md`: cập nhật mục Recipe (bảng adoption: component nào đã áp vào đâu), thêm `menu-v2`/`field-v2`/`segmented`/`keybind`/`tooltip`/agent chip + token `--agent-*`, ghi `--font-mono` self-host.
`docs/tui-parity-status.md`: thêm 1 dòng Changelog cho lượt theme + UI kit (evidence: commit range + `bun run check` + `guard:tokens`).

- [ ] **Step 6: Test xanh + gate**

Run: `bun test apps/web/src/lib/ui-invariants.test.ts` → PASS (18 test); `bun run check` xanh; `bun run guard:tokens` xanh.

- [ ] **Step 7: Commit**

```sh
bun run format && bun run check
git add -A
git commit -m "chore(web): last 1px borders, self-hosted mono, and docs for the kit"
```

---

## Self-Review

**Spec coverage:** ramp → Task 1; `Input` 28px + `Textarea` → Task 2; `IconButton` → Task 3; `Panel`/`PaneHeader`/`SectionLabel` → Task 4; `StatusDot`/`EmptyState` → Task 5; `menu-v2`/palette/`field-v2` → Task 6; `segmented-control-v2`/`keybind-v2`/tooltip/agent chip/màu danh tính → Task 7; 2 border 1px + mono + docs → Task 8. Ngoài scope theo spec: đổi palette, layout lớn, port 40+ theme, god-file split.

**Placeholder scan:** không có TBD/TODO. Hai chỗ cần đếm tại chỗ khi thực thi: số `<textarea>` còn lại sau Task 2 Step 4 và số panel còn lại sau Task 4 Step 4 — cả hai đều có lệnh grep + ngưỡng mong đợi.

**Type consistency:** `Panel({ tone })`, `PaneHeader({ variant })`, `MenuItem`, `PaletteRow`, `Field`, `Segmented`, `Keybind`, `Tooltip`, `AgentChip` — mỗi tên định nghĩa một lần, tiêu thụ đúng tên đó; `StatusDot({ tone, size })` và `EmptyState({ message, action })` giữ nguyên chữ ký từ phần 1; `--agent-*` là token duy nhất được thêm mới.

**Review Focus:** 1 → Task 1 Step 6; 2 → Task 1 Step 7; 3 → Task 4 Step 5; 4 → Task 4 Step 5; 5 → Task 7 Step 5.

---

## Thực thi (2026-09-21, inline)

Chạy inline trên `main` (convention cả session; plan phần 1 đã ghi lý do). Ledger nằm trong file này.

**Pre-flight scan (interface giữa các task):**

| Cặp | Produces vs Consumes | Kết quả |
|---|---|---|
| 1 → 6 | `text-[13px]` → `text-body` vs invariant T6 dò `px-2 py-1.5 text-left text-body` | khớp — T1 chạy trước |
| 2 → 5,6 | `Textarea`/`Input` chữ ký vs call site | khớp |
| 3 → 6,7 | đếm `<button>` trong `apps/web` vs menu/row/segmented chuyển vào kit | **lệch nhẹ**: ngưỡng `<= 24` trong plan là ước lượng → Ruling A (đo rồi ghim số thật) |
| 4 → 5,6,7 | `Panel({tone})`, `PaneHeader({variant})` vs call site | khớp |
| 7 → theme test | token `--agent-*` mới phải có ở **cả** `:root` và `.dark` (invariant colour map) | đã ghi trong task |
| 8 → tất cả | mono self-host, 2 border sót | khớp |

- **Ruling A (Task 3):** ngưỡng đếm `<button>` không phải hằng số tiên nghiệm — đo sau khi migrate rồi ghim đúng số còn lại (kèm ghi chú vì sao còn). Cost nếu sai: ngưỡng lỏng thì invariant yếu, chặt quá thì đỏ giả.
- **Ruling B (Task 1):** bỏ bước dọn khoảng trắng đôi trong className — class attribute tách theo whitespace nên vô hại, còn `s/  +/ /g` toàn file thì phá string JSX.
- **Ruling C (docs):** `docs/design-system.md` sẽ được **viết lại mục Recipe/adoption** theo trạng thái sau khi áp (không chỉ ghi thêm), vì user yêu cầu tài liệu khớp design đã áp dụng.

| 1 Ramp chữ | `07ccf4e` | Invariant mới: RED **363 offender** → **GREEN 10 pass**; 354 chỗ migrate trong 51 file; landing `text-4xl`→`text-hero`; probe: body 13px/−0.04px · meta 11px/+0.05px · small 12px · mono giữ `ui-monospace` 11px · heading 530; ảnh chụp màn chat không lệch. |

| 2 Input + Textarea | `739ae6e` | Invariant mới: RED (10 chỗ `resize-none` + `h-8`/`text-[13px]`) → **GREEN 11 pass**; 10 textarea → kit (xoá 2 hằng class 298 ký tự); Input 28px/`text-body`; probe: kit input 28px/13px/radius 6, textarea min-h 80px, override `h-7 w-44 font-mono text-small` giữ nguyên. **Ruling D (bug thật do probe bắt):** `tailwind-merge` coi ramp của mình là *màu chữ* nên xoá `text-body` khi đứng sau `text-foreground` → thêm `extendTailwindMerge` khai báo group `font-size`/`font-weight`; nếu không sửa thì mọi component kit (Button/Badge/Input) mất cỡ chữ và rơi về cỡ kế thừa. |

| 3 IconButton | `089070d` | Invariant mới `icon-only controls come from the kit`: RED (Button chỉ-icon tổng hợp bị báo `WorkspaceSection.tsx:125`) → **GREEN 12 pass**; 15 chỗ `<Button>` chỉ-icon → `IconButton` (giữ `aria-label`/`title`); 5 nút có icon **kèm chữ** (Copy, Budget, Add directory, submit-spinner) giữ nguyên. Probe: 24×24/radius 6, nhãn còn đủ. **Ruling E:** harness screenshot hỏng giữa chừng (timeout cả với `about:blank`, sau khi restart browser) → từ task này verification dùng probe computed-style, không có ảnh chụp. |

| 4 Panel + header + label | `8b8b2ca` | Invariant mới `panel and label recipes exist once`: **78 recipe thô → 0**; 16 panel thành `<Panel>`, phần còn lại (code surface `pre`/`code`/`details` + wrapper khác) dùng chung utility; **33 nhãn → `section-label`**; header pane → `pane-header`. Probe: 6 panel `bg-card` + viền 0.5px + radius 6; nhãn 11px uppercase. **Ruling F:** recipe panel định nghĩa **một lần trong CSS** (`panel*`) và `Panel` render đúng class đó (tránh hai quy ước); `Panel` thêm prop `as` để giữ landmark (`section/aside/nav/li`) thay vì biến thành `div`. **Ruling G:** OpsBar là toolbar wrap (`flex-wrap gap-1`) nên giữ class riêng, không ép `pane-header`. **Ruling E** (screenshot hỏng) vẫn áp dụng: verify bằng probe. |

| 5 StatusDot + EmptyState | `bbbfda4` | Invariant mới: **14 pass** (bắt đầu đỏ vì progress bar của GoalStrip khớp pattern → siết pattern theo size dot); **6 dot → `StatusDot`**, **20 khối rỗng → `EmptyState`**; kit thêm `StatusDot.label` (decorative → `role="img"`) và `style` (animation delay). Probe: dot `size-2 bg-success` rgb(24,139,66) + `aria-label="connected"`. Dọn luôn 14 file có import thừa do migration để lại. **Ruling H:** các dòng "No …" inline trong output tool (LSP/Debug) giữ nguyên dạng chữ, không bọc `EmptyState` (đổi layout vô ích). |

| 6 menu + palette + field | `91c7e63` | `MenuItem` (28px/12px/gap 8/radius 4) + `PaletteRow` (36px/radius 6) + `Field` (label 12/530 + description 11/440); OpsBar menu 12 mục + CommandPalette rows + ModelPicker rows dùng `MenuItem`, SpawnWizard dùng `Field`; probe: menuitem **28px / padding-left 12px / gap 8px / radius 4px / 13px** (khớp `menu-v2`). **Ruling I:** settings row (list dày, có nút Save + lỗi) giữ dạng row riêng — `Field` là form field dọc, dùng ở dialog/spawn. **Bug phát hiện khi làm:** migration IconButton trước đó **làm mất icon** ở 9 nút (render ra ô 24px trống) → khôi phục icon + import, thêm invariant `icon buttons keep their glyph` (RED có chứng cứ → GREEN 15 pass). |

| 7 Segmented + keybind + tooltip + agent chip | `eb54139` | 4 component mới (`Segmented`, `Keybind`, `AgentChip`, `Tooltip`) + 5 token `--agent-*` (2 mode, map vào `@theme`); ModesPanel steering → `Segmented`; hint ở Composer + landing → `Keybind`; HubPanel kind → `AgentChip` (whitelist 5 giá trị); `Tooltip` giữ `title` + `aria-describedby`. Probe: keybind **14px/11px/530/uppercase**; nhóm steering **28px**, item pressed nền `rgb(255,255,255)` + viền 0.5px + radius 4. **Ruling K:** effort (SpawnWizard) và filter provider giữ `Button` group vì là *tristate* (bấm lại để bỏ chọn) — `Segmented` cố ý không biểu diễn được trạng thái đó. **Ruling L:** `agent.kind` ngoài 5 giá trị đã biết render dạng chữ thường. |

| 8 Dọn border + mono + docs | `76582c2` | Invariant mới `no one-pixel border recipes survive`: RED (`Message.tsx:13`) → **GREEN 16 pass**; JetBrains Mono self-host (OFL) + `--font-mono` + xterm `fontFamily`; `docs/design-system.md` **viết lại** phần authoritative (token, utility, bảng adoption của kit, recipe oc-2 đo được, quyết định) và thêm 1 dòng changelog vào `docs/tui-parity-status.md`. Probe: 3 font face `loaded`, mono `"JetBrains Mono", ui-monospace` 11px. |
