# AI-GUI Runbook

How to run, debug, and operate the stack. Architecture: `docs/architecture.md`. Design system: `docs/design-system.md`.

## Run

```sh
bun install          # install all workspaces
bun run dev          # web :5173 + server :8787 together
bun run dev:web      # web only
bun run dev:server   # server only (AI_GUI_PORT=8787 default)
bun run check        # typecheck + lint + test (CI gate, must be green to commit)
bun run e2e          # Playwright stack smoke (boots server :8899 + web :5199)
```

Open `http://localhost:5173`. First action: New session (sidebar) → prompt in Chat.

## Ports & env

| Var | Default | Meaning |
|---|---|---|
| `AI_GUI_PORT` | `8787` | server HTTP+WS port (`/api/*`, WS `/api/sessions/:id/stream`) |
| `AI_GUI_E2E_SERVER_PORT` | `8899` | server port under Playwright |
| `AI_GUI_E2E_WEB_PORT` | `5199` | web port under Playwright |

No `.env` file is read; never commit secrets. OMP credentials live in `~/.omp/` (user scope), never in this repo.

## Session cwd registry

`apps/server` keeps an in-memory map web-session → cwd (for tool routes + jail). It resets on server restart: after a restart, re-create sessions from the UI (old web session ids return 404 for tool routes until re-registered). OMP journal files on disk are untouched.

## Troubleshooting

- **LSP shows no servers after installing one** (e.g. `typescript-language-server`): the SDK caches LSP config per cwd per process. Restart the server (`Ctrl+C` + `bun run dev:server`), then retry diagnostics. Needs: server binary on `PATH` + root marker (`package.json`/`tsconfig.json`) in the session cwd.
- **`lsp: undefined is not an object (evaluating 'theme.status')`**: SDK theme never initialized (server booted before the `ensureTheme()` wiring). Update to a build containing `packages/omp-adapter/src/tools.ts` theme init and restart.
- **501 `operation not supported`** on clear/fresh/navigate/dump/share: expected on the default `omp-rpc` runtime (no such RPC primitives). Same ops work on SDK-runtime sessions. UI surfaces the 501 message; do not retry blindly.
- **Branch transcript looks empty**: correct `/branch` semantics — the new file starts an empty transcript continuing from the branch point. History lives in the parent session (tree view).
- **Empty messages right after clear**: correct — transcript restarts after `reset_boundary`. Full history stays in export/dump.
- **Roster empty after server restart**: hub + tool registries are in-memory. Re-create/spawn after restart.
- **Subagent missing from Hub roster**: only agents spawned via Hub → Spawn appear. Subagents spawned inside an agent turn live in that (possibly rpc-child) process and are intentionally not listed.
- **Vite proxy wrong server**: `apps/web/vite.config.ts` targets `AI_GUI_PORT ?? 8787`. When running server on a custom port, export the same var for web.
- **Playwright browsers missing**: `bunx playwright install chromium` (needs network, ~100MB).
- **429 from free-tier model relays during dev**: builders hit this on shared keys; retry later or set own provider keys in `~/.omp/`.

## Production notes (local-only default)

- Bind address: server listens on all interfaces by default under Bun; put it behind `127.0.0.1` (ssh tunnel / reverse proxy) if the machine is shared.
- No auth on `/api/*` (local-only assumption). Do not expose the port to a LAN without adding auth.
- OMP writes live under `~/.omp/agent/` (sessions, blobs, history.db) — back that dir up, not this repo.
- Resource notes: one `omp --mode rpc` child per web session; DAP allows one live root debug session process-wide; LSP clients cache per `command:cwd`.

## Deferred (documented, not planned)

- **Desktop shell** (`apps/desktop`): no Rust/Electron toolchain in this environment and web is the deliverable. Revisit with Tauri (reuse `packages/*` over the same REST/WS protocol) when a native shell is required.
- **Collab host/guest + ask-answer injection**: need `InteractiveModeContext`/`hasUI` designs + relay account; user is local-only. Relay default stays `wss://my.omp.sh`; server never hosts a relay.
- **Interactive PTY**: terminal runs commands non-interactively with output + jobs; full PTY attach is a later epic.
