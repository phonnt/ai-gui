import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { ApprovalDecisionSchema, EphemeralAskSchema, PromptSchema } from '@ai-gui/protocol';
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

/**
 * POST /api/sessions/:id/ask { question } → { reply }.
 * Ephemeral side question (TUI `/btw`): never appended to the transcript.
 */
export async function askRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ reply: string }> {
  const parsed = EphemeralAskSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return await runtime.askEphemeral({ sessionId, question: parsed.data.question });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('Usage: /btw') || message.startsWith('no active model')) {
      throw new HttpError(400, message);
    }
    throw err;
  }
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
