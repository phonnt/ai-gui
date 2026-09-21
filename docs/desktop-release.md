# Desktop release & auto-update

How the Tauri desktop app (`apps/desktop`) is built, signed for updates, and
served an update manifest. Architecture/runbook: `docs/runbook.md`.

## Status (Phase A)

### Deployment status by OS (audited 2026-09-21)

| Target | Build path | Artifact | Signature | CI job | Last verified |
|---|---|---|---|---|---|
| **macOS arm64** (Apple Silicon) | `bun run dist:macos` locally, `release` job on a `desktop-v*` tag | `dist/macos/Grove-0.1.0-macos-arm64.{dmg,zip}` (83 / 73 MB) | unsigned + **ad-hoc sealed** (`codesign --verify` = valid on disk, `spctl` = rejected: not notarized) | `verify` (macos-14) | 2026-09-21: rebuilt at HEAD, DMG/zip emitted, `bun run smoke:bundle` OK (launch → sidecar alive → quit → sidecar gone, 9s); CI `verify` green on run 35558501401 |
| **macOS x86_64** (Intel) | — | — | — | — | **not supported**: `platformTarget('darwin','x64')` throws `unsupported platform`; no CI job |
| **Windows x64** | CI `windows` job (windows-latest), or a Windows host | `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe` | unsigned (no Authenticode) | `windows` | 2026-09-21 (run 35558501401, d10a57e): all 12 steps green — tool probe OK (`PASS lsp: no language server configured`), NSIS installer built unsigned, bundle smoke OK, artifact `grove-windows` 62.4 MB uploaded. The installer/GUI runtime itself is **not** exercised (headless runner) and is tracked by [issue #1](https://github.com/phonnt/grove/issues/1) |
| **Windows arm64** | — | — | — | — | **not supported**: throws |
| **Linux** (any arch) | — | — | — | — | **not supported**: no bundler config, no job, `platformTarget` throws |

The desktop workflow only runs on `workflow_dispatch` or a `desktop-v*` tag, so
`ci.yml` (check + e2e) cannot catch drift in the desktop path. The tool probe's
expectations are unit-tested (`scripts/smoke-tools.test.ts`) so a contract change
fails `bun run check` instead of only the Windows job.

- Auto-update is **wired but end-to-end unverified**: the plugin is registered,
  the startup check runs, and a keyed build emits signed updater artifacts. No
  manifest is hosted yet and no older installed build exists locally, so the
  "detect -> install -> restart" path has **not** been exercised. A `--no-sign`
  build (what both CI and `dist:macos` do) emits `Grove.app.tar.gz` **without**
  a `.sig`, so it cannot be served to updater clients.
- Endpoint is a placeholder: `https://REPLACE.example/grove/latest.json`.
- Apple code signing / notarization is **not** configured (no credentials); see
  [runbook.md](./runbook.md#desktop). Artifacts are unsigned except for the
  updater-minisign signature below.
- **Windows**: the NSIS installer is unsigned (no Authenticode cert) and the
  Windows CI build uses `--no-sign`, so it emits **no updater artifacts** — the
  Windows auto-update path is deferred until signing exists. A future
  `latest.json` would need a `windows-x86_64` entry alongside the macOS ones.

### Releasing both installers

```sh
git tag -a desktop-v0.1.0 -m "Grove desktop 0.1.0" && git push origin desktop-v0.1.0
```

The `desktop-v*` tag runs `verify` + `windows`, then the `release` job builds the
macOS DMG/zip, pulls the Windows NSIS installer from the same run
(`actions/download-artifact`), and creates a **draft** release carrying all
three. Verified 2026-09-21 on `desktop-v0.1.0` (run 35564365477):

| Asset | Size |
|---|---|
| `Grove-0.1.0-macos-arm64.dmg` | 83.2 MB |
| `Grove-0.1.0-macos-arm64.zip` | 73.0 MB |
| `Grove_0.1.0_x64-setup.exe` (NSIS, unsigned) | 62.4 MB |

The draft is not public: publish it (or attach the same assets to a real
release) when the build has been checked. Both installers are unsigned — macOS is
ad-hoc sealed, Windows has no Authenticode — so expect Gatekeeper / SmartScreen
warnings; see `docs/runbook.md` for install steps.

## Update key

The updater uses its own minisign keypair — independent of Apple signing.

```sh
cd apps/desktop && bunx tauri signer generate -w ~/.tauri/grove.key -p "" --ci
```

- Private key: `~/.tauri/grove.key` (never commit; `~/.tauri/` is outside the repo).
- The keypair on the build machine predates the Grove rename and is still named
  `ai-gui.key`; its public half **matches** the pubkey embedded in
  `tauri.conf.json` (verified 2026-09-21). Rename the file instead of generating a
  new one — `mv ~/.tauri/ai-gui.key ~/.tauri/grove.key` (and the `.pub` beside it)
  — because a fresh key would no longer match the embedded pubkey and clients
  would reject every update.
- Public key: embedded verbatim in
  `apps/desktop/src-tauri/tauri.conf.json` -> `plugins.updater.pubkey`.
- The pubkey in config and the key used to sign **must** match, or clients
  reject the update.

If the key is rotated, replace `plugins.updater.pubkey` and re-release.

## Build artifacts

`bundle.createUpdaterArtifacts: true` is set in `tauri.conf.json`. A full bundle
build requires the signing key env or the bundle step fails:

```sh
cd apps/desktop
. "$HOME/.cargo/env"
TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/grove.key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  bun run tauri build
```

On macOS (`targets: ["app"]`) Tauri emits, under
`apps/desktop/src-tauri/target/release/bundle/macos/`:

| Path | Purpose |
|---|---|
| `Grove.app` | the unsigned app bundle |
| `Grove.app.tar.gz` | updater payload (hosted, downloaded by clients) |
| `Grove.app.tar.gz.sig` | minisign signature of the tarball |

Without `TAURI_SIGNING_PRIVATE_KEY` the bundle step errors (expected); the
updater artifacts cannot be produced unsigned.

Escape hatches for dev builds that do not need signed updater artifacts:
`cd apps/desktop && bun run build` (`tauri build --no-bundle`) builds the binary
only, and `bunx tauri build --no-sign` bundles the `.app` while skipping both
code and updater signing (emits `Grove.app` + an unsigned `.tar.gz`, no `.sig`).
An unsigned tarball cannot be served to updater clients.

## Host the manifest

Host a `latest.json` next to the tarball over HTTPS and point
`plugins.updater.endpoints` at it. The signature is the **contents** of the
`.sig` file. Example for Apple Silicon:

```json
{
  "version": "0.2.0",
  "notes": "Release notes",
  "pub_date": "2026-09-19T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of Grove.app.tar.gz.sig>",
      "url": "https://updates.example.com/grove/Grove.app.tar.gz"
    }
  }
}
```

- `version` must be semver **greater** than the installed build, or no update
  is offered.
- Add one `platforms` entry per target (`darwin-aarch64`, `darwin-x86_64`,
  `windows-x86_64`, `linux-x86_64`, ...). This app currently ships macOS
  `app` bundles only.
- Replace the placeholder endpoint in `tauri.conf.json` with the real manifest
  URL before releasing.

To verify end-to-end: host the manifest, install an older build, launch it, and
confirm it downloads, installs, and restarts onto the new version.

## CI environment variables

| Var | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/grove.key` (or use `TAURI_SIGNING_PRIVATE_KEY_PATH` for a path) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | key password (empty string for the key generated above) |
| `APPLE_SIGNING_IDENTITY` + notarization vars | **not set** until Apple credentials exist (Phase B) |

Store the private key as a CI secret. It is never committed to this repo.
