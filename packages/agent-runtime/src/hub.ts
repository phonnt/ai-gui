export type HubAgentStatus = 'running' | 'idle' | 'parked' | 'aborted';

export interface HubAgent {
  id: string;
  displayName: string;
  kind: string;
  status: HubAgentStatus;
  parentId?: string;
  activity?: string;
  model?: string;
  sessionFile: string | null;
  createdAt: string;
  lastActivity: string;
  /** Cumulative usage for the agent's session, when the registry tracks it. */
  metrics?: {
    tokens: number;
    requests: number;
    tools: number;
    cost: number;
    durationMs: number;
  };
  /** Unread IRC messages waiting for this agent. */
  unread: number;
  /** True when the registry can revive this agent from disk. */
  revivable: boolean;
}

/** One agent-to-agent message (IRC) row. */
export interface HubMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  /** Epoch milliseconds. */
  ts: number;
  replyTo?: string;
}

export interface HubSendResult {
  /** `injected` (live session took it), `woken` (revived then delivered), or `failed`. */
  outcome: 'injected' | 'woken' | 'revived' | 'failed';
  error?: string;
}

/** One transcript row for the read-only agent viewer. */
export interface HubTranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  createdAt: string;
}

export interface HubJob {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  label: string;
  agentId?: string;
  startedAt: string;
  /** Wall-clock duration so far (or final) in milliseconds. */
  durationMs: number;
  resultText?: string;
  errorText?: string;
}

/** Coarse thinking effort for a spawn: lowest / middle / highest the model supports. */
export type SpawnEffort = 'lo' | 'med' | 'hi';

export interface SpawnInput {
  sessionId: string;
  agent?: string;
  task: string;
  context?: string;
  outputSchema?: unknown;
  /** Force a schema on the result (`permissive` repairs, `strict` rejects). */
  schemaMode?: 'permissive' | 'strict';
  /** Model override for the subagent (provider/model or role alias). */
  model?: string;
  /** Coarse thinking effort mapped onto the model's supported range. */
  effort?: SpawnEffort;
  /** Run in an isolated worktree; `merge` picks how changes come back. */
  isolation?: { requested?: boolean; merge?: 'patch' | 'branch'; apply?: boolean };
  /** Detach: the spawn returns immediately and the agent runs in the background. */
  detached?: boolean;
}

export interface ReviveResult {
  revived: boolean;
  revivable: boolean;
  transcript?: string;
}

/**
 * Multi-agent hub surface (P3 wave 1). Implemented SDK-direct against the
 * server-owned AgentRegistry: only subagents spawned through taskSpawn (or
 * sharing that registry) are manageable. Subagents spawned inside session
 * turns are internal and are NOT listed here.
 */
export interface HubOps {
  hubRoster(): Promise<HubAgent[]>;
  /**
   * Read-only transcript of one agent (live session when attached, else its
   * journal), mirroring the TUI's agent viewer.
   */
  hubTranscript(input: { id: string; limit?: number }): Promise<HubTranscriptEntry[]>;
  hubSteer(input: { id: string; text: string }): Promise<void>;
  hubRevive(input: { id: string }): Promise<ReviveResult>;
  /**
   * Send an agent-to-agent message (IRC). `from` defaults to the calling
   * session so a web user can talk to a peer agent.
   */
  hubSend(input: { from: string; to: string; text: string }): Promise<HubSendResult>;
  /** Drain (or peek) an agent's mailbox. */
  hubInbox(input: { id: string; peek?: boolean }): Promise<HubMessage[]>;
  /**
   * Block until the agent receives a message or `timeoutMs` elapses (0 waits
   * forever). Returns null on timeout.
   */
  hubWait(input: { id: string; from?: string; timeoutMs: number }): Promise<HubMessage | null>;
  hubKill(input: { id: string }): Promise<{ killed: boolean }>;
  jobsList(): Promise<HubJob[]>;
  jobsCancel(input: { ids?: string[] }): Promise<{ cancelled: string[] }>;
  taskSpawn(input: SpawnInput): Promise<{ agentId: string }>;
}

export class AgentNotFoundError extends Error {
  readonly code = 'agent-not-found';
  constructor(id: string) {
    super(`agent not found: ${id}`);
  }
}

/**
 * Spawn target names an agent definition that discovery did not find. Thrown
 * before the subagent is reserved so a bad name cannot report success.
 */
export class UnknownAgentError extends Error {
  readonly code = 'unknown-agent';
  constructor(name: string, available: string) {
    super(`unknown agent "${name}". Available: ${available}`);
  }
}

export class ReviveFailedError extends Error {
  readonly code = 'revive-failed';
  readonly revivable = false;
  constructor(id: string) {
    super(`agent cannot be revived (no reviver registered): ${id}`);
  }
}
