import type { McpStatus } from '@ai-gui/omp-adapter';
import { mcpList, mcpReconnect, mcpReload, mcpTest } from '@ai-gui/omp-adapter';
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
