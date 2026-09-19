import type { AgentRuntime, LoopState } from '@ai-gui/agent-runtime';
import { LoopPauseSchema, LoopStartSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/loop → { loop }. */
export async function getLoopRoute(runtime: AgentRuntime, sessionId: string): Promise<LoopState> {
  return runtime.getLoop(sessionId);
}

/** POST /api/sessions/:id/loop { prompt, limit? } → { loop }. */
export async function startLoopRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<LoopState> {
  const parsed = LoopStartSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return await runtime.startLoop({
      sessionId,
      prompt: parsed.data.prompt,
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    });
  } catch (err) {
    // Limit parse failures and empty prompts are client errors.
    const message = err instanceof Error ? err.message : String(err);
    if (/Loop (count|duration|usage)|needs a prompt|Usage: \/loop/i.test(message)) {
      throw new HttpError(400, message);
    }
    throw err;
  }
}

/** DELETE /api/sessions/:id/loop → { loop }. */
export async function stopLoopRoute(runtime: AgentRuntime, sessionId: string): Promise<LoopState> {
  return runtime.stopLoop(sessionId);
}

/** POST /api/sessions/:id/loop/pause { paused } → { loop }. */
export async function pauseLoopRoute(
  runtime: AgentRuntime,
  sessionId: string,
  body: unknown,
): Promise<LoopState> {
  const parsed = LoopPauseSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return runtime.pauseLoop({ sessionId, paused: parsed.data.paused });
}
