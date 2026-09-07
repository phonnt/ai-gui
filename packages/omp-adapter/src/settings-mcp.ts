import { getAgentDir } from '@oh-my-pi/pi-coding-agent';
import { loadAllMCPConfigs, validateServerConfig } from '@oh-my-pi/pi-coding-agent/mcp/config';
import { MCPManager } from '@oh-my-pi/pi-coding-agent/mcp/manager';

/**
 * P4 MCP plane (SDK-direct, out-of-turn).
 *
 * Listing is connect-free: configs come from `loadAllMCPConfigs` and status
 * from a cached `MCPManager` that never auto-discovers, so `getConnectionStatus`
 * only ever reports live state without dialing servers. Explicit actions
 * (test/reconnect/reload) dial on purpose.
 */

export interface McpScope {
  cwd: string;
  agentDir?: string;
}

export type McpStatus = 'connected' | 'connecting' | 'disconnected';

export interface McpServerEntry {
  name: string;
  status: McpStatus;
  transport: string;
  tools?: number;
}

export interface McpActionResult {
  ok: boolean;
  detail?: string;
}

/** `test` dial timeout: a hung stdio spawn / SSE endpoint must not hang the route. */
export const MCP_TEST_TIMEOUT_MS = 15_000;

const managers = new Map<string, MCPManager>();

function scopeOf(options?: Partial<McpScope>): Required<McpScope> {
  return {
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? getAgentDir(),
  };
}

function scopeKey(scope: Required<McpScope>): string {
  return `${scope.cwd}	${scope.agentDir}`;
}

/** Cached manager; constructed without discovery so listing never connects. */
export function mcpManager(options?: Partial<McpScope>): MCPManager {
  const key = scopeKey(scopeOf(options));
  let manager = managers.get(key);
  if (!manager) {
    manager = new MCPManager(scopeOf(options).cwd);
    managers.set(key, manager);
  }
  return manager;
}

/** Test-only: drop cached managers. */
export function resetMcpForTest(): void {
  managers.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function transportOf(config: { type?: string }): string {
  return config.type ?? 'stdio';
}

/** All configured servers with live status; never initiates connections. */
export async function mcpList(options?: Partial<McpScope>): Promise<McpServerEntry[]> {
  const scope = scopeOf(options);
  const manager = mcpManager(options);
  const { configs } = await loadAllMCPConfigs(scope.cwd);
  const names = new Set([...Object.keys(configs), ...manager.getAllServerNames()]);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const status = manager.getConnectionStatus(name);
      const connection = manager.getConnection(name);
      const config = connection?.config ?? configs[name];
      const entry: McpServerEntry = {
        name,
        status,
        transport: config ? transportOf(config) : 'unknown',
      };
      const toolCount =
        connection?.tools?.length ??
        manager.getTools().filter((t) => t.mcpServerName === name).length;
      if (status === 'connected') entry.tools = toolCount;
      return entry;
    });
}

async function mcpConfigOrThrow(scope: Required<McpScope>, name: string) {
  const { configs, sources } = await loadAllMCPConfigs(scope.cwd);
  const config = configs[name];
  if (!config) throw new Error(`unknown mcp server: ${name}`);
  return { config, source: sources[name] };
}

/**
 * Explicit connect check: validates config, then dials just this server with
 * a timeout. Returns `{ ok: false }` (never throws) for dial failures.
 */
export async function mcpTest(name: string, options?: Partial<McpScope>): Promise<McpActionResult> {
  const scope = scopeOf(options);
  const manager = mcpManager(options);
  const { config, source } = await mcpConfigOrThrow(scope, name);
  if (manager.getConnectionStatus(name) === 'connected') {
    return { ok: true, detail: 'already connected' };
  }
  const problems = validateServerConfig(name, config);
  if (problems.length > 0) return { ok: false, detail: problems.join('; ') };
  try {
    const result = await withTimeout(
      manager.connectServers({ [name]: config }, source ? { [name]: source } : {}),
      MCP_TEST_TIMEOUT_MS,
      `mcp test ${name}`,
    );
    const error = result.errors.get(name);
    if (error) return { ok: false, detail: error };
    return result.connectedServers.includes(name)
      ? { ok: true, detail: 'connected' }
      : { ok: false, detail: 'connect returned without establishing the server' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Manual reconnect through the manager (burst-breaker reset); null = failed/suspended. */
export async function mcpReconnect(
  name: string,
  options?: Partial<McpScope>,
): Promise<McpActionResult> {
  const scope = scopeOf(options);
  const manager = mcpManager(options);
  await mcpConfigOrThrow(scope, name);
  try {
    const connection = await withTimeout(
      manager.reconnectServer(name, { manual: true }),
      MCP_TEST_TIMEOUT_MS,
      `mcp reconnect ${name}`,
    );
    return connection
      ? { ok: true, detail: 'reconnected' }
      : { ok: false, detail: 'reconnect failed or suspended by the crash breaker' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Refresh the tool catalog of a connected server. */
export async function mcpReload(
  name: string,
  options?: Partial<McpScope>,
): Promise<McpActionResult> {
  const scope = scopeOf(options);
  const manager = mcpManager(options);
  await mcpConfigOrThrow(scope, name);
  if (manager.getConnectionStatus(name) !== 'connected') {
    return { ok: false, detail: 'server is not connected' };
  }
  try {
    await withTimeout(manager.refreshServerTools(name), MCP_TEST_TIMEOUT_MS, `mcp reload ${name}`);
    return { ok: true, detail: 'tools refreshed' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
