import {
  type CommandInfoDto,
  CommandsResponseSchema,
  type ExtensionEntryDto,
  ExtensionsResponseSchema,
  type InstalledMarketplacePluginDto,
  InstalledMarketplacePluginsResponseSchema,
  type MarketplaceInstallDto,
  type MarketplaceInstallResponseDto,
  MarketplaceInstallResponseSchema,
  type MarketplacePluginDto,
  type MarketplacePluginEnabledDto,
  MarketplacePluginsResponseSchema,
  type MarketplacePluginTargetDto,
  type MarketplacePluginUpdateDto,
  MarketplacePluginUpdatesResponseSchema,
  type McpActionDto,
  type McpActionResponseDto,
  McpActionResponseSchema,
  McpListResponseSchema,
  type McpServerEntryDto,
  type McpToolEntryDto,
  McpToolsResponseSchema,
  type MemoryBackendDto,
  type MemoryOpDto,
  type MemoryOpResultDto,
  MemoryOpResultSchema,
  type MemoryStateDto,
  MemoryStateSchema,
  type ModelEntryDto,
  type ModelRoleEntryDto,
  ModelRolesResponseSchema,
  ModelsResponseSchema,
  type PluginEntryDto,
  PluginsResponseSchema,
  type ProviderEntryDto,
  ProvidersResponseSchema,
  type SettingEntryDto,
  type SettingResetResponseDto,
  SettingResetResponseSchema,
  type SettingResponseDto,
  SettingResponseSchema,
  SettingsListResponseSchema,
  SshHostsResponseSchema,
  type ThemeApplyResponseDto,
  ThemeApplyResponseSchema,
  type ThemeListResponseDto,
  ThemeListResponseSchema,
} from '@grove/protocol';

import { call, type Result, sessionPath, unwrapEnvelope, withBody, withJson } from './core';

export type SettingsEntry = SettingEntryDto;

export type SettingValue = SettingResponseDto;

export type SettingResetResult = SettingResetResponseDto;

export type ThemesState = ThemeListResponseDto;

export type ModelInfo = ModelEntryDto;

export type ProviderInfo = ProviderEntryDto;

export type McpServerInfo = McpServerEntryDto;

export type McpActionResult = McpActionResponseDto;

export type MemoryState = MemoryStateDto;

/** Tool count advertised by an MCP server (protocol: optional non-negative int). */

export function mcpToolCount(server: McpServerInfo): number | null {
  return server.tools ?? null;
}

/** Renderable text for a memory summary (protocol: unknown, usually string). */
/** Human-readable text for a backend payload (string passthrough, else JSON). */

export function memoryText(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, null, 1) ?? null;
  } catch {
    return null;
  }
}

/** GET /api/settings → {entries}. */

export function listSettings(): Promise<Result<SettingsEntry[]>> {
  return unwrapEnvelope(call('/api/settings', SettingsListResponseSchema), 'entries');
}

/** GET /api/settings/:key → {key,value}. */

export function getSetting(key: string): Promise<Result<SettingValue>> {
  return call(`/api/settings/${encodeURIComponent(key)}`, SettingResponseSchema);
}

/** PUT /api/settings/:key {value} → {key,value}. */

export function putSetting(key: string, value: unknown): Promise<Result<SettingValue>> {
  return call(
    `/api/settings/${encodeURIComponent(key)}`,
    SettingResponseSchema,
    withJson('PUT', { value }),
  );
}

/** DELETE /api/settings/:key → {key,value,reset:true}. */

export function resetSetting(key: string): Promise<Result<SettingResetResult>> {
  return call(
    `/api/settings/${encodeURIComponent(key)}`,
    SettingResetResponseSchema,
    withJson('DELETE'),
  );
}

/** GET /api/themes → {themes,current}. */

export function listThemes(): Promise<Result<ThemesState>> {
  return call('/api/themes', ThemeListResponseSchema);
}

/** POST /api/themes/apply {name} → {current}. */

export function applyTheme(
  name: string,
  slot: 'dark' | 'light' = 'dark',
): Promise<Result<ThemeApplyResponseDto>> {
  return call('/api/themes/apply', ThemeApplyResponseSchema, withJson('POST', { name, slot }));
}

/** GET /api/models → {models}. */

export function listModels(): Promise<Result<ModelInfo[]>> {
  return unwrapEnvelope(call('/api/models', ModelsResponseSchema), 'models');
}

/** GET /api/providers → {providers}. */
/** GET /api/model-roles → { roles }. */

export function listModelRoles(): Promise<Result<ModelRoleEntryDto[]>> {
  return unwrapEnvelope(call('/api/model-roles', ModelRolesResponseSchema), 'roles');
}

/** PUT /api/model-roles/:role { model } → { roles }. Empty clears the role. */

export function setModelRole(role: string, model: string): Promise<Result<ModelRoleEntryDto[]>> {
  return unwrapEnvelope(
    call(
      `/api/model-roles/${encodeURIComponent(role)}`,
      ModelRolesResponseSchema,
      withBody({ model }),
    ),
    'roles',
  );
}

export function listProviders(): Promise<Result<ProviderInfo[]>> {
  return unwrapEnvelope(call('/api/providers', ProvidersResponseSchema), 'providers');
}

/** GET /api/mcp → {servers}. */

export function listMcpServers(): Promise<Result<McpServerInfo[]>> {
  return unwrapEnvelope(call('/api/mcp', McpListResponseSchema), 'servers');
}

export function mcpActionPath(name: string, action: McpActionDto): string {
  return `/api/mcp/${encodeURIComponent(name)}/${action}`;
}

/** GET /api/mcp/tools[?server][?discover] → tools from MCP servers. */

export function listMcpTools(
  server?: string,
  discover?: boolean,
): Promise<Result<McpToolEntryDto[]>> {
  const params = new URLSearchParams();
  if (server) params.set('server', server);
  if (discover) params.set('discover', 'true');
  const qs = params.toString();
  return unwrapEnvelope(
    call<{ tools: McpToolEntryDto[] }>(
      `/api/mcp/tools${qs ? `?${qs}` : ''}`,
      McpToolsResponseSchema,
    ),
    'tools',
  );
}

/** POST /api/mcp/:name/test → {ok,detail?}. */

export function testMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'test'), McpActionResponseSchema, withJson('POST', {}));
}

/** POST /api/mcp/:name/reconnect → {ok,detail?}. */

export function reconnectMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'reconnect'), McpActionResponseSchema, withJson('POST', {}));
}

/** POST /api/mcp/:name/reload → {ok,detail?}. */

export function reloadMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'reload'), McpActionResponseSchema, withJson('POST', {}));
}

/** GET /api/skills → {skills}. */
/** GET /api/sessions/:id/skills → the live session's skill inventory. */

export function getMemory(sessionId: string): Promise<Result<MemoryState>> {
  return call(sessionPath(sessionId, '/memory'), MemoryStateSchema);
}

/** POST /api/sessions/:id/memory { op, query?, limit? } → {backend,result}. */

export function runMemoryOp(
  sessionId: string,
  op: MemoryOpDto['op'],
  options?: { query?: string; limit?: number },
): Promise<Result<MemoryOpResultDto>> {
  return call(
    sessionPath(sessionId, '/memory'),
    MemoryOpResultSchema,
    withJson('POST', {
      op,
      ...(options?.query !== undefined ? { query: options.query } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    }),
  );
}

/** POST /api/sessions/:id/memory/backend { backend } → {backend,status}. */

export function setMemoryBackend(
  sessionId: string,
  backend: MemoryBackendDto['backend'],
): Promise<Result<MemoryState>> {
  return call(
    sessionPath(sessionId, '/memory/backend'),
    MemoryStateSchema,
    withJson('POST', { backend }),
  );
}

export type SlashCommand = CommandInfoDto;

/** GET /api/commands?cwd= → {commands}. Built-ins plus discovered file commands. */

export function listCommands(cwd?: string): Promise<Result<SlashCommand[]>> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  return unwrapEnvelope(call(`/api/commands${qs}`, CommandsResponseSchema), 'commands');
}

export function listPlugins(): Promise<Result<PluginEntryDto[]>> {
  return unwrapEnvelope(
    call<{ plugins: PluginEntryDto[] }>('/api/plugins', PluginsResponseSchema),
    'plugins',
  );
}

/** GET /api/extensions → { extensions } (TUI `/extensions`). */

export function listExtensions(): Promise<Result<ExtensionEntryDto[]>> {
  return unwrapEnvelope(
    call<{ extensions: ExtensionEntryDto[] }>('/api/extensions', ExtensionsResponseSchema),
    'extensions',
  );
}

/** GET /api/marketplace/plugins[?marketplace] → { plugins }. */
export function listMarketplacePlugins(
  marketplace?: string,
): Promise<Result<MarketplacePluginDto[]>> {
  const qs = marketplace ? `?marketplace=${encodeURIComponent(marketplace)}` : '';
  return unwrapEnvelope(
    call<{ plugins: MarketplacePluginDto[] }>(
      `/api/marketplace/plugins${qs}`,
      MarketplacePluginsResponseSchema,
    ),
    'plugins',
  );
}

/** POST /api/marketplace/install → { pluginId, version }. */
export function installMarketplacePlugin(
  input: MarketplaceInstallDto,
): Promise<Result<MarketplaceInstallResponseDto>> {
  return call(
    '/api/marketplace/install',
    MarketplaceInstallResponseSchema,
    withJson('POST', input),
  );
}

/** GET /api/plugins/marketplace/installed → { plugins }. */
export function listInstalledMarketplacePlugins(): Promise<
  Result<InstalledMarketplacePluginDto[]>
> {
  return unwrapEnvelope(
    call<{ plugins: InstalledMarketplacePluginDto[] }>(
      '/api/plugins/marketplace/installed',
      InstalledMarketplacePluginsResponseSchema,
    ),
    'plugins',
  );
}

/** POST /api/plugins/marketplace/:id/enabled → the refreshed installed list. */
export function setMarketplacePluginEnabled(
  pluginId: string,
  input: MarketplacePluginEnabledDto,
): Promise<Result<InstalledMarketplacePluginDto[]>> {
  return unwrapEnvelope(
    call<{ plugins: InstalledMarketplacePluginDto[] }>(
      `/api/plugins/marketplace/${encodeURIComponent(pluginId)}/enabled`,
      InstalledMarketplacePluginsResponseSchema,
      withJson('POST', input),
    ),
    'plugins',
  );
}

/** POST /api/plugins/marketplace/:id/uninstall → the refreshed installed list. */
export function uninstallMarketplacePlugin(
  pluginId: string,
  input: MarketplacePluginTargetDto = {},
): Promise<Result<InstalledMarketplacePluginDto[]>> {
  return unwrapEnvelope(
    call<{ plugins: InstalledMarketplacePluginDto[] }>(
      `/api/plugins/marketplace/${encodeURIComponent(pluginId)}/uninstall`,
      InstalledMarketplacePluginsResponseSchema,
      withJson('POST', input),
    ),
    'plugins',
  );
}

/** GET /api/plugins/marketplace/updates → { updates }. */
export function listPluginUpdates(): Promise<Result<MarketplacePluginUpdateDto[]>> {
  return unwrapEnvelope(
    call<{ updates: MarketplacePluginUpdateDto[] }>(
      '/api/plugins/marketplace/updates',
      MarketplacePluginUpdatesResponseSchema,
    ),
    'updates',
  );
}

/** POST /api/plugins/marketplace/:id/upgrade → { pluginId, version }. */
export function upgradeMarketplacePlugin(
  pluginId: string,
  input: MarketplacePluginTargetDto = {},
): Promise<Result<MarketplaceInstallResponseDto>> {
  return call(
    `/api/plugins/marketplace/${encodeURIComponent(pluginId)}/upgrade`,
    MarketplaceInstallResponseSchema,
    withJson('POST', input),
  );
}

/** POST /api/sessions/:id/ask { question } → { reply } (ephemeral, TUI `/btw`). */

/** GET /api/sessions/:id/ssh?scope= → { hosts }. */
export function listSshHosts(
  sessionId: string,
  scope: 'user' | 'project',
): Promise<Result<{ hosts: string[] }>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/ssh?scope=${scope}`,
    SshHostsResponseSchema,
  );
}

/** POST /api/sessions/:id/ssh → { hosts }. */
export function addSshHost(
  sessionId: string,
  input: { scope: 'user' | 'project'; name: string; host: string; user?: string; port?: number },
): Promise<Result<{ hosts: string[] }>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/ssh`,
    SshHostsResponseSchema,
    withJson('POST', input),
  );
}

/** DELETE /api/sessions/:id/ssh?scope=&name= → { hosts }. */
export function removeSshHost(
  sessionId: string,
  scope: 'user' | 'project',
  name: string,
): Promise<Result<{ hosts: string[] }>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/ssh?scope=${scope}&name=${encodeURIComponent(name)}`,
    SshHostsResponseSchema,
    { method: 'DELETE' },
  );
}
