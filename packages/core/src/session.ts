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
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
