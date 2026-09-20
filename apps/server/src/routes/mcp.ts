import type { McpStatus } from '@grove/omp-adapter';
import {
  type McpToolEntry,
  mcpList,
  mcpReconnect,
  mcpReload,
  mcpTest,
  mcpTools,
} from '@grove/omp-adapter';
import { HttpError } from './errors.js';

/** GET /api/mcp → { servers }. */
export async function listMcpRoute(): Promise<{
  servers: { name: string; status: McpStatus; transport: string; tools?: number }[];
}> {
  return { servers: await mcpList() };
}

/** POST /api/mcp/:name/test|reconnect|reload → { ok, detail? }. */
export async function mcpActionRoute(
  name: string,
  action: string,
): Promise<{ ok: boolean; detail?: string }> {
  const server = decodeURIComponent(name);
  try {
    if (action === 'test') return await mcpTest(server);
    if (action === 'reconnect') return await mcpReconnect(server);
    if (action === 'reload') return await mcpReload(server);
    throw new HttpError(404, `unknown mcp action: ${action}`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown mcp server:')) throw new HttpError(404, message);
    throw new HttpError(500, message);
  }
}

/**
 * GET /api/mcp/tools[?server=name][?discover=true] → { tools }. Without
 * `discover` this reports tools from servers already connected, so the pane
 * never blocks on a cold start.
 */
export async function listMcpToolsRoute(query: {
  server?: string;
  discover?: string;
}): Promise<{ tools: McpToolEntry[] }> {
  return {
    tools: await mcpTools(query.server, { discover: query.discover === 'true' }),
  };
}
