import type { AgentEvent, AgentEventKind } from '@ai-gui/agent-runtime';
import {
  SessionBusyError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@ai-gui/agent-runtime';
import type { ChatMessage, ChatRole, SessionInfo } from '@ai-gui/core';

export interface RpcResponseFrame {
  id?: string;
  type: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/** Join text parts of an LLM message `content` field into plain text. */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') {
        parts.push(part);
      } else if (part !== null && typeof part === 'object') {
        const p = part as { type?: unknown; text?: unknown };
        if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text);
      }
    }
    return parts.join('');
  }
  return '';
}

function roleOf(raw: unknown): ChatRole {
  if (raw === 'user') return 'user';
  if (raw === 'assistant') return 'assistant';
  if (raw === 'toolResult') return 'tool';
  if (raw === 'developer') return 'system';
  return 'system';
}

/** Map a core AgentMessage (SDK or RPC wire shape) to a contract ChatMessage. */
export function toChatMessage(msg: unknown, index: number): ChatMessage {
  const m = (msg ?? {}) as {
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
    customType?: unknown;
  };
  const createdAt =
    typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)
      ? new Date(m.timestamp).toISOString()
      : new Date().toISOString();
  return {
    id: `${typeof m.timestamp === 'number' ? m.timestamp : 't'}-${index}`,
    role: roleOf(m.role),
    text: textOfContent(m.content),
    createdAt,
  };
}

/** Map an SDK SessionManager.list entry to a contract SessionInfo. */
export function sdkSessionInfoToCore(info: {
  id: string;
  cwd: string;
  title?: string;
  firstMessage?: string;
  created: Date | number | string;
  modified: Date | number | string;
}): SessionInfo {
  const toIso = (v: Date | number | string): string => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString();
    if (typeof v === 'string') return v;
    return new Date().toISOString();
  };
  const title = info.title || info.firstMessage?.slice(0, 80) || info.id;
  return {
    id: info.id,
    cwd: info.cwd,
    title,
    createdAt: toIso(info.created),
    updatedAt: toIso(info.modified),
  };
}

function deltaTextOf(frame: {
  message?: { content?: unknown };
  assistantMessageEvent?: unknown;
}): string {
  const ev = frame.assistantMessageEvent as { delta?: unknown; text?: unknown } | undefined;
  if (typeof ev?.delta === 'string') return ev.delta;
  if (typeof ev?.text === 'string') return ev.text;
  return textOfContent(frame.message?.content);
}

/**
 * Map an RPC/session event frame (AgentSessionEvent wire shape, shared by the
 * RPC child stdout stream and the in-process SDK subscribe stream) to a
 * contract AgentEvent. Returns null for frames with no chat-observable meaning.
 */
export function mapSessionEventToAgentEvent(
  sessionId: string,
  frame: Record<string, unknown>,
): AgentEvent | null {
  const type = frame.type as string | undefined;
  const message = frame.message as Record<string, unknown> | undefined;
  switch (type) {
    case 'message_update': {
      const text = deltaTextOf(frame as { message?: { content?: unknown } });
      const event: AgentEvent = { sessionId, kind: 'message-delta' as AgentEventKind };
      if (text) event.text = text;
      return event;
    }
    case 'message_end':
      return {
        sessionId,
        kind: 'message-end' as AgentEventKind,
        message: toChatMessage(message ?? {}, 0).text,
      };
    case 'agent_end':
      return { sessionId, kind: 'agent-end' as AgentEventKind };
    case 'tool_execution_start': {
      const event: AgentEvent = { sessionId, kind: 'tool-start' as AgentEventKind };
      if (typeof frame.toolName === 'string') event.toolName = frame.toolName;
      return event;
    }
    case 'tool_execution_end': {
      const event: AgentEvent = { sessionId, kind: 'tool-end' as AgentEventKind };
      if (typeof frame.toolName === 'string') event.toolName = frame.toolName;
      return event;
    }
    case 'error': {
      const event: AgentEvent = { sessionId, kind: 'error' as AgentEventKind };
      const text =
        typeof frame.message === 'string'
          ? frame.message
          : typeof frame.error === 'string'
            ? frame.error
            : 'agent error';
      event.text = text;
      return event;
    }
    default:
      return null;
  }
}

/** Throw a typed agent-runtime error for a failed RPC response frame. */
export function assertRpcOk(res: RpcResponseFrame, sessionId: string): void {
  if (res.success) return;
  const message = res.error || `omp rpc ${res.command} failed`;
  if (res.code === 'session_busy') throw new SessionBusyError(message);
  if (/session/i.test(message) && /not found|unknown|no such/i.test(message)) {
    throw new SessionNotFoundError(`session not found: ${sessionId}`);
  }
  if (/streaming|busy/i.test(message)) throw new StreamingActiveError(message);
  throw new Error(message);
}
