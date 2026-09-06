import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';

export type RuntimeKind = 'omp-rpc' | 'sdk';

export type AgentEventKind =
  | 'message-delta'
  | 'message-end'
  | 'agent-end'
  | 'tool-start'
  | 'tool-end'
  | 'error';

export interface AgentEvent {
  sessionId: string;
  kind: AgentEventKind;
  text?: string;
  toolName?: string;
  message?: string;
}

export interface CreateSessionInput {
  cwd?: string;
}

export interface PromptInput {
  sessionId: string;
  text: string;
}

export interface AgentRuntime {
  readonly kind: RuntimeKind;
  listSessions(): SessionInfo[] | Promise<SessionInfo[]>;
  createSession(input: CreateSessionInput): SessionInfo | Promise<SessionInfo>;
  getMessages(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Page<ChatMessage> | Promise<Page<ChatMessage>>;
  prompt(input: PromptInput): void | Promise<void>;
  abort(sessionId: string): void | Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  dispose(): void | Promise<void>;
}
