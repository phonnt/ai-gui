import type { SessionTools } from '@ai-gui/agent-runtime';
import { SecurityScanSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/**
 * POST /api/sessions/:id/security { action, …params } → { text, details }.
 * Raw `security_scan` passthrough: the wire schema validates the action and
 * forwards the rest to the SDK tool unchanged.
 */
export async function securityScanRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<{ text: string; details: Record<string, unknown> | undefined }> {
  const parsed = SecurityScanSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    return await tools.securityScan({ sessionId, params: parsed.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/action/i.test(message) && /invalid|unsupported/i.test(message)) {
      throw new HttpError(400, message);
    }
    throw err;
  }
}
