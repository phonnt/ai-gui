import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { InvalidRequestError } from '@grove/agent-runtime';
import { resolveOrDefaultProjectRegistryPath } from '@oh-my-pi/pi-coding-agent/discovery/helpers';
import {
  getInstalledPluginsRegistryPath,
  getMarketplacesRegistryPath,
} from '@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/registry';
import { refreshDirsFromEnv } from '@oh-my-pi/pi-utils';
import { SdkAdapter } from './sdk.js';

/**
 * Marketplace browse/install/enable/upgrade, exercised against a **local**
 * marketplace fixture so nothing reaches the network.
 *
 * The SDK resolves the plugins registry from the omp *config root*
 * (`<home>/<PI_CONFIG_DIR>`), not from `PI_CODING_AGENT_DIR`. `PI_CONFIG_DIR` is
 * read live, so pointing it at a throwaway root and re-resolving the dirs keeps
 * the real `~/.omp` untouched. XDG would win over the config root, so the three
 * XDG vars are cleared for the duration and restored afterwards.
 */
const sandbox = mkdtempSync(join(tmpdir(), 'grove-market-'));
// A *name* (not a relative path): `PI_CONFIG_DIR` is joined onto every ancestor
// while the SDK hunts for the project `.omp/`, so a path with `..` segments
// would resolve back onto itself and alias the project and user registries.
const configDirName = `.grove-market-${basename(sandbox)}`;
const configRoot = join(homedir(), configDirName);
const cwd = join(sandbox, 'cwd');
const marketplaceRoot = join(sandbox, 'marketplace');
const catalogPath = join(marketplaceRoot, 'marketplace.json');

const previousConfigDir = process.env.PI_CONFIG_DIR;
const previousXdg = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
};

const catalog = (version: string) =>
  JSON.stringify({
    name: 'probe-mkt',
    owner: { name: 'Grove' },
    plugins: [
      {
        name: 'probe',
        source: './plugins/probe',
        description: 'Probe plugin',
        version,
      },
    ],
  });

beforeAll(() => {
  mkdirSync(cwd, { recursive: true });
  // Anchor the *project* config dir inside the sandbox. The SDK finds a project
  // root by walking up from cwd looking for this config dir, so an anchor here
  // wins on every platform; without it the walk on Windows runs past home (its
  // `~` guard compares path strings, and temp dirs arrive short-named) and aliases
  // the user registry — see the guard in `beforeEach`.
  mkdirSync(join(cwd, configDirName), { recursive: true });
  mkdirSync(join(marketplaceRoot, 'plugins', 'probe'), { recursive: true });
  writeFileSync(
    join(marketplaceRoot, 'plugins', 'probe', 'package.json'),
    JSON.stringify({ name: 'grove-probe-plugin', version: '1.2.3' }),
  );
  process.env.PI_CONFIG_DIR = configDirName;
  delete process.env.XDG_DATA_HOME;
  delete process.env.XDG_STATE_HOME;
  delete process.env.XDG_CACHE_HOME;
  refreshDirsFromEnv();
  // Guard the claim above: a config root that did not take would mean the test
  // is about to write into the user's real plugin registry.
  if (!getMarketplacesRegistryPath().startsWith(configRoot)) {
    throw new Error(`config root override failed: ${getMarketplacesRegistryPath()}`);
  }
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
  else process.env.PI_CONFIG_DIR = previousConfigDir;
  process.env.XDG_DATA_HOME = previousXdg.XDG_DATA_HOME;
  process.env.XDG_STATE_HOME = previousXdg.XDG_STATE_HOME;
  process.env.XDG_CACHE_HOME = previousXdg.XDG_CACHE_HOME;
  refreshDirsFromEnv();
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(configRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  const now = new Date().toISOString();
  writeFileSync(catalogPath, catalog('1.2.3'));
  const registryPath = getMarketplacesRegistryPath();
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(
    registryPath,
    JSON.stringify({
      version: 1,
      marketplaces: [
        {
          name: 'probe-mkt',
          sourceType: 'local',
          sourceUri: marketplaceRoot,
          catalogPath,
          addedAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  // Empty registries = nothing installed, in either scope. Resolve the project
  // path the way the SDK does rather than guessing where it lands.
  const projectRegistryPath = await resolveOrDefaultProjectRegistryPath(cwd);
  const userRegistryPath = getInstalledPluginsRegistryPath();
  if (projectRegistryPath === userRegistryPath) {
    // The SDK's ancestor walk stops at `os.homedir()` by string comparison, so a
    // path whose home segment is spelled differently (Windows temp dirs come back
    // as `C:\Users\RUNNER~1\…`) walks past home, finds the user config root and
    // hands back the *user* registry as the project one. That alias makes the
    // scope assertions below meaningless, so fail loudly instead of reporting
    // duplicate rows later. `beforeAll` anchors a project config dir inside the
    // sandbox to keep the walk local.
    throw new Error(`project and user plugin registries aliased: ${projectRegistryPath}`);
  }
  for (const registryFile of [userRegistryPath, projectRegistryPath]) {
    if (!registryFile) continue;
    mkdirSync(dirname(registryFile), { recursive: true });
    writeFileSync(registryFile, JSON.stringify({ version: 2, plugins: {} }));
  }
});

const adapter = () => new SdkAdapter(cwd);

describe('marketplace plugins', () => {
  test('lists the plugins a marketplace offers, tagged with the marketplace', async () => {
    const plugins = await adapter().listMarketplacePlugins();

    expect(Array.isArray(plugins)).toBe(true);
    expect(plugins).toEqual([
      {
        name: 'probe',
        marketplace: 'probe-mkt',
        description: 'Probe plugin',
        version: '1.2.3',
      },
    ]);
    expect(await adapter().listMarketplacePlugins('probe-mkt')).toEqual(plugins);
  });

  test('installs, lists, disables and uninstalls a plugin', async () => {
    const sdk = adapter();
    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([]);

    await sdk.installMarketplacePlugin({ pluginId: 'probe', marketplace: 'probe-mkt' });

    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([
      { id: 'probe@probe-mkt', scope: 'user', version: '1.2.3', enabled: true },
    ]);
    expect((await sdk.listPlugins()).some((plugin) => plugin.name === 'probe')).toBe(true);

    await sdk.setMarketplacePluginEnabled({ pluginId: 'probe@probe-mkt', enabled: false });
    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([
      { id: 'probe@probe-mkt', scope: 'user', version: '1.2.3', enabled: false },
    ]);
    expect((await sdk.listPlugins()).find((plugin) => plugin.name === 'probe')?.enabled).toBe(
      false,
    );

    await sdk.uninstallMarketplacePlugin({ pluginId: 'probe@probe-mkt' });
    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([]);
    expect((await sdk.listPlugins()).some((plugin) => plugin.name === 'probe')).toBe(false);
  });

  test('installs into project scope when asked', async () => {
    const sdk = adapter();
    await sdk.installMarketplacePlugin({
      pluginId: 'probe',
      marketplace: 'probe-mkt',
      scope: 'project',
    });

    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([
      { id: 'probe@probe-mkt', scope: 'project', version: '1.2.3', enabled: true },
    ]);

    await sdk.uninstallMarketplacePlugin({ pluginId: 'probe@probe-mkt', scope: 'project' });
    expect(await sdk.listInstalledMarketplacePlugins()).toEqual([]);
  });

  test('rejects unusable input before touching a registry', async () => {
    const sdk = adapter();

    const missing = await sdk
      .installMarketplacePlugin({ pluginId: '', marketplace: 'probe-mkt' })
      .catch((err: unknown) => err);
    expect(missing).toBeInstanceOf(InvalidRequestError);
    expect((missing as Error).message).toContain('pluginId');

    // The id form only matters for the verbs that take one; install takes the
    // name and the marketplace separately.
    const malformed = await sdk
      .uninstallMarketplacePlugin({ pluginId: 'probe' })
      .catch((err: unknown) => err);
    expect(malformed).toBeInstanceOf(InvalidRequestError);
    expect((malformed as Error).message).toContain('@<marketplace>');

    const badScope = await sdk
      .upgradeMarketplacePlugin({ pluginId: 'probe@' })
      .catch((err: unknown) => err);
    expect(badScope).toBeInstanceOf(InvalidRequestError);
  });

  test('surfaces an unknown marketplace instead of installing nothing', async () => {
    await expect(
      adapter().installMarketplacePlugin({ pluginId: 'probe', marketplace: 'nope' }),
    ).rejects.toThrow('Marketplace "nope" not found');
  });

  test('reports an update, then upgrades the plugin to the catalog version', async () => {
    const sdk = adapter();
    await sdk.installMarketplacePlugin({ pluginId: 'probe', marketplace: 'probe-mkt' });
    expect(await sdk.pluginUpdates()).toEqual([]);

    writeFileSync(catalogPath, catalog('2.0.0'));

    expect(await sdk.pluginUpdates()).toEqual([
      { pluginId: 'probe@probe-mkt', scope: 'user', from: '1.2.3', to: '2.0.0' },
    ]);

    expect(await sdk.upgradeMarketplacePlugin({ pluginId: 'probe@probe-mkt' })).toEqual({
      pluginId: 'probe@probe-mkt',
      version: '2.0.0',
    });
    expect(await sdk.pluginUpdates()).toEqual([]);
    expect((await sdk.listInstalledMarketplacePlugins())[0]?.version).toBe('2.0.0');
  });
});
