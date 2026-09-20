import type { AgentRuntime } from '@grove/agent-runtime';

/** GET /api/sessions/:id/export[?theme=user] → { html }. */
export async function exportRoute(
  runtime: AgentRuntime,
  sessionId: string,
  userThemes?: boolean,
): Promise<{ html: string }> {
  const html = await runtime.exportHtml(sessionId, userThemes);
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
/** POST /api/sessions/:id/share → { url, gistUrl, truncated }. */
export async function shareRoute(
  runtime: AgentRuntime,
  sessionId: string,
): Promise<{ url: string; gistUrl: string | null; truncated: boolean }> {
  return runtime.shareSession(sessionId);
}
