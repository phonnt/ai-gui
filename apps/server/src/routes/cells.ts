import type { SessionTools } from '@ai-gui/agent-runtime';
import { ResetKernelSchema, RunCellSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** POST /api/sessions/:id/cells { language, code, title?, timeoutMs?, reset? } → CellResult. */
export async function runCellRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<{ output: string; images?: string[] }> {
  const parsed = RunCellSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.runCell({
    sessionId,
    language: parsed.data.language,
    code: parsed.data.code,
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.timeoutMs !== undefined ? { timeoutMs: parsed.data.timeoutMs } : {}),
    ...(parsed.data.reset !== undefined ? { reset: parsed.data.reset } : {}),
  });
}

/** POST /api/sessions/:id/cells/reset { language } → { ok }. */
export async function resetKernelRoute(
  tools: SessionTools,
  sessionId: string,
  body: unknown,
): Promise<{ ok: boolean }> {
  const parsed = ResetKernelSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.resetKernel({ sessionId, language: parsed.data.language });
}
