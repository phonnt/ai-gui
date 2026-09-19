import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { ApprovalDecisionSchema, PromptSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** POST /api/sessions/:id/prompt { text } → { accepted }. */
export async function promptRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ accepted: boolean }> {
  const parsed = PromptSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await runtime.prompt({
    sessionId,
    text: parsed.data.text,
    ...(parsed.data.behavior ? { behavior: parsed.data.behavior } : {}),
    ...(parsed.data.images ? { images: parsed.data.images } : {}),
  });
  return { accepted: true };
}

/** POST /api/sessions/:id/abort → { aborted }. */
export async function abortRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ aborted: boolean }> {
  await runtime.abort(sessionId);
  return { aborted: true };
}

/** POST /api/sessions/:id/approval/:approvalId { approved } → { decided }. */
export async function approvalRoute(
  runtime: AgentRuntime,
  sessionId: string,
  approvalId: string,
  body: unknown,
): Promise<{ decided: boolean }> {
  const parsed = ApprovalDecisionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const decided = await runtime.decideApproval({
    sessionId,
    approvalId,
    approved: parsed.data.approved,
  });
  return { decided };
}
