import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { AgentRuntime, SessionWorkspace } from '@grove/agent-runtime';
import { WorkspaceDirSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** `~`/relative paths resolve against the session cwd, like the TUI `/add-dir`. */
async function resolveDirectory(cwd: string, input: string): Promise<string> {
  const expanded =
    input === '~' || input.startsWith('~/') ? `${homedir()}${input.slice(1)}` : input;
  const abs = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const info = await stat(abs).catch(() => null);
  if (info === null) throw new HttpError(400, `directory does not exist: ${abs}`);
  if (!info.isDirectory()) throw new HttpError(400, `not a directory: ${abs}`);
  return abs;
}

/** GET /api/sessions/:id/workspace → { cwd, directories }. */
export async function workspaceRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<SessionWorkspace> {
  return runtime.getWorkspace(sessionId);
}

/** POST /api/sessions/:id/workspace/dirs { path } → { added, workspace }. */
export async function addWorkspaceDirRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ added: string | null; workspace: SessionWorkspace }> {
  const parsed = WorkspaceDirSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const current = await runtime.getWorkspace(sessionId);
  const path = await resolveDirectory(current.cwd, parsed.data.path);
  try {
    return await runtime.addWorkspaceDirectory({ sessionId, path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The SDK rejects the primary root with a plain Error; that is a client slip.
    if (message.includes('primary workspace root')) throw new HttpError(400, message);
    throw err;
  }
}

/** DELETE /api/sessions/:id/workspace/dirs?path → { removed, workspace }. */
export async function removeWorkspaceDirRoute(
  runtime: AgentRuntime,
  sessionId: string,
  query: Record<string, string | undefined>,
): Promise<{ removed: string | null; workspace: SessionWorkspace }> {
  const parsed = WorkspaceDirSchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const current = await runtime.getWorkspace(sessionId);
  const path = isAbsolute(parsed.data.path)
    ? parsed.data.path
    : resolve(current.cwd, parsed.data.path);
  return runtime.removeWorkspaceDirectory({ sessionId, path });
}
