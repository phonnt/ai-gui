import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { MessagesQuerySchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/messages?cursor&limit → { messages, nextCursor? }. */
export async function messagesRoute(
  runtime: AgentRuntime,
  sessionId: string,
  query: Record<string, string | string[] | undefined>,
): Promise<{ messages: unknown; nextCursor?: string }> {
  const parsed = MessagesQuerySchema.safeParse({
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const page = await runtime.getMessages(sessionId, parsed.data.cursor, parsed.data.limit);
  return page.nextCursor !== undefined
    ? { messages: page.items, nextCursor: page.nextCursor }
    : { messages: page.items };
}
