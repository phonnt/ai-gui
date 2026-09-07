import { memoryEnqueue, memoryView, skillRead, skillsList } from '@ai-gui/omp-adapter';
import { SkillQuerySchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/skills → { skills }. */
export async function listSkillsRoute(): Promise<{
  skills: { name: string; description?: string; source: string }[];
}> {
  return { skills: await skillsList() };
}

/** GET /api/skills/:name?path → { content }. */
export async function readSkillRoute(
  name: string,
  query: Record<string, string | undefined>,
): Promise<{ content: string }> {
  const parsed = SkillQuerySchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const skill = decodeURIComponent(name);
  try {
    return await skillRead(skill, parsed.data.path);
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
