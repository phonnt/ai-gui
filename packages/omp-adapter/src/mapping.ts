import type { AgentEvent, AgentEventKind, TreeNode } from '@ai-gui/agent-runtime';
import {
  SessionBusyError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@ai-gui/agent-runtime';
import type {
  ChatMessage,
  ChatRole,
  DiffLine,
  SessionInfo,
  ToolPart,
  ToolTodo,
} from '@ai-gui/core';

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
export function toChatMessage(
  msg: unknown,
  index: number,
  toolCalls?: Map<string, { name: string; args: unknown }>,
): ChatMessage {
  const m = (msg ?? {}) as {
    role?: unknown;
    content?: unknown;
    timestamp?: unknown;
    customType?: unknown;
    toolName?: unknown;
    toolCallId?: unknown;
    details?: unknown;
  };
  const createdAt =
    typeof m.timestamp === 'number' && Number.isFinite(m.timestamp)
      ? new Date(m.timestamp).toISOString()
      : new Date().toISOString();
  const role = roleOf(m.role);
  const message: ChatMessage = {
    id: `${typeof m.timestamp === 'number' ? m.timestamp : 't'}-${index}`,
    role,
    text: textOfContent(m.content),
    createdAt,
  };
  if (role === 'tool') {
    const callId = typeof m.toolCallId === 'string' ? m.toolCallId : undefined;
    const paired = callId ? toolCalls?.get(callId) : undefined;
    const name =
      paired?.name ?? (typeof m.toolName === 'string' && m.toolName ? m.toolName : 'tool');
    // Some tools (eval) store JSON-stringified lines: decode those line-wise
    // so genuine backslashes (paths, regex) pass through untouched.
    const { text, wallTimeMs } = splitWallTime(decodeEscapedLines(message.text));
    message.text = text;
    const tool: ToolPart = { name };
    const summary = summarizeArgs(paired?.args);
    if (summary) tool.summary = summary;
    if (wallTimeMs !== undefined) tool.wallTimeMs = wallTimeMs;
    const structured = toolDetails(m.details);
    if (structured.path) tool.path = structured.path;
    if (structured.todos) tool.todos = structured.todos;
    if (structured.diff) tool.diff = structured.diff;
    message.tool = tool;
  }
  return message;
}

/**
 * OMP tool-call arguments paired by toolCallId (assistant toolCall parts).
 * Collected in one pass so toolResult messages can show a short summary.
 */
export function collectToolCalls(
  messages: unknown[],
): Map<string, { name: string; args: unknown }> {
  const calls = new Map<string, { name: string; args: unknown }>();
  for (const item of messages) {
    const m = (item ?? {}) as { role?: unknown; content?: unknown };
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part === null || typeof part !== 'object') continue;
      const p = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
      if (p.type === 'toolCall' && typeof p.id === 'string') {
        calls.set(p.id, {
          name: typeof p.name === 'string' && p.name ? p.name : 'tool',
          args: p.arguments,
        });
      }
    }
  }
  return calls;
}

/** First useful scalar arg (path, command, pattern…) capped for display. */
function summarizeArgs(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return typeof args === 'string' && args ? args.slice(0, 120) : undefined;
  }
  const record = args as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'path', 'file', 'pattern', 'query', 'url']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return undefined;
}

type StructuredDetails = Pick<ToolPart, 'path' | 'todos' | 'diff'>;

/** Pull TUI-grade structure out of toolResult details (path, todo phases, edit diff). */
function toolDetails(details: unknown): StructuredDetails {
  const out: StructuredDetails = {};
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return out;
  const d = details as Record<string, unknown>;
  if (typeof d.resolvedPath === 'string' && d.resolvedPath) out.path = d.resolvedPath;
  if (Array.isArray(d.phases)) {
    const todos: ToolTodo[] = [];
    for (const phase of d.phases) {
      if (phase === null || typeof phase !== 'object' || Array.isArray(phase)) continue;
      const tasks = (phase as Record<string, unknown>).tasks;
      if (!Array.isArray(tasks)) continue;
      for (const task of tasks) {
        if (task === null || typeof task !== 'object' || Array.isArray(task)) continue;
        const t = task as Record<string, unknown>;
        if (typeof t.content !== 'string' || !t.content) continue;
        todos.push({ label: t.content, status: todoStatus(t.status) });
      }
    }
    if (todos.length > 0) out.todos = todos;
  }
  if (typeof d.diff === 'string' && d.diff) {
    const diff = parseDiff(d.diff);
    if (diff.length > 0) out.diff = diff;
  }
  return out;
}

function todoStatus(raw: unknown): ToolTodo['status'] {
  if (raw === 'completed') return 'done';
  if (raw === 'in_progress') return 'active';
  return 'todo';
}

const DIFF_LINE_RE = /^([ +-])(\d*)\|(.*)$/;

/** Parse OMP edit diff lines (`-12|old`, `+12|new`, ` 6|ctx`) into typed rows. */
function parseDiff(text: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of text.split('\n').slice(0, 500)) {
    const match = DIFF_LINE_RE.exec(raw);
    if (!match) {
      lines.push({ type: 'ctx', text: raw });
      continue;
    }
    const n = match[2] ? Number(match[2]) : undefined;
    lines.push({
      type: match[1] === '+' ? 'add' : match[1] === '-' ? 'del' : 'ctx',
      ...(n !== undefined && Number.isInteger(n) ? { n } : {}),
      text: match[3] ?? '',
    });
  }
  return lines;
}

const WALL_TIME_RE = /\nWall time: ([\d.]+) seconds?\s*$/;

/**
 * Decode JSON-stringified lines inside tool output (`label: "a\nb"` or a bare
 * `"a\nb"` line → real newlines). Eval-family tools wrap display output this
 * way; raw outputs keep real newlines already. A line decodes only when it is
 * exactly `label: "literal"` (or the bare literal) and the decoded form
 * contains a newline — code lines with surrounding syntax, paths, and regex
 * never match and pass through untouched.
 */
function decodeEscapedLines(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const match = /^(?:[A-Za-z_][\w .()-]*:\s*)?("(?:[^"\\\n]|\\.)*")\s*$/.exec(line);
      if (!match?.[1]) return line;
      try {
        const decoded: unknown = JSON.parse(match[1]);
        if (typeof decoded === 'string' && decoded.includes('\n'))
          return line.replace(match[1], () => decoded);
      } catch {
        /* not a JSON literal: keep raw */
      }
      return line;
    })
    .join('\n');
}

/** Split OMP's trailing "Wall time: X seconds" out of bash output. */
function splitWallTime(text: string): { text: string; wallTimeMs?: number } {
  const match = WALL_TIME_RE.exec(text);
  if (!match) return { text };
  const secs = Number(match[1]);
  return {
    text: text.slice(0, match.index),
    ...(Number.isFinite(secs) ? { wallTimeMs: Math.round(secs * 1000) } : {}),
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
  const records: { id?: string; message: unknown }[] = [];
  let boundary = 0;
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
      boundary = records.length;
      continue;
    }
    if (rec.type !== 'message' || !rec.message) continue;
    records.push({
      ...(typeof rec.id === 'string' && rec.id ? { id: rec.id } : {}),
      message: rec.message,
    });
  }
  const live = records.slice(boundary);
  const toolCalls = collectToolCalls(live.map((r) => r.message));
  const items: ChatMessage[] = [];
  for (const rec of live) {
    const msg = toChatMessage(rec.message, items.length, toolCalls);
    if (!msg.text) continue;
    items.push(rec.id ? { ...msg, id: rec.id } : msg);
  }
  return items;
}
