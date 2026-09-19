# Project hard rules (sticky, always-apply)

Keep short. Background lives in `AGENTS.md`; details in `.omp/rules/*`.

- `bun run check` green before commit. Never commit with red typecheck/lint/test.
- AI MAY commit completed work proactively, without waiting to be asked. Conventional Commits, one logical change per commit, stage only the intended files (never sweep unrelated in-progress changes).
- Never commit `.env`. Document keys in `.env.example`.
- `apps/web` MUST NOT import `apps/server`, `packages/omp-adapter`, or OMP — only `packages/core`, `packages/protocol`, `packages/ui`.
- No new JS files — TypeScript strict only. Format with Biome before yield.
- Never re-implement OMP logic in frontend: no JSONL parsing in browser, no registry/credential resolution outside `packages/omp-adapter`.
- After finishing any TUI-parity piece (or finding a new gap): update `docs/tui-parity-status.md` — status, Evidence (command/route + observed result), and a Changelog line. That file is the single source of truth for parity status.
