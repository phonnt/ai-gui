import type { SessionTools } from '@ai-gui/agent-runtime';
import { BashRequestSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/** POST /api/sessions/:id/bash { command, cwd?, timeoutMs?, env?, pty?, async? } → BashResult. */
export async function bashRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  body: unknown,
): Promise<{
  output: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  jobId?: string;
}> {
  const parsed = BashRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.runBash({
    sessionId,
    command: parsed.data.command,
    ...(parsed.data.cwd ? { cwd: resolveSessionPath(cwd, parsed.data.cwd) } : {}),
    ...(parsed.data.timeoutMs !== undefined ? { timeoutMs: parsed.data.timeoutMs } : {}),
    ...(parsed.data.env ? { env: parsed.data.env } : {}),
    ...(parsed.data.pty !== undefined ? { pty: parsed.data.pty } : {}),
    ...(parsed.data.async !== undefined ? { async: parsed.data.async } : {}),
  });
}
