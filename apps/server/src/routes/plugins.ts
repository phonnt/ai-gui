import { type AgentRuntime, InvalidRequestError } from '@grove/agent-runtime';
import {
  type InstalledMarketplacePluginDto,
  MarketplaceInstallSchema,
  type MarketplaceInstallResponseDto,
  type MarketplacePluginDto,
  MarketplacePluginEnabledSchema,
  type MarketplacePluginUpdateDto,
  MarketplacePluginTargetSchema,
} from '@grove/protocol';
import type { ZodError } from 'zod';
import { errorMessage, HttpError } from './errors.js';

/** GET /api/plugins → { plugins } (TUI `/plugins list`). */
export async function listPluginsRoute(runtime: AgentRuntime): Promise<{ plugins: unknown }> {
  return { plugins: await runtime.listPlugins() };
}

/** GET /api/extensions → { extensions } (TUI `/extensions`). */
export async function listExtensionsRoute(runtime: AgentRuntime): Promise<{ extensions: unknown }> {
  return { extensions: await runtime.listExtensions() };
}

/**
 * Marketplace work reads registries and plugin sources outside this process, so
 * a failure there is a bad gateway — not a bug in the request. Input the
 * adapter rejected itself is a 400.
 */
async function upstream<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof InvalidRequestError) throw new HttpError(400, err.message);
    throw new HttpError(502, errorMessage(err));
  }
}

/** The raw zod dump is unreadable in a toast; name the field that failed. */
function invalidBody(error: ZodError): HttpError {
  const issue = error.issues[0];
  const field = issue?.path.join('.') ?? 'body';
  return new HttpError(400, `invalid marketplace request: ${field} ${issue?.message ?? 'is invalid'}`);
}

/** GET /api/marketplace/plugins[?marketplace=] → { plugins }. */
export async function listMarketplacePluginsRoute(
  runtime: AgentRuntime,
  query: Record<string, string | undefined>,
): Promise<{ plugins: MarketplacePluginDto[] }> {
  return { plugins: await upstream(() => runtime.listMarketplacePlugins(query.marketplace)) };
}

/** POST /api/marketplace/install { pluginId, marketplace, scope? } → { pluginId, version }. */
export async function installMarketplacePluginRoute(
  runtime: AgentRuntime,
  body: unknown,
): Promise<MarketplaceInstallResponseDto> {
  const parsed = MarketplaceInstallSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error);
  return upstream(() => runtime.installMarketplacePlugin(parsed.data));
}

/** GET /api/plugins/marketplace/installed → { plugins }. */
export async function listInstalledMarketplacePluginsRoute(
  runtime: AgentRuntime,
): Promise<{ plugins: InstalledMarketplacePluginDto[] }> {
  return { plugins: await upstream(() => runtime.listInstalledMarketplacePlugins()) };
}

/** POST /api/plugins/marketplace/:id/enabled { enabled, scope? } → { plugins }. */
export async function setMarketplacePluginEnabledRoute(
  runtime: AgentRuntime,
  pluginId: string,
  body: unknown,
): Promise<{ plugins: InstalledMarketplacePluginDto[] }> {
  const parsed = MarketplacePluginEnabledSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error);
  await upstream(() => runtime.setMarketplacePluginEnabled({ pluginId, ...parsed.data }));
  return { plugins: await runtime.listInstalledMarketplacePlugins() };
}

/** POST /api/plugins/marketplace/:id/uninstall { scope? } → { plugins }. */
export async function uninstallMarketplacePluginRoute(
  runtime: AgentRuntime,
  pluginId: string,
  body: unknown,
): Promise<{ plugins: InstalledMarketplacePluginDto[] }> {
  const parsed = MarketplacePluginTargetSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidBody(parsed.error);
  await upstream(() => runtime.uninstallMarketplacePlugin({ pluginId, ...parsed.data }));
  return { plugins: await runtime.listInstalledMarketplacePlugins() };
}

/** GET /api/plugins/marketplace/updates → { updates }. */
export async function listPluginUpdatesRoute(
  runtime: AgentRuntime,
): Promise<{ updates: MarketplacePluginUpdateDto[] }> {
  return { updates: await upstream(() => runtime.pluginUpdates()) };
}

/** POST /api/plugins/marketplace/:id/upgrade { scope? } → { pluginId, version }. */
export async function upgradeMarketplacePluginRoute(
  runtime: AgentRuntime,
  pluginId: string,
  body: unknown,
): Promise<MarketplaceInstallResponseDto> {
  const parsed = MarketplacePluginTargetSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidBody(parsed.error);
  return upstream(() => runtime.upgradeMarketplacePlugin({ pluginId, ...parsed.data }));
}
