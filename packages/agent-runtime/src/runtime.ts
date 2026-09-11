import type { ChatMessage, ChatRole, Page, SessionInfo } from '@ai-gui/core';

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

export interface TreeNode {
  id: string;
  parentId: string | null;
  role: ChatRole | 'branch' | 'system-event';
  preview: string;
  createdAt: string;
}

export interface SessionTree {
  nodes: TreeNode[];
  leafId: string | null;
}

export interface NavigateInput {
  sessionId: string;
  leafId: string;
}

export interface BranchInput {
  sessionId: string;
  parentId?: string;
}

export interface RenameInput {
  sessionId: string;
  title: string;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export type GoalStatus = 'active' | 'paused' | 'budget-limited' | 'complete' | 'dropped';

export interface SessionGoal {
  id: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  tokensUsed: number;
}

export interface GoalState {
  enabled: boolean;
  goal: SessionGoal | null;
}

export interface SetGoalInput {
  sessionId: string;
  objective: string;
  tokenBudget?: number;
}

export type QueueMode = 'all' | 'one-at-a-time';
export type InterruptMode = 'immediate' | 'wait';

export interface SessionModes {
  plan: boolean;
  vibe: boolean;
  advisor: boolean;
  fast: boolean;
  fastActive: boolean;
  steering: QueueMode;
  followUp: QueueMode;
  interrupt: InterruptMode;
  prewalkArmed: boolean;
}

export interface SetFlagInput {
  sessionId: string;
  enabled: boolean;
}

export interface SetQueueModesInput {
  sessionId: string;
  steering?: QueueMode;
  followUp?: QueueMode;
  interrupt?: InterruptMode;
}
export interface SessionModelState {
  models: ModelRef[];
  current: ModelRef | null;
  thinking: string | null;
}

export interface SetModelInput {
  sessionId: string;
  provider: string;
  modelId: string;
}

export interface SetThinkingInput {
  sessionId: string;
  level: string;
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
  forkSession(sessionId: string): SessionInfo | Promise<SessionInfo>;
  clearSession(sessionId: string): void | Promise<void>;
  freshSession(sessionId: string): void | Promise<void>;
  dropSession(sessionId: string): boolean | Promise<boolean>;
  getGoal(sessionId: string): GoalState | Promise<GoalState>;
  setGoal(input: SetGoalInput): GoalState | Promise<GoalState>;
  pauseGoal(sessionId: string): GoalState | Promise<GoalState>;
  resumeGoal(sessionId: string): GoalState | Promise<GoalState>;
  dropGoal(sessionId: string): GoalState | Promise<GoalState>;
  getSessionModes(sessionId: string): SessionModes | Promise<SessionModes>;
  setPlanMode(input: SetFlagInput): SessionModes | Promise<SessionModes>;
  setVibeMode(input: SetFlagInput): SessionModes | Promise<SessionModes>;
  setAdvisorMode(input: SetFlagInput): SessionModes | Promise<SessionModes>;
  setFastMode(input: SetFlagInput): SessionModes | Promise<SessionModes>;
  setQueueModes(input: SetQueueModesInput): SessionModes | Promise<SessionModes>;
  getTree(sessionId: string): SessionTree | Promise<SessionTree>;
  navigateTree(input: NavigateInput): void | Promise<void>;
  branchSession(input: BranchInput): SessionInfo | Promise<SessionInfo>;
  exportHtml(sessionId: string): string | Promise<string>;
  dumpSession(sessionId: string): string | Promise<string>;
  shareSession(sessionId: string): string | Promise<string>;
  renameSession(input: RenameInput): SessionInfo | Promise<SessionInfo>;
  getSessionModels(sessionId: string): SessionModelState | Promise<SessionModelState>;
  setSessionModel(input: SetModelInput): Promise<ModelRef>;
  setThinkingLevel(input: SetThinkingInput): Promise<string>;
  /**
   * Durable journal path backing the web session, or null when the session
   * has none (unknown session throws SessionNotFoundError instead). Serves
   * artifact resolution for the out-of-turn SessionTools surface.
   */
  getSessionFile(sessionId: string): string | null | Promise<string | null>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  dispose(): void | Promise<void>;
}
