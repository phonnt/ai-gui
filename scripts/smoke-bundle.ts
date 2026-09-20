#!/usr/bin/env bun
// Guards the launch -> sidecar alive -> quit clean lifecycle on macOS. On
// Windows the GUI launch is not exercised (hosted runners are headless and the
// Tauri window may not open), so it asserts the built artifacts exist and marks
// the GUI runtime unverified. Bundle layout and addon provisioning are
// verified separately, not by this smoke.
import { existsSync } from 'node:fs';
import { $ } from 'bun';

const MAC_APP = 'apps/desktop/src-tauri/target/release/bundle/macos/Grove.app';
const MAC_SIDECAR = 'Grove.app/Contents/MacOS/grove-server';
const WIN_DIR = 'apps/desktop/src-tauri/target/release';
const WIN_NSIS = 'apps/desktop/src-tauri/target/release/bundle/nsis';

async function macSmoke(): Promise<void> {
  if (!existsSync(MAC_APP)) {
    console.error(
      `missing app bundle: run \`cd apps/desktop && bun run tauri build\` (${MAC_APP})`,
    );
    process.exit(1);
  }

  // Fail fast so a pre-existing instance can't satisfy the assertions below.
  const preexisting = await $`pgrep -fl ${MAC_SIDECAR}`.quiet().nothrow();
  if (preexisting.exitCode === 0) {
    console.error('grove-server already running; refusing to smoke a stale instance');
    console.error(preexisting.stdout.toString());
    process.exit(1);
  }

  await $`open -n ${MAC_APP}`.quiet();
  await Bun.sleep(6000);

  const running = await $`pgrep -fl ${MAC_SIDECAR}`.quiet().nothrow();
  if (running.exitCode !== 0) {
    console.error('sidecar not running after launch');
    await $`osascript -e 'quit app "Grove"'`.quiet().nothrow();
    process.exit(1);
  }

  await $`osascript -e 'quit app "Grove"'`.quiet().nothrow();
  await Bun.sleep(3000);

  const after = await $`pgrep -fl ${MAC_SIDECAR}`.quiet().nothrow();
  if (after.exitCode === 0) {
    console.error('sidecar survived app quit');
    process.exit(1);
  }
  console.log('bundle smoke OK');
}

function windowsSmoke(): void {
  const hasNsis =
    existsSync(WIN_NSIS) &&
    Array.from(new Bun.Glob('*.exe').scanSync({ cwd: WIN_NSIS })).length > 0;
  const hasMain = existsSync(`${WIN_DIR}/Grove.exe`) || existsSync(`${WIN_DIR}/grove-desktop.exe`);
  if (!hasNsis || !hasMain) {
    console.error(`missing Windows artifacts (nsis=${hasNsis} main=${hasMain})`);
    process.exit(1);
  }
  console.log('windows bundle artifacts OK');
  console.log(
    'UNVERIFIED: GUI window/installer runtime (headless runner) — verify on a real Windows machine',
  );
}

if (process.platform === 'win32') {
  windowsSmoke();
} else {
  await macSmoke();
}
