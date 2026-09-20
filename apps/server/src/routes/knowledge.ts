import type { AgentRuntime, MemoryOpResult, MemoryState } from '@grove/agent-runtime';
import { MemoryBackendSchema, MemoryOpSchema, SkillQuerySchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/**
 * Skills routes are session-scoped: the inventory must be the one the live
 * session loaded (per-source enable flags, custom dirs, plugins), or the pane
 * disagrees with what the agent can actually invoke.
 */

/** GET /api/sessions/:id/skills → { skills }. */
export async function sessionSkillsRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ skills: unknown }> {
  return { skills: await runtime.getSessionSkills(sessionId) };
}

/** GET /api/sessions/:id/skills/:name?path → { content }. */
export async function sessionSkillContentRoute(
  runtime: AgentRuntime,
  sessionId: string,
  name: string,
  query: Record<string, string | undefined>,
): Promise<{ content: string }> {
  const parsed = SkillQuerySchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return await runtime.getSessionSkillContent({
      sessionId,
      name: decodeURIComponent(name),
      ...(parsed.data.path ? { path: parsed.data.path } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown skill:')) throw new HttpError(404, message);
    if (message.startsWith('path escapes') || message.startsWith('not a file:')) {
      throw new HttpError(400, message);
    }
    throw new HttpError(500, message);
  }
}

/**
 * GET /api/sessions/:id/memory → { backend, status }.
 * Session-scoped: memory backends key their state off the live session, so a
 * process-scoped view reports "not initialised" for mnemopi/hindsight.
 */
export async function getMemoryRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<MemoryState> {
  return runtime.getMemory(sessionId);
}

/** POST /api/sessions/:id/memory { op, query?, limit? } → { backend, result }. */
export async function memoryOpRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<MemoryOpResult> {
  const parsed = MemoryOpSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return await runtime.runMemoryOp({
      sessionId,
      op: parsed.data.op,
      ...(parsed.data.query !== undefined ? { query: parsed.data.query } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unsupported memory op') || message.includes('does not support')) {
      throw new HttpError(400, message);
    }
    throw err;
  }
}

/** POST /api/sessions/:id/memory/backend { backend } → { backend, status }. */
export async function setMemoryBackendRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<MemoryState> {
  const parsed = MemoryBackendSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return runtime.setMemoryBackend({ sessionId, backend: parsed.data.backend });
}
