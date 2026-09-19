#!/usr/bin/env bun
// Guards the launch -> sidecar alive -> quit clean lifecycle only: it opens a
// fresh instance of the unsigned .app, asserts the sidecar comes up, then
// asserts no sidecar survives the quit. Bundle layout and addon provisioning
// are verified separately (see the task-6 report), not by this smoke.
import { existsSync } from 'node:fs';
import { $ } from 'bun';

const APP = 'apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app';
const SIDECAR = 'AI-GUI.app/Contents/MacOS/ai-gui-server';
if (!existsSync(APP)) {
  console.error(`missing app bundle: run \`cd apps/desktop && bun run tauri build\` (${APP})`);
  process.exit(1);
}

// Fail fast so a pre-existing instance can't satisfy the assertions below.
const preexisting = await $`pgrep -fl ${SIDECAR}`.quiet().nothrow();
if (preexisting.exitCode === 0) {
  console.error('ai-gui-server already running; refusing to smoke a stale instance');
  console.error(preexisting.stdout.toString());
  process.exit(1);
}

await $`open -n ${APP}`.quiet();
await Bun.sleep(6000);

const running = await $`pgrep -fl ${SIDECAR}`.quiet().nothrow();
if (running.exitCode !== 0) {
  console.error('sidecar not running after launch');
  await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
  process.exit(1);
}

await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
await Bun.sleep(3000);

const after = await $`pgrep -fl ${SIDECAR}`.quiet().nothrow();
if (after.exitCode === 0) {
  console.error('sidecar survived app quit');
  process.exit(1);
}
console.log('bundle smoke OK');
