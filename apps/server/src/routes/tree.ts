import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { BranchSchema, NavigateSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/tree → { nodes, leafId }. */
export async function treeRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ nodes: unknown; leafId: string | null }> {
  const tree = await runtime.getTree(sessionId);
  return { nodes: tree.nodes, leafId: tree.leafId };
}

/** POST /api/sessions/:id/tree/navigate { leafId } → { ok: true }. */
export async function navigateTreeRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ ok: true }> {
  const parsed = NavigateSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await runtime.navigateTree({ sessionId, leafId: parsed.data.leafId });
  return { ok: true };
}

/** POST /api/sessions/:id/branch { parentId? } → { session }. */
export async function branchRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ session: unknown }> {
  const parsed = BranchSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const session = await runtime.branchSession({
    sessionId,
    ...(parsed.data.parentId ? { parentId: parsed.data.parentId } : {}),
  });
  return { session };
}
