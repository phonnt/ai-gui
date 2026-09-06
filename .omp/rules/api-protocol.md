---
description: Backend/frontend contract rules — protocol-first with zod schemas and versioning.
globs:
  - 'apps/server/**/*'
  - 'apps/web/src/lib/**/*'
  - 'packages/protocol/**/*'
  - 'packages/agent-runtime/**/*'
  - 'packages/omp-adapter/**/*'
---

# API contract (protocol-first)

- Wire schemas live in `packages/protocol` (rest/events/sse/version, zod). REST handlers and `lib/api-client` validate against them; never hand-duplicate shapes.
- Bump `packages/protocol/src/version.ts` on breaking changes; gateway rejects mismatched clients with a typed error.
- `AgentRuntime` (`packages/agent-runtime/src/runtime.ts`) is the only contract `apps/server` programs against. New runtime = new adapter implementing the interface; `protocol` + web stay untouched.
- WS streams: id correlation, chunk reassembly, paged message drain (limit ≤ 256). Reuse artifact endpoints (`artifact://`/`agent://`); never re-implement truncation in frontend.
- Credentials: masked in list, unmasked only in single-get.
