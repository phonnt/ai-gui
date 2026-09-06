import type { AgentEvent, AgentEventKind, TreeNode } from '@ai-gui/agent-runtime';
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

/** Minimal structural shape of a persisted session-journal entry. */
export interface JournalEntryLike {
  id: string;
  parentId: string | null;
  timestamp?: unknown;
  type?: unknown;
  message?: { role?: unknown; content?: unknown };
  summary?: unknown;
  name?: unknown;
  label?: unknown;
}

/** Minimal structural shape of a SessionManager.getTree() node. */
export interface SessionTreeInput {
  entry: JournalEntryLike;
  children: SessionTreeInput[];
}

/** Map one journal entry (SDK SessionEntry or parsed JSONL line) to a contract TreeNode. */
export function toTreeNode(entry: JournalEntryLike): TreeNode {
  const type = typeof entry.type === 'string' ? entry.type : '';
  let role: TreeNode['role'] = 'system-event';
  let preview = '';
  if (type === 'message' && entry.message) {
    role = roleOf(entry.message.role);
    preview = textOfContent(entry.message.content);
  } else if (type === 'branch_summary') {
    role = 'branch';
    preview = typeof entry.summary === 'string' ? entry.summary : '';
  } else if (type === 'compaction') {
    preview = typeof entry.summary === 'string' ? entry.summary : '';
  } else if (type === 'title_change') {
    preview =
      typeof entry.name === 'string' && entry.name ? `title: ${entry.name}` : 'title change';
  } else if (type === 'label') {
    preview =
      typeof entry.label === 'string' && entry.label ? `label: ${entry.label}` : 'label change';
  } else if (type) {
    preview = type;
  }
  return {
    id: entry.id,
    parentId: entry.parentId,
    role,
    preview: preview.slice(0, 120),
    createdAt:
      typeof entry.timestamp === 'string' && entry.timestamp
        ? entry.timestamp
        : new Date().toISOString(),
  };
}

/** Depth-first flatten of a SessionManager.getTree() result into contract nodes. */
export function flattenSessionTree(tree: SessionTreeInput[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  const visit = (items: SessionTreeInput[]): void => {
    for (const item of items) {
      nodes.push(toTreeNode(item.entry));
      if (item.children.length > 0) visit(item.children);
    }
  };
  visit(tree);
  return nodes;
}

/**
 * Parse a session JSONL journal (header line plus entries) into contract tree
 * nodes. The leaf is the last physical journal entry — the same rule the
 * session loader uses to reconstruct the active branch on reload. Malformed
 * lines are skipped; a missing/empty journal yields an empty tree.
 */
export function sessionFileTextToTree(text: string): { nodes: TreeNode[]; leafId: string | null } {
  const nodes: TreeNode[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rec = parsed as { type?: unknown; id?: unknown; parentId?: unknown };
    if (rec.type === 'session') continue;
    if (typeof rec.id !== 'string' || !rec.id) continue;
    if (typeof rec.parentId !== 'string' && rec.parentId !== null) continue;
    nodes.push(toTreeNode(rec as JournalEntryLike));
  }
  const last = nodes.length > 0 ? nodes[nodes.length - 1] : undefined;
  return { nodes, leafId: last ? last.id : null };
}

/**
 * Parse a session JSONL journal into full-text chat messages (durable history
 * only: user/assistant/tool/system entries with non-empty text). Context
 * restarts are honored: entries at or before the last `reset_boundary` or
 * `compaction` are dropped, matching the loader's post-boundary transcript.
 * Used as a getMessages fallback when the live child holds no messages.
 */
export function sessionFileTextToMessages(text: string): ChatMessage[] {
  let items: ChatMessage[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const rec = parsed as { type?: unknown; id?: unknown; message?: unknown };
    if (rec.type === 'reset_boundary' || rec.type === 'compaction') {
      items = [];
      continue;
    }
    if (rec.type !== 'message' || !rec.message) continue;
    const msg = toChatMessage(rec.message, items.length);
    if (!msg.text) continue;
    items.push(typeof rec.id === 'string' && rec.id ? { ...msg, id: rec.id } : msg);
  }
  return items;
}
