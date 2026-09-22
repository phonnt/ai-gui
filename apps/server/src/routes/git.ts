import type { AgentRuntime } from '@grove/agent-runtime';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/git?action=status → { status }. */
export async function gitStatusRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ status: unknown }> {
  return { status: await runtime.gitStatus(sessionId) };
}

/** GET /api/sessions/:id/git?action=diff&path=<file> → { text }. */
export async function gitDiffRoute(
  runtime: AgentRuntime,
  sessionId: string,
  path: string | undefined,
): Promise<{ text: string }> {
  if (!path) throw new HttpError(400, 'path is required for action=diff');
  return runtime.gitDiff(sessionId, path);
}
