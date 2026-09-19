#!/usr/bin/env bun
// Launches the unsigned .app, waits for it to settle, then asserts no orphan
// sidecar survives after the app is asked to quit. Guards bundle layout,
// addon provisioning, and shutdown wiring.
import { existsSync } from 'node:fs';
import { $ } from 'bun';

const APP = 'apps/desktop/src-tauri/target/release/bundle/macos/AI-GUI.app';
if (!existsSync(APP)) {
  console.error(`missing app bundle: run \`cd apps/desktop && bun run tauri build\` (${APP})`);
  process.exit(1);
}

await $`open ${APP}`.quiet();
await Bun.sleep(6000);

const running = await $`pgrep -fl ai-gui-server`.quiet().nothrow();
if (running.exitCode !== 0) {
  console.error('sidecar not running after launch');
  await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
  process.exit(1);
}

await $`osascript -e 'quit app "AI-GUI"'`.quiet().nothrow();
await Bun.sleep(3000);

const after = await $`pgrep -fl ai-gui-server`.quiet().nothrow();
if (after.exitCode === 0) {
  console.error('sidecar survived app quit');
  process.exit(1);
}
console.log('bundle smoke OK');
