#!/usr/bin/env bun
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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

/**
 * The addon the compiled sidecar will accept: the version the SDK pin resolves
 * to. `node_modules/.bun` can hold several (a re-install leaves older ones in
 * place), and copying "whatever the glob matched last" once shipped an 18.2.7
 * addon into a bundle whose loader demanded 18.1.11 — the app then died on its
 * own error page with a sentinel mismatch. The pin lives in the SDK the sidecar
 * is compiled against, so read it from there instead of assuming our own
 * versions move in lockstep.
 */
export async function expectedNativesVersion(): Promise<string> {
  const { dependencies } = (await Bun.file('packages/omp-adapter/package.json').json()) as {
    dependencies?: Record<string, string>;
  };
  const sdkPin = dependencies?.['@oh-my-pi/pi-coding-agent'];
  if (!sdkPin) throw new Error('@grove/omp-adapter does not pin @oh-my-pi/pi-coding-agent');
  const glob = new Bun.Glob(
    `node_modules/.bun/@oh-my-pi+pi-coding-agent@${sdkPin}*/node_modules/@oh-my-pi/pi-coding-agent/package.json`,
  );
  for await (const match of glob.scan({ cwd: '.', dot: true })) {
    const sdk = (await Bun.file(match).json()) as { dependencies?: Record<string, string> };
    const natives = sdk.dependencies?.['@oh-my-pi/pi-natives'];
    if (natives) return natives;
  }
  throw new Error(`installed @oh-my-pi/pi-coding-agent@${sdkPin} not found`);
}

export async function findAddons(
  pattern: string,
  version: string,
): Promise<{ files: string[]; version: string }> {
  const glob = new Bun.Glob(`node_modules/.bun/**/${pattern}`);
  const files: string[] = [];
  for await (const match of glob.scan({ cwd: '.', dot: true })) {
    const pkg = (await Bun.file(join(match, '..', 'package.json')).json()) as {
      version?: string;
    };
    if (pkg.version === version) files.push(match);
  }
  if (files.length === 0) {
    throw new Error(`native addon ${pattern} not found for version ${version}`);
  }
  return { files, version };
}

/** The loader refuses an addon whose version sentinel does not match its own. */
async function assertSentinel(file: string, version: string): Promise<void> {
  const sentinel = `__piNativesV${version.replace(/\./g, '_')}`;
  const bytes = await Bun.file(file).arrayBuffer();
  if (!Buffer.from(bytes).includes(sentinel)) {
    throw new Error(`${file} does not expose ${sentinel}`);
  }
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
  await mkdir(dirname(WEB_DIST), { recursive: true });
  // node:fs/cp, not `cp -R`: the shell utility only exists on POSIX/Git Bash,
  // while a clean PowerShell has no `cp`.
  await cp('apps/web/dist', WEB_DIST, { recursive: true });
  await $`bun build --compile apps/server/src/index.ts --outfile ${serverOut} --external omp-legacy-pi-modules`;
  const addon = await findAddons(target.addonPattern, await expectedNativesVersion());
  const copied: string[] = [];
  for (const file of addon.files) {
    await assertSentinel(file, addon.version);
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
