#!/usr/bin/env bun
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Builds the unsigned macOS app, ad-hoc signs the bundle, and packages a DMG +
// zip for internal team installs.
//
// Ad-hoc signing (`codesign --sign -`) is REQUIRED: on Apple Silicon every
// binary is at least linker-signed, but an unsealed bundle (no
// `_CodeSignature/CodeResources`) is refused by LaunchServices — `open` fails
// with no error even though executing the binary directly works.
//
// No Apple Developer credentials are involved; Gatekeeper still shows
// "unidentified developer" on machines that download the DMG (see the printed
// install note).
import { $ } from 'bun';

const BUNDLE_DIR = 'apps/desktop/src-tauri/target/release/bundle/macos';
const APP_NAME = 'Grove.app';
const APP = join(BUNDLE_DIR, APP_NAME);
const OUT = 'dist/macos';

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error('dist:macos must run on macOS');
    process.exit(1);
  }
  await $`bun run build:desktop`;
  // --no-sign: skip Developer ID signing; we ad-hoc seal below instead.
  await $`cd apps/desktop && bun run tauri build --bundles app --no-sign`;
  await $`codesign --force --deep --sign - ${APP}`;

  const version = (
    (await Bun.file('apps/desktop/src-tauri/tauri.conf.json').json()) as {
      version: string;
    }
  ).version;
  const base = `Grove-${version}-macos-${process.arch}`;
  const dmg = join(OUT, `${base}.dmg`);
  const zip = join(OUT, `${base}.zip`);
  await mkdir(OUT, { recursive: true });

  const stage = join(tmpdir(), `grove-dmg-${Date.now()}`);
  await mkdir(stage, { recursive: true });
  await $`cp -R ${APP} ${stage}/`;
  await $`ln -s /Applications ${join(stage, 'Applications')}`;
  await rm(dmg, { force: true });
  await $`hdiutil create -volname Grove -srcfolder ${stage} -ov -format UDZO ${dmg}`.quiet();
  await rm(stage, { recursive: true, force: true });

  await rm(zip, { force: true });
  await $`ditto -c -k --keepParent ${APP} ${zip}`;

  console.log(`built: ${dmg}\nbuilt: ${zip}`);
  console.log(
    '\nTeam install (unsigned, no notarization):\n' +
      '  1. Open the DMG and drag Grove to Applications.\n' +
      '  2. If macOS blocks it ("unidentified developer"), either\n' +
      '     - right-click the app -> Open (once), or\n' +
      '     - run: xattr -dr com.apple.quarantine /Applications/Grove.app\n' +
      '  Files copied via scp/git (no download) have no quarantine flag and open directly.',
  );
}

if (import.meta.main) await main();
