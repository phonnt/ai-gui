#!/usr/bin/env bun
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
// Builds the desktop sidecar: web dist, compiled server binary, native addon,
// and the manifest Rust reads to provision the addon at runtime.
import { $ } from 'bun';

const TARGET_TRIPLE = 'aarch64-apple-darwin';
const ADDON_FILENAME = 'pi_natives.darwin-arm64.node';
const OUT_DIR = 'apps/desktop/binaries';
const SERVER_OUT = join(OUT_DIR, `ai-gui-server-${TARGET_TRIPLE}`);
const WEB_DIST = 'apps/desktop/src-tauri/resources/web';

async function findAddon(): Promise<{ path: string; version: string }> {
  const glob = new Bun.Glob(
    `node_modules/.bun/@oh-my-pi+pi-natives-darwin-arm64@*/**/${ADDON_FILENAME}`,
  );
  // dot:true required — the Bun workspace cache lives under node_modules/.bun.
  for await (const match of glob.scan({ cwd: '.', dot: true })) {
    const pkgJson = join(match, '..', 'package.json');
    const pkg = (await Bun.file(pkgJson).json()) as { version?: string };
    return { path: match, version: pkg.version ?? '0.0.0' };
  }
  throw new Error(`native addon not found: ${ADDON_FILENAME}`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await $`bun run --filter @ai-gui/web build`;
  await $`rm -rf ${WEB_DIST}`;
  await mkdir('apps/desktop/src-tauri/resources', { recursive: true });
  await $`cp -R apps/web/dist ${WEB_DIST}`;
  await $`bun build --compile apps/server/src/index.ts --outfile ${SERVER_OUT} --external omp-legacy-pi-modules`;
  const addon = await findAddon();
  await copyFile(addon.path, join(OUT_DIR, ADDON_FILENAME));
  await Bun.write(
    join(OUT_DIR, 'natives-manifest.json'),
    JSON.stringify({ version: addon.version, file: ADDON_FILENAME }, null, 2),
  );
  console.log(
    `sidecar: ${SERVER_OUT}\nweb dist: ${WEB_DIST}\naddon: ${ADDON_FILENAME} v${addon.version}`,
  );
}

await main();
