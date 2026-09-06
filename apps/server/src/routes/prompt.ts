import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { PromptSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** POST /api/sessions/:id/prompt { text } → { accepted }. */
export async function promptRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<{ accepted: boolean }> {
  const parsed = PromptSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  await runtime.prompt({ sessionId, text: parsed.data.text });
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
