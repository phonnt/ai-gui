# Repository Guidelines

> Grove = web UI có đầy đủ khả năng OMP (thin client + gateway). Decisions lock 2026-09-07: Bun, Biome, CodeMirror, Tailwind + shadcn. Source of truth kiến trúc: `docs/architecture.md`; design system: `docs/design-system.md`. File này là luật cho AI khi viết code — ngắn gọn, binding.

## Project Overview

- Purpose: web UI tương đương TUI OMP — chat streaming, sessions/tree/branch, tools (read/write/edit/bash/eval/hub/task/todo/lsp/debug/browser), Agent Hub + collab, providers/models/MCP/skills/memory/settings/theme/auth.
- Non-goals: không fork OMP, không re-implement session store / registry / credential ladder ở frontend. Browser không parse JSONL.
- AI rule: UI chỉ gọi `apps/web/src/lib/api-client` (typed theo `packages/protocol`); mọi logic OMP nằm ở `apps/server` + `packages/omp-adapter`. Không import OMP từ web.

## Architecture & Data Flow

- Monorepo Bun workspaces. Deployables ở `apps/` (web, server, future desktop); libraries ở `packages/` (core, agent-runtime, omp-adapter, protocol, ui, config).
- Core abstraction: `AgentRuntime` interface (`packages/agent-runtime`) — `apps/server` chọn adapter (`packages/omp-adapter`, fallback SDK in-process); web không biết runtime là gì. Đổi runtime → adapter mới, UI giữ nguyên.
- Data flow: UI event → feature handler → `lib/api-client` (REST/WS, zod theo `protocol`) → `apps/server` routes/stream → `AgentRuntime` adapter → `omp --mode rpc` child → typed result + WS events về UI state. Không import chéo giữa `features/*`; share qua `app/store` + `packages/ui`.
- DI ở composition root: `apps/web/src/app/` build api-client rồi inject vào features; features không tự `new` client.

## Key Directories

- `apps/web/` — thin client (Vite+React). `src/main.tsx` entry; `src/app/` (router, zustand store, query-client); `src/features/*/` (mỗi feature: `index.tsx`, `types.ts`, `*.test.tsx`); `src/lib/api-client/` (rest/stream/hooks); `src/styles/globals.css`.
- `apps/server/` — backend Bun (HTTP+WS). `src/index.ts`, `src/routes/`, `src/stream/`, `src/runtime/` (chọn adapter, owns omp child lifecycle).
- `apps/desktop/` — Tauri v2 shell (macOS arm64 + Windows x64): serves `apps/web` dist và chạy `apps/server` đã compile như sidecar; build/đóng gói ở `docs/desktop-release.md`.
- `packages/core/` — domain thuần (types + hàm thuần + guards), zero I/O, zero deps nội bộ.
- `packages/agent-runtime/` — `runtime.ts` (interface) + `errors.ts` (typed errors).
- `packages/omp-adapter/` — OMP integration duy nhất (rpc-child, sessions, tools-relay, extensions).
- `packages/protocol/` — wire contract versioned (rest/events/sse/version, zod).
- `packages/ui/` — shadcn dùng chung (components + styles + `cn`).
- `packages/config/` — tsconfig.base, Biome, tailwind preset (mọi app/pkg extend).
- `tests/` — integration (`tests/features/<name>.test.ts`); unit colocate `*.test.ts(x)`.
- `assets/brand/` — brand mark nguồn (SVG + PNG sinh ra từ `packages/ui/src/brand/mark.ts`); sinh lại bằng `bun run brand`, không sửa tay.
- `scripts/` — `dev.ts`, `check.ts`. `docs/` — `architecture.md`, `design-system.md`, `decisions/`, `runbook.md`.

## Development Commands

```sh
bun install                # cài tất cả workspaces
bun run dev                # web (vite) + server (bun) song song
bun run dev:web            # chỉ FE
bun run dev:server         # chỉ backend
bun run typecheck          # tsc --noEmit toàn repo
bun run lint               # biome check .
bun run format             # biome format --write .
bun run test               # vitest run (hoặc bun test)
bun run check              # typecheck + lint + test (cổng CI duy nhất)
```

- AI rule: mọi app/pkg mới phải khai báo workspace + extend `packages/config/tsconfig.base.json`; CI chỉ chạy `bun run check`.

## Code Conventions & Common Patterns

- Formatting: **Biome** (lock 2026-09-07), 2-space, single quotes, semicolons, `lineWidth: 100`. Chạy formatter trước khi yield; không hand-format.
- Naming: `camelCase` functions/vars, `PascalCase` types/components, `kebab-case` files/dirs, `SCREAMING_SNAKE` env/consts. Feature dirs: `apps/web/src/features/<kebab-name>/` với `index.tsx`, `types.ts`, `<name>.test.tsx`.
- Error handling: typed errors ở biên (`packages/agent-runtime/errors.ts`), không silent catch. Ví dụ:
  ```ts
  // apps/web/src/lib/api-client/rest.ts
  import type { Session } from '@grove/core';
  export type Result<T> = { ok: true; value: T } | { ok: false; error: Error };
  export async function getSession(id: string): Promise<Result<Session>> {
    try { /* fetch + zod parse theo protocol */ return { ok: true, value: data }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e : new Error(String(e)) }; }
  }
  ```
- Async: `async/await` only; không floating promise (`void` hoặc `await` bắt buộc); `Promise.all` cho I/O độc lập.
- State: local state trong feature; shared state qua zustand ở `apps/web/src/app/store.ts`; server state qua `@tanstack/react-query` hooks trong `lib/api-client/hooks.ts`. Không prop-drill quá 2 tầng, không singleton import chéo.
- Styling: Tailwind utilities + CSS vars của design system; CẤM màu cứng (hex trực tiếp trong component — dùng var). Icons: `lucide-react` duy nhất. Components mới: check `packages/ui` trước, không duplicate.
- Deps: `import type` cho types-only; `core`/`ui` standalone; `protocol`, `agent-runtime` → `core` (type-only); cấm cycle (chi tiết §4 `docs/architecture.md`).

## Important Files

- `package.json` — workspaces `apps/*`, `packages/*` (source of truth cho scripts).
- `packages/config/tsconfig.base.json` — `strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`.
- `.env.example` — env keys mẫu (không commit `.env`).
- `.omp/RULES.md` — sticky hard requirements (always-apply, giữ ngắn).
- `.omp/rules/*.md` — scoped rules (rulebook/TTSR theo globs + frontmatter).
- `packages/agent-runtime/src/runtime.ts` — `AgentRuntime` interface (hợp đồng BE/FE).
- `packages/protocol/src/version.ts` — protocol version + compat check.
- `apps/web/src/main.tsx` — entry web; `apps/server/src/index.ts` — entry backend.
- `packages/ui/src/` — shadcn components dùng chung.
- `docs/architecture.md` — kiến trúc + roadmap (P0→P5); `docs/design-system.md` — tokens + components + patterns.
- `docs/tui-parity-status.md` — **bảng theo dõi parity với OMP TUI** (done/partial/not-done + evidence + changelog). Cập nhật mỗi khi xong 1 phần hoặc phát hiện gap mới.
- `.env.example` — env keys mẫu (không commit `.env`).

## Runtime/Tooling Preferences

- Runtime: **Bun** (lock 2026-09-07, Bun ≥1.3.14) — `bun install/run/test`. Không Node, không `.nvmrc`.
- Package manager: Bun workspaces; một lockfile `bun.lock`. Cấm npm/pnpm/yarn lockfiles.
- Language: TypeScript `strict`. Không file JS mới.
- Lint/format: **Biome** duy nhất (không ESLint/Prettier).
- FE libs (lock): `tailwindcss` + `tailwind-merge` + `clsx` + `class-variance-authority`, shadcn/Radix + `lucide-react`, `react-router-dom`, `@tanstack/react-query` + `@tanstack/react-virtual`, `zustand`, `react-markdown` + `remark-gfm`, `@xterm/xterm`, `@uiw/react-codemirror`, `react-hook-form` + `zod`.
- Editor: **CodeMirror** (lock). E2E (Playwright): có từ P5, là cổng UI trong CI — `bun run e2e` (15 spec, `tests/e2e/app.spec.ts`).
- Tooling constraints: không commit khi `bun run check` đỏ; không global install trong docs (dùng `bunx`).

## Testing & QA

- Framework: Vitest (DOM) / `bun test` (logic thuần); UI e2e bằng Playwright (`bun run e2e`, 15 spec) — chạy trong CI như một cổng bắt buộc.
- Layout: unit colocate `*.test.ts(x)`; integration `tests/features/<name>.test.ts`.
- Running: `bun run test` (watch: `vitest`), `bun run check` cho full gate.
- Contract test bắt buộc cho `AgentRuntime`: mock runtime (không phải OMP) cắm vào `apps/server` → web vẫn pass — proof UI không biết runtime.
- Coverage: chưa ngưỡng tới release đầu; sau đó enforce theo feature từng regress, không global %.
- QA rule cho AI: bug fix → script reproduce trước, giữ làm regression test chỉ khi fail pre-fix + pass post-fix; assert observable behavior, không assert wiring/text snapshot.
