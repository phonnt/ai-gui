---
description: Monorepo dependency DAG and import rules for apps/* and packages/*.
globs:
  - 'apps/**/*'
  - 'packages/**/*'
  - 'package.json'
  - 'tsconfig*.json'
---

# Monorepo boundaries

Dependency DAG (acyclic; enforced by review + `AgentRuntime` contract test):

- `packages/ui`, `packages/core`: standalone, no internal package imports.
- `packages/protocol` → `packages/core` (type-only). `packages/agent-runtime` → `packages/core` (type-only).
- `packages/omp-adapter` → `packages/agent-runtime` + `packages/core` (+ `packages/protocol` for emitted events).
- `apps/server` → `packages/agent-runtime` + `packages/omp-adapter` + `packages/core` + `packages/protocol`.
- `apps/web` → `packages/core` + `packages/protocol` + `packages/ui` via `src/lib/api-client` only. NEVER `apps/server`, `packages/omp-adapter`, or OMP directly.

Additional rules:

- `features/*` inside web never import each other; share via `src/app/store` + `packages/ui`.
- New app/pkg: declare in root `package.json` workspaces, extend `packages/config/tsconfig.base.json`.
- `packages/core` holds types + pure functions only; consumers use `import type`.
- Full tree: `docs/architecture.md` §4.
