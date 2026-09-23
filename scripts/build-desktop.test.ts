import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  expectedNativesVersion,
  findAddons,
  PLACEHOLDER_ENDPOINT,
  platformTarget,
  updaterEndpoint,
  writeUpdaterEndpoint,
} from './build-desktop';

// The tracked config is the fixture: the rewrite must not churn its formatting.
const CONFIG_FILE = join(import.meta.dir, '..', 'apps/desktop/src-tauri/tauri.conf.json');
const CONFIG = readFileSync(CONFIG_FILE, 'utf8');

describe('platformTarget', () => {
  test('maps darwin arm64', () => {
    expect(platformTarget('darwin', 'arm64')).toEqual({
      triple: 'aarch64-apple-darwin',
      addonPattern: 'pi_natives.darwin-arm64.node',
      exeSuffix: '',
    });
  });
  test('maps win32 x64 with exe suffix', () => {
    expect(platformTarget('win32', 'x64')).toEqual({
      triple: 'x86_64-pc-windows-msvc',
      addonPattern: 'pi_natives.win32-x64*.node',
      exeSuffix: '.exe',
    });
  });
  test('rejects unsupported', () => {
    expect(() => platformTarget('linux', 'x64')).toThrow(/unsupported platform/);
  });
});

describe('native addon selection', () => {
  test('picks the addon for the SDK pin, not a stale second copy', async () => {
    // node_modules can hold more than one pi-natives (a re-install leaves the old
    // one behind); copying the last glob match shipped an 18.2.7 addon into a
    // bundle whose loader required 18.1.11 and the app died on its error page.
    const version = await expectedNativesVersion();
    const target = platformTarget(process.platform, process.arch);
    const addon = await findAddons(target.addonPattern, version);

    expect(addon.files.length).toBeGreaterThan(0);
    for (const file of addon.files) {
      const bytes = readFileSync(file);
      const sentinel = `__piNativesV${version.replace(/\./g, '_')}`;
      expect(bytes.includes(sentinel)).toBe(true);
    }
  });
});

describe('updaterEndpoint', () => {
  const original = console.warn;
  afterEach(() => {
    console.warn = original;
  });

  test('takes the endpoint from GROVE_UPDATER_ENDPOINT', () => {
    const url = 'https://updates.grove.dev/grove/latest.json';
    expect(updaterEndpoint({ GROVE_UPDATER_ENDPOINT: url })).toBe(url);
  });

  test('falls back to the placeholder and warns when unset or blank', () => {
    console.warn = () => {};
    expect(updaterEndpoint({})).toBe(PLACEHOLDER_ENDPOINT);
    expect(updaterEndpoint({ GROVE_UPDATER_ENDPOINT: '   ' })).toBe(PLACEHOLDER_ENDPOINT);
  });

  test('the warning names the variable and the placeholder', () => {
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    updaterEndpoint({});
    const warning = warnings.join('\n');
    expect(warning).toContain('GROVE_UPDATER_ENDPOINT');
    expect(warning).toContain(PLACEHOLDER_ENDPOINT);
  });
});

describe('writeUpdaterEndpoint', () => {
  function tempConfig(): { dir: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'grove-build-desktop-'));
    const file = join(dir, 'tauri.conf.json');
    writeFileSync(file, CONFIG);
    return { dir, file };
  }

  test('sets endpoints[0] and leaves every other line untouched', async () => {
    const { dir, file } = tempConfig();
    try {
      const url = 'https://updates.grove.dev/grove/latest.json';
      await writeUpdaterEndpoint(url, file);
      const next = readFileSync(file, 'utf8');
      const parsed = JSON.parse(next) as { plugins: { updater: { endpoints: string[] } } };
      expect(parsed.plugins.updater.endpoints).toEqual([url]);
      const before = CONFIG.split('\n');
      const after = next.split('\n');
      expect(after).toHaveLength(before.length);
      expect(after.filter((line, lineIndex) => line !== before[lineIndex])).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws instead of building when the config has no endpoints array', async () => {
    const { dir, file } = tempConfig();
    try {
      writeFileSync(file, '{}\n');
      await expect(
        writeUpdaterEndpoint('https://updates.grove.dev/latest.json', file),
      ).rejects.toThrow(/endpoints/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
