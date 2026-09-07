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
}

export interface HubJob {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  label: string;
  agentId?: string;
  startedAt: string;
}

export interface SpawnInput {
  sessionId: string;
  agent?: string;
  task: string;
  context?: string;
  outputSchema?: unknown;
}

export interface ReviveResult {
  revived: boolean;
  revivable: boolean;
  transcript?: string;
}

/**
 * Multi-agent hub surface (P3 wave 1). Implemented SDK-direct against the
 * server-owned AgentRegistry: only subagents spawned through taskSpawn (or
 * sharing that registry) are manageable. Subagents spawned inside omp-rpc
 * child turns live in the child process and are NOT listed here.
 */
export interface HubOps {
  hubRoster(): Promise<HubAgent[]>;
  hubSteer(input: { id: string; text: string }): Promise<void>;
  hubRevive(input: { id: string }): Promise<ReviveResult>;
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

export class ReviveFailedError extends Error {
  readonly code = 'revive-failed';
  readonly revivable = false;
  constructor(id: string) {
    super(`agent cannot be revived (no reviver registered): ${id}`);
  }
}
