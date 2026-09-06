import type { AgentRuntime } from '@ai-gui/agent-runtime';

/** GET /api/sessions/:id/export → { html }. */
export async function exportRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ html: string }> {
  const html = await runtime.exportHtml(sessionId);
  return { html };
}

/** GET /api/sessions/:id/dump → { text }. */
export async function dumpRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ text: string }> {
  const text = await runtime.dumpSession(sessionId);
  return { text };
}

/** POST /api/sessions/:id/share → { url }. */
export async function shareRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ url: string }> {
  const url = await runtime.shareSession(sessionId);
  return { url };
}
