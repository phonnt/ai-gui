# Grove Runbook

How to run, debug, and operate the stack. Architecture: `docs/architecture.md`. Design system: `docs/design-system.md`.

## Run

```sh
bun install          # install all workspaces
bun run dev          # web :5173 + server :8787 together
bun run dev:web      # web only
bun run dev:server   # server only (GROVE_PORT=8787 default)
bun run check        # typecheck + lint + test (CI gate, must be green to commit)
bun run e2e          # Playwright stack smoke (boots server :8899 + web :5199)
```

Open `http://localhost:5173`. First action: New session (sidebar) → prompt in Chat.

## Ports & env

| Var | Default | Meaning |
|---|---|---|
| `GROVE_PORT` | `8787` | server HTTP+WS port (`/api/*`, WS `/api/sessions/:id/stream`) |
| `GROVE_WEB_DIST` | unset | serve a built web UI from this dir (absolute, or relative to the server cwd); the server validates `index.html` at boot and fails fast otherwise. The desktop sidecar sets it |
| `GROVE_TOKEN` | unset | shared token for `/api/*` + WS auth; also set as a cookie on served HTML |
| `GROVE_E2E_SERVER_PORT` | `8899` | server port under Playwright |
| `GROVE_E2E_WEB_PORT` | `5199` | web port under Playwright |

Bun loads `.env` automatically for `bun run`/`bun <file>` (verified: `GROVE_PORT` from `.env` reaches the server), so `.env` works and stays git-ignored — never commit secrets. OMP credentials live in `~/.omp/` (user scope), never in this repo.

## Session cwd registry

`apps/server` keeps an in-memory map web-session → cwd (for tool routes + jail). It resets on server restart: after a restart, re-create sessions from the UI (old web session ids return 404 for tool routes until re-registered). OMP journal files on disk are untouched.

## Troubleshooting

- **LSP shows no servers after installing one** (e.g. `typescript-language-server`): the SDK caches LSP config per cwd per process. Restart the server (`Ctrl+C` + `bun run dev:server`), then retry diagnostics. Needs: server binary on `PATH` + root marker (`package.json`/`tsconfig.json`) in the session cwd.
- **`lsp: undefined is not an object (evaluating 'theme.status')`**: SDK theme never initialized (server booted before the `ensureTheme()` wiring). Update to a build containing `packages/omp-adapter/src/tools.ts` theme init and restart.
- **501 `operation not supported`**: runtime là SDK-only nên clear/fresh/navigate/dump/share/goal/modes đều chạy thật. 501 giờ chỉ xuất hiện cho op thực sự chưa implement — báo bug, đừng retry mù.
- **Branch transcript looks empty**: correct `/branch` semantics — the new file starts an empty transcript continuing from the branch point. History lives in the parent session (tree view).
- **Empty messages right after clear**: correct — transcript restarts after `reset_boundary`. Full history stays in export/dump.
- **Roster empty after server restart**: hub + tool registries are in-memory. Re-create/spawn after restart.
- **Subagent missing from Hub roster**: only agents spawned via Hub → Spawn appear. Subagents spawned inside an agent turn are internal to that session and are intentionally not listed.
- **`PTY` toggle in Terminal runs without a terminal**: expected. The SDK only allocates a PTY when the tool runs with an interactive UI context (`canUseInteractiveBashPty`), and the web client has no terminal transport yet; the command still runs through a plain pipe and the SDK appends the fallback notice to the output.
- **Bash output shows "truncated" but no artifact link**: line-elided bash output is not spilled to an artifact outside an interactive runtime (the TUI's streaming sink owns that path). The `Next page`/`Show full output` controls appear whenever the server supplies ranges or an artifact id — for bash only byte-cap spills qualify; use a file read with `range` (which does page) or narrow the command.
- **Model roles / theme slots / memory backend không thấy trong Settings**: chúng nằm ở pane riêng trên thanh công cụ trái — `Roles` (bảng `@role`), `Themes` (chip dark/light để chọn slot), `Knowledge` (chip backend memory). Ghi trực tiếp qua `PUT /api/settings/<key>` cũng được.
- **`/api/mcp/tools` trả rỗng**: endpoint chỉ liệt kê tool của server đã connect. Bấm `Discover` trong pane MCP (hoặc `?discover=true`) để dial server trước.
- **Approval prompts never appear**: check `tools.approvalMode` (`always-ask` / `write` / `yolo`). Mode `yolo` auto-approves every tier; a `tools.approval.<tool>: allow` policy also bypasses the prompt in any mode.
- **Vite proxy wrong server**: `apps/web/vite.config.ts` targets `GROVE_PORT ?? 8787`. When running server on a custom port, export the same var for web.
- **Playwright browsers missing**: `bunx playwright install chromium` (needs network, ~100MB).
- **429 from free-tier model relays during dev**: builders hit this on shared keys; retry later or set own provider keys in `~/.omp/`.
- **`cargo test` / `cargo build` / `bun run dist:macos` in `apps/desktop/src-tauri` fails with `failed to read plugin permissions: ... /<old-path>/apps/desktop/src-tauri/target/<profile>/build/tauri-*/out/...`**: the build cache still holds absolute paths from before the checkout directory was moved/renamed (e.g. `…/00.AI/AI-GUI` → `…/00.AI/Grove`). Both profiles are affected and a partial clean is easy to get wrong (the pre-rename crate left `build/ai-gui-desktop-*` behind), so prefer `cargo clean` in `apps/desktop/src-tauri` and rebuild; then re-run the task. CI is unaffected (fresh checkout).

## Production notes (local-only default)

- Bind address: the server binds `127.0.0.1` explicitly (`apps/server/src/index.ts`).
- Requests are refused unless the `Host` header is loopback (`127.0.0.1`, `localhost`, `::1`) — a reverse proxy or SSH tunnel in front must forward `Host: 127.0.0.1:<port>`.
- No auth on `/api/*` when `GROVE_TOKEN` is unset (dev default), and the token cookie is handed to any loopback `GET /`, so the token is a CSRF guard, not an access boundary. Do not expose the port beyond the machine.
- OMP writes live under `~/.omp/agent/` (sessions, blobs, history.db) — back that dir up, not this repo.
- Resource notes: the runtime is the in-process SDK (no `omp` child process); DAP allows one live root debug session process-wide; LSP clients cache per `command:cwd`.

## Desktop

Tauri v2 shell (`apps/desktop`) that serves the built web UI and runs the compiled server as a sidecar.

```sh
bun run build:desktop           # web dist + sidecar + addon + manifest
cd apps/desktop && bun run build  # tauri build --no-bundle: compile-only, no updater key
```

`bun run build` is the unsigned escape hatch: `--no-bundle` skips the `.app`
bundle and its updater artifacts, so "build the app to look at it" works with
no signing key. Output binary lives under
`apps/desktop/src-tauri/target/release/`.

### Updater artifacts

Bundling emits signed updater artifacts (`createUpdaterArtifacts: true`), so
this build REQUIRES the minisign key — without it the bundle step errors.

```sh
(cd apps/desktop && \
  TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/grove.key" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  bun run tauri build)                                   # .app -> apps/desktop/src-tauri/target/release/bundle/macos/Grove.app
bun run smoke:bundle                                     # launch .app, assert sidecar exits with the app (macOS GUI)
```

See [docs/desktop-release.md](./desktop-release.md) for key generation, updater
artifact names, manifest hosting, and CI env vars.

- Build is **unsigned** (`APPLE_SIGNING_IDENTITY` unset). An unsigned build does **not** enable the hardened runtime, so library validation blocking a `dlopen` of the native addon cannot happen here and is **not verified** by this task — it is a Phase B concern (signing + hardened runtime). Native addon provisioning itself is verified: the app copies the bundled `natives/` resource into `~/.omp/natives/<version>/` at launch, independent of any loopback download.
- App data (sessions/settings) lives under `~/Library/Application Support/dev.grove.desktop/`; the native addon cache stays at `~/.omp/natives/`.

### Team installer (unsigned, no Apple Developer account)

```sh
bun run dist:macos     # build .app -> ad-hoc sign -> dist/macos/Grove-<ver>-macos-<arch>.{dmg,zip}
```

`scripts/package-macos.ts` builds the app with `--no-sign`, then **ad-hoc signs
the whole bundle** (`codesign --force --deep --sign -`). That step is required,
not cosmetic: on Apple Silicon the inner binaries are only linker-signed, and an
unsealed bundle (no `_CodeSignature/CodeResources`) is refused by
LaunchServices — `open` silently fails even though running the binary directly
works. Ad-hoc signing satisfies macOS "valid on disk" without any Apple
credentials.

- DMG contains `Grove.app` + an `/Applications` symlink for drag-install.
- Only `arm64` (Apple Silicon) is built; Intel Macs are not supported by this
  artifact.
- Gatekeeper still reports "unidentified developer" on machines that **download**
  the DMG. Install help: right-click the app → Open (once), or
  `xattr -dr com.apple.quarantine /Applications/Grove.app`. Files copied over
  scp/git carry no quarantine flag and open directly.
- Not notarized, so no `spctl` acceptance — the workflow for a public release
  would need real signing (see `docs/desktop-release.md`).

### Windows (x64)

The same `apps/desktop` builds on Windows; the build script derives the target triple and addon filename from the host.

```sh
bun install                     # pulls @oh-my-pi/pi-natives-win32-x64
bun run build:desktop           # -> binaries/grove-server-x86_64-pc-windows-msvc.exe (+ addon beside it and in resources/natives)
cd apps/desktop && bun run tauri build --no-sign   # unsigned NSIS installer -> bundle/nsis/*.exe
```

CI: the `windows` job (`windows-latest`) runs `check`, `build:desktop`, `smoke:sidecar`, the HTTP tool probe (`smoke-tools.ts`, read/write/edit/glob/lsp/bash), then `tauri build --no-sign`, and uploads the NSIS `.exe`.

- App data (sessions/settings) lives under `%APPDATA%\dev.grove.desktop\`; the native addon cache stays at `%USERPROFILE%\.omp\natives\`.
- **Unverified on Windows**: the GUI window and the NSIS installer runtime (CI runners are headless), and Authenticode signing (installer is unsigned → SmartScreen warns).
- Native packages are per-platform: `bun install` on Windows will not have the darwin addon and vice versa; `build:desktop` fails loudly if the host addon is missing.

#### Manual checklist (run once on a real Windows machine)

Tracked in issue #1 — record the outcome here (date, Windows build, artifact
source) once it has been run. CI covers the server, native addon, and tool
surface. These need a desktop:

1. Install `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe`; SmartScreen → More info → Run anyway.
2. App opens; the window shows the Grove landing page (not the error page).
3. Settings → change theme; create a session; send a short prompt → streamed reply.
4. Run a tool from the Terminal tab (e.g. `echo ok`) → output appears.
5. Data lands under `%APPDATA%\dev.grove.desktop\`; `%USERPROFILE%\.omp\` only gains `natives\`.
6. Kill `grove-server.exe` in Task Manager → error page appears within ~10s; **Retry** restores the app.
7. Close the app → no `grove-server.exe` left in Task Manager.

## Deferred (documented, not planned)

- **Collab host/guest + ask-answer injection**: need `InteractiveModeContext`/`hasUI` designs + relay account; user is local-only. Relay default stays `wss://my.omp.sh`; server never hosts a relay.
- **Interactive PTY**: terminal runs commands non-interactively with output + jobs; full PTY attach is a later epic.

## Gate

`bun run check` = typecheck → lint → unit tests → **server smoke**. The smoke
boots the server from source against an isolated `PI_CODING_AGENT_DIR`, hits
`/api/health`, every global read route, then creates a throwaway session and
reads its workspace/tools/skills/jobs/plan/messages/modes/stats/memory routes.

Why it exists: typecheck/lint/test never import the server entry, so a broken
runtime import (`export {} from './deleted.js'`) passed the gate and crashed at
startup. Verified: adding such an import fails the smoke with the module error;
removing it passes.
