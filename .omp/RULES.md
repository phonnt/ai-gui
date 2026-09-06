# Project hard rules (sticky, always-apply)

Keep short. Background lives in `AGENTS.md`; details in `.omp/rules/*`.

- `bun run check` green before commit. Never commit with red typecheck/lint/test.
- Never commit `.env`. Document keys in `.env.example`.
- `apps/web` MUST NOT import `apps/server`, `packages/omp-adapter`, or OMP — only `packages/core`, `packages/protocol`, `packages/ui`.
- No new JS files — TypeScript strict only. Format with Biome before yield.
- Never re-implement OMP logic in frontend: no JSONL parsing in browser, no registry/credential resolution outside `packages/omp-adapter`.
