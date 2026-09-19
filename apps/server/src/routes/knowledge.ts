import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { memoryEnqueue, memoryView } from '@ai-gui/omp-adapter';
import { SkillQuerySchema } from '@ai-gui/protocol';
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

/** GET /api/memory → { backend, summary? }. */
export async function getMemoryRoute(): Promise<{ backend: string; summary?: unknown }> {
  return memoryView();
}

/** POST /api/memory/enqueue → { ok }. */
export async function enqueueMemoryRoute(): Promise<{ ok: true }> {
  return memoryEnqueue();
}
