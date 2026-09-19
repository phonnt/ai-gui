# Windows spike — 2026-09-19

Run date: **2026-09-19** (GitHub Actions run `35429017400`, job `windows-spike`,
`windows-latest`, conclusion **success**).

- Sidecar compile (bun-windows-x64): **PASS** — `ai-gui-server.exe`,
  136,641,024 bytes, 2988 modules bundled.
- Addon win32-x64 load: **PASS** — `pi_natives.win32-x64-baseline.node`
  (179,168,768 bytes); the `-baseline` variant was the only one matching the
  CI glob on this runner.
- Health + session: **PASS** — session `01a0b88a-2af3-7000-a535-3e0aafa11df9`.
- write/read/edit: **PASS** — `write: tag 6201`, `read: ok`, `edit: ok`.
- bash tool: **PASS** — `exit 0`, shell: OMP default on Windows.
- Verdict: **full parity feasible for the probed tools**.
- CI run URL: https://github.com/phonnt/ai-gui/actions/runs/35429017400

## Raw probe output

```
PASS session: 01a0b88a-2af3-7000-a535-3e0aafa11df9
PASS write: tag 6201
PASS read: ok
PASS edit: ok
PASS bash: exit 0
tool probe OK
```

## Caveats

- Only the core tools (session/write/read/edit/bash) were probed. No
  lsp/notebook/PTY/terminal coverage.
- The edit assertion cannot distinguish an applied edit from a no-op patch:
  the probe replaces line 1 with identical content, so `applied: true` is
  asserted but the on-disk result is unchanged by design.
- Only the `-baseline` native addon variant matched; the AVX2/modern variant
  path was not exercised.
- The GUI/installer was not exercised — this covers the compiled sidecar only.

Probe: `scripts/smoke-tools.ts` (run by the `windows-spike` job in
`.github/workflows/desktop.yml`). Result above clears the gate for Tasks 2+.
