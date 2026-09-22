#!/usr/bin/env bun
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
// Builds the desktop sidecar for the HOST platform: web dist, compiled server
// binary, native addon(s), and the manifest Rust reads to provision the addon.
import { $ } from 'bun';

export interface PlatformTarget {
  triple: string;
  addonPattern: string;
  exeSuffix: string;
}

export function platformTarget(platform: string, arch: string): PlatformTarget {
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      triple: 'aarch64-apple-darwin',
      addonPattern: 'pi_natives.darwin-arm64.node',
      exeSuffix: '',
    };
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      triple: 'x86_64-pc-windows-msvc',
      addonPattern: 'pi_natives.win32-x64*.node',
      exeSuffix: '.exe',
    };
  }
  throw new Error(`unsupported platform: ${platform}/${arch}`);
}

// externalBin resolves `binaries/grove-server` here; resources/natives holds
// every addon the manifest lists so the resource key stays filename-agnostic.
const BIN_DIR = 'apps/desktop/src-tauri/binaries';
const NATIVES_DIR = 'apps/desktop/src-tauri/resources/natives';
const WEB_DIST = 'apps/desktop/src-tauri/resources/web';
const CONFIG_FILE = 'apps/desktop/src-tauri/tauri.conf.json';
// Tracked placeholder: the real manifest URL is a build-time input so a release
// can point at its own host without a config commit (docs/desktop-release.md).
export const PLACEHOLDER_ENDPOINT = 'https://REPLACE.example/grove/latest.json';

export function updaterEndpoint(env: Record<string, string | undefined> = process.env): string {
  const endpoint = env.GROVE_UPDATER_ENDPOINT?.trim();
  if (endpoint) return endpoint;
  console.warn(
    `GROVE_UPDATER_ENDPOINT is not set: keeping the placeholder updater endpoint\n` +
      `  ${PLACEHOLDER_ENDPOINT}\n` +
      `  in ${CONFIG_FILE}. Set GROVE_UPDATER_ENDPOINT to the hosted latest.json before a release build.`,
  );
  return PLACEHOLDER_ENDPOINT;
}

// Rewrite the endpoint literal in place: the rest of the hand-formatted config
// (inline objects, key order) must survive the build untouched.
export async function writeUpdaterEndpoint(endpoint: string, file = CONFIG_FILE): Promise<void> {
  const pattern = /("endpoints"\s*:\s*\[)[^\]]*(\])/;
  const raw = await Bun.file(file).text();
  if (!pattern.test(raw)) throw new Error(`${file}: plugins.updater.endpoints[] not found`);
  const next = raw.replace(pattern, `$1${JSON.stringify(endpoint)}$2`);
  if (next !== raw) await Bun.write(file, next);
}

async function findAddons(pattern: string): Promise<{ files: string[]; version: string }> {
  const glob = new Bun.Glob(`node_modules/.bun/**/${pattern}`);
  const files: string[] = [];
  let version = '0.0.0';
  for await (const match of glob.scan({ cwd: '.', dot: true })) {
    files.push(match);
    if (version === '0.0.0') {
      const pkg = (await Bun.file(join(match, '..', 'package.json')).json()) as {
        version?: string;
      };
      version = pkg.version ?? '0.0.0';
    }
  }
  if (files.length === 0) throw new Error(`native addon not found: ${pattern}`);
  return { files, version };
}

async function main(): Promise<void> {
  const target = platformTarget(process.platform, process.arch);
  const serverOut = join(BIN_DIR, `grove-server-${target.triple}${target.exeSuffix}`);
  // Keep BIN_DIR itself (tracked .gitkeep); stale binaries from other hosts are harmless.
  await mkdir(BIN_DIR, { recursive: true });
  await $`bun run --filter @grove/web build`;
  await rm(WEB_DIST, { recursive: true, force: true });
  await rm(NATIVES_DIR, { recursive: true, force: true });
  await mkdir(NATIVES_DIR, { recursive: true });
  await $`cp -R apps/web/dist ${WEB_DIST}`;
  await $`bun build --compile apps/server/src/index.ts --outfile ${serverOut} --external omp-legacy-pi-modules`;
  const addon = await findAddons(target.addonPattern);
  const copied: string[] = [];
  for (const file of addon.files) {
    const name = basename(file);
    await copyFile(file, join(NATIVES_DIR, name));
    // Also beside the sidecar: the loader probes `$EXEDIR` first, so a directly
    // run binary (CI smoke, `tauri dev`) needs no pre-provisioned cache.
    await copyFile(file, join(BIN_DIR, name));
    copied.push(name);
  }
  await Bun.write(
    join(NATIVES_DIR, 'natives-manifest.json'),
    JSON.stringify({ version: addon.version, files: copied }, null, 2),
  );
  console.log(
    `sidecar: ${serverOut}\nweb dist: ${WEB_DIST}\naddons: ${copied.join(', ')} (v${addon.version})`,
  );
}

// Resolve the updater endpoint first: `tauri build` (directly or via
// `dist:macos`) reads the config after this script returns.
if (import.meta.main) {
  const endpoint = updaterEndpoint();
  await writeUpdaterEndpoint(endpoint);
  console.log(`updater endpoint: ${endpoint}`);
  // `--dry-run` stops here, exercising the release config without the build.
  if (!process.argv.includes('--dry-run')) await main();
}
