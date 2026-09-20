import type { PreludeResult, SessionTools } from '@grove/agent-runtime';
import { PreludeActionSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/**
 * POST /api/sessions/:id/browser|computer { action, …params } → prelude result.
 * Raw passthrough to the SDK's eval preludes: the browser/computer tooling
 * (tab supervision, CDP, desktop controller) stays inside the SDK.
 */
async function runPrelude(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
  which: 'browser' | 'computer',
): Promise<PreludeResult> {
  const parsed = PreludeActionSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return which === 'browser'
      ? await tools.browserAction({ sessionId, params: parsed.data })
      : await tools.computerAction({ sessionId, params: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/is disabled|prelude is unavailable|invalid arguments/i.test(message)) {
      throw new HttpError(400, message);
    }
    throw new HttpError(500, message);
  }
}

/** POST /api/sessions/:id/browser { action, … } → { text, details, images }. */
export async function browserActionRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<PreludeResult> {
  return runPrelude(tools, sessionId, body, 'browser');
}

/** POST /api/sessions/:id/computer { action, … } → { text, details, images }. */
export async function computerActionRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<PreludeResult> {
  return runPrelude(tools, sessionId, body, 'computer');
}
