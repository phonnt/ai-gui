import type { PreludeResult, SessionTools } from '@grove/agent-runtime';
import { BrowserActionSchema, PreludeActionSchema } from '@grove/protocol';
import { errorToStatus, HttpError } from './errors.js';

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
  // Per-endpoint schema: the computer prelude accepts `capabilities`, the
  // browser one does not.
  const schema = which === 'browser' ? BrowserActionSchema : PreludeActionSchema;
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return which === 'browser'
      ? await tools.browserAction({ sessionId, params: parsed.data })
      : await tools.computerAction({ sessionId, params: parsed.data });
  } catch (err) {
    // Typed runtime errors carry their own status (disabled -> 400).
    const message = err instanceof Error ? err.message : String(err);
    throw new HttpError(errorToStatus(err), message);
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
