import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { CompactSchema, MoveSchema, RenameSchema, WorktreeMoveSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** POST /api/sessions/:id/fork → { session }. */
export async function forkSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ session: unknown }> {
  const session = await runtime.forkSession(sessionId);
  return { session };
}

/** POST /api/sessions/:id/clear → { ok: true }. */
export async function clearSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ ok: true }> {
  await runtime.clearSession(sessionId);
  return { ok: true };
}

/** POST /api/sessions/:id/fresh → { ok: true }. */
export async function freshSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ ok: true }> {
  await runtime.freshSession(sessionId);
  return { ok: true };
}

/** POST /api/sessions/:id/compact { instructions? } → { ok: true }. */
export async function compactSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ ok: true }> {
  const parsed = CompactSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await runtime.compactSession({ sessionId, ...parsed.data });
  return { ok: true };
}

/** POST /api/sessions/:id/retry → { retried }. */
export async function retryTurnRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ retried: boolean }> {
  const retried = await runtime.retryTurn(sessionId);
  return { retried };
}

/** DELETE /api/sessions/:id → { dropped }. */
export async function dropSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ dropped: boolean }> {
  const dropped = await runtime.dropSession(sessionId);
  return { dropped };
}

/** PATCH /api/sessions/:id { title } → { session }. */
export async function renameSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ session: unknown }> {
  const parsed = RenameSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const session = await runtime.renameSession({ sessionId, title: parsed.data.title });
  return { session };
}

/** POST /api/sessions/:id/move { cwd } → { ok: true }. Re-roots the session. */
/** POST /api/sessions/:id/worktree { branch? } → { path, branch } (TUI `/wt`). */
export async function worktreeRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ path: string; branch: string }> {
  const parsed = WorktreeMoveSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return runtime.moveToWorktree({
    sessionId,
    ...(parsed.data.branch !== undefined ? { branch: parsed.data.branch } : {}),
  });
}

export async function moveSessionRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ ok: true }> {
  const parsed = MoveSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await runtime.moveSession({ sessionId, cwd: parsed.data.cwd });
  return { ok: true };
}
