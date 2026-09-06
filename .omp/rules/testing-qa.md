---
description: Test layout, contract tests, and QA rules for bug fixes.
globs:
  - 'apps/**/src/**/*.test.*'
  - 'packages/**/src/**/*.test.*'
  - 'tests/**/*'
---

# Testing & QA

- Units colocate as `*.test.ts(x)`; integration in `tests/features/<name>.test.ts`. Playwright E2E only from P5.
- Mandatory contract test: mock (non-OMP) runtime plugged into `apps/server` → web still passes. This proves UI ignorance of runtime.
- Bug fix flow: reproduce script first; keep as regression test ONLY if it fails pre-fix and passes post-fix, else throwaway script.
- Assert observable behavior. NEVER assert wiring, text snapshots, or implementation details. Delete tests that pin incidental behavior instead of re-pinning them.
- No global coverage thresholds until first release.
