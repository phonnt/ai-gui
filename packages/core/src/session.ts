/** Coarse lifecycle status of the session's last persisted turn. */
export type SessionStatus =
  | 'complete'
  | 'interrupted'
  | 'aborted'
  | 'error'
  | 'pending'
  | 'unknown';

export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Persisted transcript entries; 0 for a session that has not run yet. */
  messageCount: number;
  /** Journal size on disk, for the list's weight hint. */
  sizeBytes: number;
  status: SessionStatus;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
  /**
   * Journal entry backing this message, when the adapter could align the
   * transcript with the session branch. Tree operations (branch/label) key off
   * entry ids, so their absence disables those actions for the message.
   */
  entryId?: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  /** Structured tool metadata (role === 'tool' only). Text stays the raw output. */
  tool?: ToolPart;
}

export interface ToolPart {
  name: string;
  /** Short argument hint (path, command, pattern…) derived by the adapter. */
  summary?: string;
  /** Trailing "Wall time: …" parsed out of the output text. */
  wallTimeMs?: number;
  /** Tool timeout (bash details.timeoutSeconds). */
  timeoutMs?: number;
  /** Tool call failed (toolResult isError): approval denials surface here. */
  error?: boolean;
  /** Authoritative file path (read/write/edit resolvedPath). */
  path?: string;
  /** Flattened todo tasks (todo tool details.phases). */
  todos?: ToolTodo[];
  /** Parsed edit diff lines (edit tool details.diff). */
  diff?: DiffLine[];
}

export interface ToolTodo {
  phase?: string;
  label: string;
  status: 'done' | 'active' | 'todo';
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  n?: number;
  text: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
