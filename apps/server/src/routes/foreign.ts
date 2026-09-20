import type { AgentRuntime, ForeignSession } from '@ai-gui/agent-runtime';
import type { SessionInfo } from '@ai-gui/core';
import { ForeignSessionImportSchema, ForeignSessionSourceSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/foreign-sessions?source=claude|codex → { sessions }. */
export async function listForeignSessionsRoute(
  runtime: AgentRuntime,
  query: Record<string, string | undefined>,
): Promise<{ sessions: ForeignSession[] }> {
  const parsed = ForeignSessionSourceSchema.safeParse(query.source ?? 'codex');
  if (!parsed.success) throw new HttpError(400, 'source must be claude or codex');
  try {
    return { sessions: await runtime.listForeignSessions(parsed.data) };
  } catch (err) {
    throw new HttpError(500, err instanceof Error ? err.message : String(err));
  }
}

/** POST /api/foreign-sessions/import { source, path } → { session }. */
export async function importForeignSessionRoute(
  runtime: AgentRuntime,
  body: unknown,
): Promise<{ session: SessionInfo }> {
  const parsed = ForeignSessionImportSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    const session = await runtime.importForeignSession({
      source: parsed.data.source,
      path: parsed.data.path,
      ...(parsed.data.fallbackCwd !== undefined ? { fallbackCwd: parsed.data.fallbackCwd } : {}),
    });
    return { session };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('session not found')) throw new HttpError(404, message);
    throw new HttpError(500, message);
  }
}
