# AI-GUI Design System

> Single source of truth cho mọi quyết định visual/UX. Implement ở `packages/ui` (+ preset ở `packages/config`); `apps/web` chỉ consume, không phát minh component mới khi `packages/ui` đã có. Font + màu + spacing dưới đây là binding.

## 1. Nguyên tắc

- **Dev-tool density:** gọn như IDE (12–14px body), ưu tiên mật độ thông tin hơn whitespace marketing.
- **Streaming-first:** mọi surface chịu được partial state (text đang đổ, tool đang chạy) — skeleton/shimmer, không layout-shift.
- **Keyboard-driven:** mọi action chính có shortcut; modal nào cũng `Esc` đóng, `Enter` confirm.
- **Themeable từ gốc:** không màu cứng trong component — tất cả qua CSS vars; dark là default.
- **shadcn-native:** dùng Radix behavior sẵn (focus trap, aria, portal); custom chỉ ở lớp domain (transcript, tool-card…).

## 2. Theme

- Mode: **dark default**, light đủ dùng. Chuyển mode = đổi class trên `<html>`, repaint CSS vars (không remount cây).
- Vars (shadcn chuẩn, định nghĩa ở `packages/ui/src/styles/`): `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius`.
- Map token OMP → var (backend `theme.*` resolve xong, FE chỉ nhận vars):
  - message/user/assistant/system → `card` + `accent` variants, không chế màu riêng mỗi role ngoài 3 var này.
  - diff add/del → vars riêng `--diff-add`, `--diff-del` (kèm `colorBlindMode`: chuyển sang pattern/gạch chân, không chỉ đổi hue).
  - thinking/streaming → `--muted-foreground` + pulse animation (tắt khi `prefers-reduced-motion`).
- Quy tắc: CẤM hex/hsl trực tiếp trong `features/*`; cần màu mới → thêm var + ghi vào mục này.

## 3. Typography

- Font: system stack (không thêm webfont dep ở P0): `-apple-system, BlinkMacSystemFont, 'SF Pro', Inter, Segoe UI, sans-serif`; mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` cho code/hashline/terminal.
- Scale: body 13px, small 12px, h-section 13px semibold, h-panel 12px uppercase tracking-wide muted, code 12px mono. Line-height 1.5 (body), 1.6 (transcript).
- Transcript markdown dùng `react-markdown` + `remark-gfm`; heading trong message render tối đa cỡ body semibold (không để heading phá layout).

## 4. Spacing & radius

- Base 4px. Panel padding 12–16px; card gap 8px; dense table row 28–32px.
- Radius: `--radius: 0.5rem`; sm 4px (badge/input), md 8px (card), lg 12px (modal). Không radius tròn decor ngoài avatar/badge.

## 5. Components

Base shadcn trong `packages/ui` (vendor, re-export) — dùng trước khi build mới:

- `Button` (variants qua `cva`), `Input`, `Select`, `Switch`, `Slider`, `Badge`, `Card`, `Tabs`, `Dialog`, `DropdownMenu`, `Tooltip`, `Popover`, `Toast/Sonner`, `Accordion`/`Collapsible`, `ScrollArea`, `ResizablePanel`, `Table`, `Avatar`, `Skeleton`, `Command` (palette).
- Icons: `lucide-react` duy nhất, size 14–16px inline, 18px panel header.

Custom domain (build trên base, sống ở `packages/ui` nếu ≥2 features dùng, else trong feature):

- `TranscriptList` (virtualized `@tanstack/react-virtual`, append-only) + `Message` (role variants) + `StreamingText` (throttleniosk render, `aria-live` polite throttled).
- `ToolCard` 3-tier theo OMP: full renderer (3+ rows) / folded card (2 rows) / label+pulse (1 row) / hidden (0). Props: `expanded`, `isPartial`, `spinnerFrame`.
- `Composer` (prompt box + queue-mode + interrupt toggles + abort) + `AskDialog` (modal form: header/preview/note/chat-redirect) + `ApprovalPrompt` (allow/deny + pattern hint).
- `SessionSwitcher` (search, scope folder/all, status badge, delete-confirm, pins) + `SessionTabs` + `BranchTree` (active-path highlight, filters, label edit).
- `RosterTable` (flat/tree toggle, status/cost/tokens/model/age/cwd) + `InspectorDrawer` (responsive: side-by-side → tab) + `InboxBadge`.
- `TerminalPane` (xterm + truncation bar) + `Viewer` (hashline gutter + elided-footer + raw/tree/grid modes) + `ConflictResolver` (ours/theirs/base/both + bulk) + `EvalCell` (py|js + kernel badge) + `ArtifactBrowser` (pager + guards) + `TruncationBar` (head/tail/column indicator + artifact link).
- `EmptyState` (mỗi panel trống đều có: icon + 1 dòng + CTA) — không để panel trắng.

## 6. Patterns (copy-paste theo)

- **App shell:** sidebar trái (sessions) | main (transcript + composer) | drawer phải (inspector) | panel dưới (terminal, resizable, collapsible). Narrow (<1024px): drawer thành tab, sidebar thành overlay.
- **Streaming:** partial render inline + pulse; settled mới commit layout (tránh shift); abort luôn visible khi streaming; `agent_end.isTerminal=false` → giữ composer disabled + hint.
- **Optimistic có khóa:** fork/switch/branch lock UI + rollback khi fail (theo gateway guards); drop/share/export có confirm + warning (drop không đảm bảo xóa; dump sidecar có thể chứa secret).
- **Destructive:** confirm modal + gõ tên khi xóa session; kill subagent (`x`) confirm riêng.
- **Forms (MCP/settings):** `react-hook-form` + `zod` theo `protocol` schemas; credential fields masked, single-get unmasked; array-replace warning ở settings (disabledProviders…).
- **Command palette (`Cmd+K`):** commands từ `available_commands_update` + session ops + navigation; fuzzy, `Enter` chạy, hiện shortcut.

## 7. States

- Mỗi panel bao đủ: `loading` (skeleton) / `empty` (EmptyState + CTA) / `error` (typed error + retry) / `stale` (snapshot TAG cũ → warning + refetch) / `offline` (WS reconnect badge + queue input).
- WS reconnect: exponential backoff + badge trạng thái; input queue giữ lại khi mất kết nối, flush khi nối lại.
- Không toast cho streaming update; toast chỉ cho kết quả hành động (success/fail) và 1 slot cho `notify/setStatus`.

## 8. A11y & motion

- Radix lo focus-trap/aria cho modal; tự lo: `focus-visible` ring (`--ring`), contrast AA cho text/muted, hit-target ≥28px dense mode.
- `Esc` đóng lớp trên cùng (inspector → modal → palette); focus trả về đúng chỗ cũ.
- Motion tối thiểu; tôn trọng `prefers-reduced-motion` (tắt pulse/shimmer). Spinner dùng CSS, không GIF.

## 9. Cấu trúc implement

```text
packages/ui/src/
  components/       # shadcn vendor + custom domain dùng chung
  styles/           # CSS vars (dark/light), globals, keyframes (pulse/shimmer)
  utils.ts          # cn() = clsx + tailwind-merge
packages/config/    # tailwind preset (content: apps + packages/ui), biome config
apps/web/src/styles/globals.css  # import preset + vars, không định nghĩa token mới
```

- Thêm component dùng chung → vào `packages/ui` + export từ index. Thêm token → vars + ghi §2. Không làm ngược.
