import { describe, expect, test } from 'bun:test';
import { type AgentRuntime, InvalidRequestError } from '@grove/agent-runtime';
import { HttpError } from './errors.js';
import {
  installMarketplacePluginRoute,
  listInstalledMarketplacePluginsRoute,
  listMarketplacePluginsRoute,
  listPluginUpdatesRoute,
  setMarketplacePluginEnabledRoute,
  uninstallMarketplacePluginRoute,
  upgradeMarketplacePluginRoute,
} from './plugins.js';

const plugin = { name: 'probe', marketplace: 'probe-mkt', version: '1.2.3' };
const installed = { id: 'probe@probe-mkt', scope: 'user' as const, version: '1.2.3', enabled: true };

function fakeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    listMarketplacePlugins: async () => [plugin],
    installMarketplacePlugin: async () => ({ pluginId: 'probe@probe-mkt', version: '1.2.3' }),
    listInstalledMarketplacePlugins: async () => [installed],
    setMarketplacePluginEnabled: async () => undefined,
    uninstallMarketplacePlugin: async () => undefined,
    pluginUpdates: async () => [],
    upgradeMarketplacePlugin: async () => ({ pluginId: 'probe@probe-mkt', version: '2.0.0' }),
    ...overrides,
  } as unknown as AgentRuntime;
}

async function statusOf(run: () => Promise<unknown>): Promise<HttpError> {
  const err: unknown = await run().catch((caught: unknown) => caught);
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe('marketplace routes', () => {
  test('lists available plugins, optionally for one marketplace', async () => {
    const runtime = fakeRuntime({
      listMarketplacePlugins: async (marketplace?: string) => [
        { ...plugin, marketplace: marketplace ?? plugin.marketplace },
      ],
    });

    expect(await listMarketplacePluginsRoute(runtime, {})).toEqual({ plugins: [plugin] });
    expect(await listMarketplacePluginsRoute(runtime, { marketplace: 'other' })).toEqual({
      plugins: [{ ...plugin, marketplace: 'other' }],
    });
  });

  test('installs a plugin and answers the resulting id and version', async () => {
    let seen: unknown;
    const runtime = fakeRuntime({
      installMarketplacePlugin: async (input) => {
        seen = input;
        return { pluginId: 'probe@probe-mkt', version: '1.2.3' };
      },
    });

    expect(
      await installMarketplacePluginRoute(runtime, { pluginId: 'probe', marketplace: 'probe-mkt' }),
    ).toEqual({ pluginId: 'probe@probe-mkt', version: '1.2.3' });
    expect(seen).toEqual({ pluginId: 'probe', marketplace: 'probe-mkt' });
  });

  test('a request without a plugin id is a bad request', async () => {
    const err = await statusOf(() =>
      installMarketplacePluginRoute(fakeRuntime(), { marketplace: 'probe-mkt' }),
    );

    expect(err.status).toBe(400);
    expect(err.message).toContain('pluginId');
  });

  test('an unusable scope is a bad request', async () => {
    const err = await statusOf(() =>
      setMarketplacePluginEnabledRoute(fakeRuntime(), 'probe@probe-mkt', {
        enabled: true,
        scope: 'global',
      }),
    );

    expect(err.status).toBe(400);
    expect(err.message).toContain('scope');
  });

  test('a marketplace failure is a bad gateway carrying its message', async () => {
    const runtime = fakeRuntime({
      installMarketplacePlugin: async () => {
        throw new Error('Marketplace "nope" not found');
      },
    });

    const err = await statusOf(() =>
      installMarketplacePluginRoute(runtime, { pluginId: 'probe', marketplace: 'nope' }),
    );

    expect(err.status).toBe(502);
    expect(err.message).toBe('Marketplace "nope" not found');
  });

  test('input the adapter rejects stays a bad request', async () => {
    const runtime = fakeRuntime({
      uninstallMarketplacePlugin: async () => {
        throw new InvalidRequestError('pluginId must be "<name>@<marketplace>"');
      },
    });

    const err = await statusOf(() => uninstallMarketplacePluginRoute(runtime, 'probe', {}));

    expect(err.status).toBe(400);
  });

  test('enabling answers the refreshed installed list', async () => {
    let seen: unknown;
    const runtime = fakeRuntime({
      setMarketplacePluginEnabled: async (input) => {
        seen = input;
      },
      listInstalledMarketplacePlugins: async () => [{ ...installed, enabled: false }],
    });

    expect(
      await setMarketplacePluginEnabledRoute(runtime, 'probe@probe-mkt', { enabled: false }),
    ).toEqual({ plugins: [{ ...installed, enabled: false }] });
    expect(seen).toEqual({ pluginId: 'probe@probe-mkt', enabled: false });
  });

  test('uninstall, updates and upgrade reach the runtime', async () => {
    const calls: string[] = [];
    const runtime = fakeRuntime({
      uninstallMarketplacePlugin: async (input) => {
        calls.push(`uninstall ${input.pluginId} scope=${input.scope}`);
      },
      pluginUpdates: async () => [
        { pluginId: 'probe@probe-mkt', scope: 'user', from: '1.2.3', to: '2.0.0' },
      ],
      upgradeMarketplacePlugin: async (input) => {
        calls.push(`upgrade ${input.pluginId}`);
        return { pluginId: input.pluginId, version: '2.0.0' };
      },
      listInstalledMarketplacePlugins: async () => [],
    });

    expect(await uninstallMarketplacePluginRoute(runtime, 'probe@probe-mkt', { scope: 'user' }))
      .toEqual({ plugins: [] });
    expect(await listPluginUpdatesRoute(runtime)).toEqual({
      updates: [{ pluginId: 'probe@probe-mkt', scope: 'user', from: '1.2.3', to: '2.0.0' }],
    });
    expect(await upgradeMarketplacePluginRoute(runtime, 'probe@probe-mkt', {})).toEqual({
      pluginId: 'probe@probe-mkt',
      version: '2.0.0',
    });
    expect(await listInstalledMarketplacePluginsRoute(runtime)).toEqual({ plugins: [] });
    expect(calls).toEqual(['uninstall probe@probe-mkt scope=user', 'upgrade probe@probe-mkt']);
  });
});
