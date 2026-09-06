---
description: Reminds when web edits touch server runtime or OMP adapter internals.
globs:
  - 'apps/web/**/*'
scope: 'tool:edit(*), tool:write(*)'
condition: 'omp-adapter|apps/server|createAgentSession|from .omp.'
---

# No web-to-runtime imports (triggered reminder)

`apps/web` MUST only import `packages/core`, `packages/protocol`, and `packages/ui` (via `src/lib/api-client`).

If an edit or write under `apps/web/` introduces `omp-adapter`, `apps/server`, `from 'omp'`, or `createAgentSession`: STOP. Move that logic to `apps/server` or `packages/omp-adapter` and expose it through `packages/protocol` + `AgentRuntime` instead. See `docs/architecture.md` §4 and `rule://monorepo-boundaries`.
