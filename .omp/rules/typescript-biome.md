---
description: TypeScript strict and Biome formatting conventions.
globs:
  - 'apps/**/*.ts'
  - 'apps/**/*.tsx'
  - 'packages/**/*.ts'
  - 'packages/**/*.tsx'
---

# TypeScript + Biome

- `strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: bundler` (extend `packages/config/tsconfig.base.json`).
- Biome: 2-space, single quotes, semicolons, lineWidth 100. Run `biome format --write .` before yield.
- `async/await` only; no floating promises (`void` or `await`); `Promise.all` for independent I/O.
- Naming: `camelCase` functions/vars, `PascalCase` types/components, `kebab-case` files/dirs, `SCREAMING_SNAKE` env/consts.
- Typed errors at boundaries (`packages/agent-runtime/errors.ts` on backend, `Result<T>` in web api-client); never silent catch.
- No new JS files.
