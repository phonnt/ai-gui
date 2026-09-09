export interface SessionInfo {
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  id: string;
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
