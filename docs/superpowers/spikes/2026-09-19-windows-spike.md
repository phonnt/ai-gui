# Windows spike — 2026-09-19

Status: pending — populated by the `windows-spike` CI run (workflow_dispatch).

- Sidecar compile (bun-windows-x64): PENDING
- Addon win32-x64 load: PENDING
- Health + session: PENDING
- write/read/edit: PENDING
- bash tool: PENDING — shell/version/output TBD
- Verdict: PENDING
- CI run URL: TBD

Probe: `scripts/smoke-tools.ts` (run by the `windows-spike` job in
`.github/workflows/desktop.yml`). If `bash` FAILs, stop and negotiate scope
before Tasks 2+.
