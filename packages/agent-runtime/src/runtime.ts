import type { ChatMessage, ChatRole, Page, SessionInfo } from '@ai-gui/core';

export type RuntimeKind = 'sdk';

export type AgentEventKind =
  | 'message-delta'
  | 'thinking-delta'
  | 'message-end'
  | 'agent-end'
  | 'tool-start'
  | 'tool-end'
  | 'approval-request'
  | 'error';

export interface AgentEvent {
  sessionId: string;
  kind: AgentEventKind;
  text?: string;
  toolName?: string;
  message?: string;
  /** Approval round-trip id (kind === 'approval-request'). */
  approvalId?: string;
  /** Human-readable approval prompt for the modal. */
  prompt?: string;
}

export interface CreateSessionInput {
  cwd?: string;
}

export interface PromptInput {
  sessionId: string;
  text: string;
  /** Delivery while streaming; idle turns ignore it (TUI Enter vs Ctrl+Enter). */
  behavior?: 'steer' | 'followUp' | 'aside';
  /** Image attachments as base64 payloads with their mime types. */
  images?: { data: string; mimeType: string }[];
}

export interface ApprovalDecisionInput {
  sessionId: string;
  approvalId: string;
  approved: boolean;
}
export interface TreeNode {
  id: string;
  parentId: string | null;
  role: ChatRole | 'branch' | 'system-event';
  preview: string;
  createdAt: string;
  /** Operator annotation (TUI Shift+L). Absent when unlabeled. */
  label?: string;
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

/** Branch outcome: the new session plus the branch-point text for the composer draft. */
export interface BranchResult {
  session: SessionInfo;
  draft: string | null;
}

export interface RenameInput {
  sessionId: string;
  title: string;
}

export interface MoveInput {
  sessionId: string;
  cwd: string;
}

export interface ShareResult {
  url: string;
  gistUrl: string | null;
  truncated: boolean;
}

export interface LabelInput {
  sessionId: string;
  entryId: string;
  /** Empty clears the label. */
  label: string;
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
export interface CompactInput {
  sessionId: string;
  instructions?: string;
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
export interface ConflictEntry {
  id: number;
  /** Session-relative display path (absolute path stays server-side). */
  path: string;
  /** 1-indexed marker lines of the conflict block. */
  startLine: number;
  endLine: number;
  oursLabel: string | null;
  theirsLabel: string | null;
  /** True when a diff3 `|||||||` base section is present. */
  hasBase: boolean;
}

/** Resolution side for a conflict block (`@both` keeps ours then theirs). */
export type ConflictSide = 'ours' | 'theirs' | 'base' | 'both';

export interface ResolveConflictsInput {
  sessionId: string;
  /** Conflict ids to resolve; an empty list resolves every known conflict. */
  ids: number[];
  side: ConflictSide;
}

/** One skill the live session has loaded (agent-visible inventory). */
export interface SessionSkill {
  name: string;
  description?: string;
  /** Discovery source (`native:project`, `opencode:user`, plugin id, …). */
  source: string;
}

/**
 * The session's workspace: one primary root (`cwd`) plus extra roots granted
 * at runtime (TUI `/add-dir`). Extra roots widen what the session's tools and
 * the out-of-turn routes may touch; they persist in the session header.
 */
export interface SessionWorkspace {
  cwd: string;
  /** Absolute additional roots, in insertion order. */
  directories: string[];
}

export interface WorkspaceDirInput {
  sessionId: string;
  /** Absolute or cwd-relative directory path. */
  path: string;
}

/** Category split of the current context window (TUI `/context` view). */
export interface ContextBreakdown {
  contextWindow: number;
  usedTokens: number;
  /** True when `usedTokens` is anchored to a provider-reported total. */
  anchored: boolean;
  systemPromptTokens: number;
  /** Tool schemas the provider sees. */
  systemToolsTokens: number;
  /** AGENTS.md / rule / memory blocks injected into the prompt. */
  systemContextTokens: number;
  skillsTokens: number;
  messagesTokens: number;
}

export interface SessionStats {
  /** Durable journal backing the session; null for in-memory sessions. */
  sessionFile: string | null;
  /** Cumulative token counts for the session (provider-reported). */
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  premiumRequests: number;
  /** Provider credit accounting, present when the provider reports credits. */
  credits?: { cost: number; committedCost: number; acuCost: number };
  /** Provider-routed model ids that served a finalized turn, with turn counts. */
  routedModels?: Record<string, number>;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  /** Current context usage, when the provider reports a window. */
  context: { tokens: number; contextWindow: number; percent: number } | null;
  /** Category split of the context window; null when unavailable. */
  contextBreakdown: ContextBreakdown | null;
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
  decideApproval(input: ApprovalDecisionInput): boolean | Promise<boolean>;
  forkSession(sessionId: string): SessionInfo | Promise<SessionInfo>;
  clearSession(sessionId: string): void | Promise<void>;
  freshSession(sessionId: string): void | Promise<void>;
  compactSession(input: CompactInput): void | Promise<void>;
  retryTurn(sessionId: string): boolean | Promise<boolean>;
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
  getTree(sessionId: string): SessionTree | Promise<SessionTree>;
  navigateTree(input: NavigateInput): void | Promise<void>;
  branchSession(input: BranchInput): BranchResult | Promise<BranchResult>;
  labelTreeEntry(input: LabelInput): void | Promise<void>;
  setQueueModes(input: SetQueueModesInput): SessionModes | Promise<SessionModes>;
  exportHtml(sessionId: string, userThemes?: boolean): string | Promise<string>;
  dumpSession(sessionId: string): string | Promise<string>;
  shareSession(sessionId: string): ShareResult | Promise<ShareResult>;
  renameSession(input: RenameInput): SessionInfo | Promise<SessionInfo>;
  moveSession(input: MoveInput): void | Promise<void>;
  getSessionModels(sessionId: string): SessionModelState | Promise<SessionModelState>;
  getSessionStats(sessionId: string): SessionStats | Promise<SessionStats>;
  getWorkspace(sessionId: string): SessionWorkspace | Promise<SessionWorkspace>;
  /** Adds a root; `added` is null when it was already one. */
  addWorkspaceDirectory(
    input: WorkspaceDirInput,
  ): Promise<{ added: string | null; workspace: SessionWorkspace }>;
  /** Removes a root; `removed` is null when it was not one. */
  removeWorkspaceDirectory(
    input: WorkspaceDirInput,
  ): Promise<{ removed: string | null; workspace: SessionWorkspace }>;
  /**
   * Skills the live session has loaded. Read from the session itself so the UI
   * can never disagree with what the agent sees.
   */
  getSessionSkills(sessionId: string): SessionSkill[] | Promise<SessionSkill[]>;
  /** SKILL.md (or a jailed relative path inside the skill dir). */
  getSessionSkillContent(input: {
    sessionId: string;
    name: string;
    path?: string;
  }): { content: string } | Promise<{ content: string }>;
  listConflicts(sessionId: string): ConflictEntry[] | Promise<ConflictEntry[]>;
  resolveConflicts(input: ResolveConflictsInput): number | Promise<number>;
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
