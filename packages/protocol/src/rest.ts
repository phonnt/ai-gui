import { z } from 'zod';

export const SessionStatusSchema = z.enum([
  'complete',
  'interrupted',
  'aborted',
  'error',
  'pending',
  'unknown',
]);

export const SessionInfoSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  messageCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  status: SessionStatusSchema,
});

export const CreateSessionSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const PromptImageSchema = z.object({
  /** Base64 payload without the data: prefix. */
  data: z.string().min(1),
  mimeType: z.string().min(1),
});

export const PromptSchema = z.object({
  text: z.string().min(1),
  /**
   * Delivery while a turn streams (TUI: Enter=steer, Ctrl+Enter=follow-up).
   * Ignored when idle; `aside` injects at the next step boundary.
   */
  behavior: z.enum(['steer', 'followUp', 'aside']).optional(),
  /** Image attachments (TUI pastes screenshots into the prompt). */
  images: z.array(PromptImageSchema).max(8).optional(),
});

export const MessagesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(256).default(100),
});

export const ToolPartSchema = z.object({
  name: z.string().min(1),
  summary: z.string().max(240).optional(),
  wallTimeMs: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().nonnegative().optional(),
  error: z.boolean().optional(),
  path: z.string().min(1).optional(),
  todos: z
    .array(
      z.object({
        phase: z.string().optional(),
        label: z.string(),
        status: z.enum(['done', 'active', 'todo']),
      }),
    )
    .optional(),
});
export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string().min(1),
  runtime: z.string().min(1),
});

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionInfoSchema),
});

export const CreateSessionResponseSchema = z.object({
  session: SessionInfoSchema,
});

export const MessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      text: z.string(),
      createdAt: z.string().min(1),
      tool: ToolPartSchema.optional(),
    }),
  ),
  nextCursor: z.string().min(1).optional(),
});

export const PromptResponseSchema = z.object({
  accepted: z.boolean(),
});

export const AbortResponseSchema = z.object({
  aborted: z.boolean(),
});

export const TreeNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  role: z.enum(['user', 'assistant', 'system', 'tool', 'branch', 'system-event']),
  preview: z.string(),
  createdAt: z.string().min(1),
  label: z.string().max(120).optional(),
});

export const TreeResponseSchema = z.object({
  nodes: z.array(TreeNodeSchema),
  leafId: z.string().min(1).nullable(),
});

export const NavigateSchema = z.object({
  leafId: z.string().min(1),
});

export const BranchSchema = z.object({
  parentId: z.string().min(1).optional(),
});

export const BranchResponseSchema = z.object({
  session: SessionInfoSchema,
  draft: z.string().nullable(),
});

export const LabelSchema = z.object({
  entryId: z.string().min(1),
  label: z.string().max(120),
});

export const ShareResponseSchema = z.object({
  url: z.string().min(1),
  gistUrl: z.string().min(1).nullable(),
  truncated: z.boolean(),
});

export const MoveSchema = z.object({
  cwd: z.string().min(1).max(1024),
});
export const ExportResponseSchema = z.object({
  html: z.string(),
});

export const DumpResponseSchema = z.object({
  text: z.string(),
});

export const RenameSchema = z.object({
  title: z.string().min(1),
});

export const GoalStatusSchema = z.enum([
  'active',
  'paused',
  'budget-limited',
  'complete',
  'dropped',
]);

export const SessionGoalSchema = z.object({
  id: z.string().min(1),
  objective: z.string().min(1),
  status: GoalStatusSchema,
  tokenBudget: z.number().int().nonnegative().optional(),
  tokensUsed: z.number().int().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
});

export const GoalStateSchema = z.object({
  enabled: z.boolean(),
  goal: SessionGoalSchema.nullable(),
});

export const GoalResponseSchema = z.object({
  goal: GoalStateSchema,
});

export const GoalActionSchema = z.object({
  action: z.enum(['set', 'pause', 'resume', 'drop', 'budget']),
  objective: z.string().min(1).optional(),
  /** `budget`: positive ceiling, or `null` to clear (TUI `/goal budget off`). */
  tokenBudget: z.number().int().positive().nullable().optional(),
});

export const PlanProposalSchema = z.object({
  title: z.string().min(1),
  planFilePath: z.string().min(1),
  planExists: z.boolean(),
});

export const PlanDecisionSchema = z.object({
  action: z.enum(['execute', 'keep']),
});

export const PlanDecisionResponseSchema = z.object({
  executed: z.boolean(),
});

export const QueueModeSchema = z.enum(['all', 'one-at-a-time']);
export const InterruptModeSchema = z.enum(['immediate', 'wait']);

export const SessionModesSchema = z.object({
  plan: z.boolean(),
  vibe: z.boolean(),
  advisor: z.boolean(),
  fast: z.boolean(),
  fastActive: z.boolean(),
  steering: QueueModeSchema,
  followUp: QueueModeSchema,
  interrupt: InterruptModeSchema,
  prewalkArmed: z.boolean(),
});

export const ModesResponseSchema = z.object({
  modes: SessionModesSchema,
});

export const ModeActionSchema = z.object({
  mode: z.enum(['plan', 'vibe', 'advisor', 'fast', 'steering', 'followUp', 'interrupt']),
  enabled: z.boolean().optional(),
  value: z.string().min(1).optional(),
});
export const OkSchema = z.object({
  ok: z.literal(true),
});
export const ApprovalDecisionSchema = z.object({
  approved: z.boolean(),
});
export const ApprovalDecisionResponseSchema = z.object({
  decided: z.boolean(),
});
export const CompactSchema = z.object({
  instructions: z.string().max(2000).optional(),
});
export const RetryResponseSchema = z.object({
  retried: z.boolean(),
});
export const DropResponseSchema = z.object({
  dropped: z.boolean(),
});

// ---------------------------------------------------------------------------
// P2a session tools (SDK-direct, out-of-turn surfaces).
// ---------------------------------------------------------------------------

export const FilesQuerySchema = z.object({
  path: z.string().min(1).optional(),
  range: z.string().min(1).optional(),
});

export const TruncationInfoSchema = z.object({
  direction: z.enum(['head', 'tail', 'middle']),
  truncatedBy: z.enum(['lines', 'bytes', 'middle']),
  totalLines: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  shownRange: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  headRange: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  tailRange: z.object({ start: z.number().int(), end: z.number().int() }).optional(),
  elidedLines: z.number().int().nonnegative().optional(),
  nextOffset: z.number().int().nonnegative().optional(),
  artifactId: z.string().min(1).optional(),
});

export const FileContentSchema = z.object({
  path: z.string().min(1),
  tag: z.string().min(1).optional(),
  text: z.string(),
  truncated: z.boolean(),
  truncation: TruncationInfoSchema.optional(),
});

export const FileResponseSchema = z.object({
  file: FileContentSchema,
});

export const DirEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['file', 'dir']),
  size: z.number().int().nonnegative().optional(),
});

export const DirListResponseSchema = z.object({
  entries: z.array(DirEntrySchema),
});

// Workspace picker: browse the server filesystem outside any session
// (no jail — same privilege as createSession cwd + remote bash).
export const BrowseQuerySchema = z.object({
  path: z.string().min(1).optional(),
});

export const BrowseResponseSchema = z.object({
  browse: z.object({
    path: z.string().min(1),
    parent: z.string().min(1).nullable(),
    entries: z.array(DirEntrySchema),
  }),
});

export const WriteFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const WriteFileResponseSchema = z.object({
  bytes: z.number().int().nonnegative(),
  tag: z.string().min(1),
});

export const EditFileSchema = z.object({
  path: z.string().min(1),
  tag: z.string().min(1),
  input: z.string(),
});

export const EditFileResponseSchema = z.object({
  tag: z.string().min(1),
  applied: z.boolean(),
});

export const BashRequestSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  /** Extra environment variables for this command only. */
  env: z.record(z.string().max(4096)).optional(),
  /** Allocate a PTY (interactive programs, colour output). */
  pty: z.boolean().optional(),
  /** Detach into the background job manager; the result carries a job id. */
  async: z.boolean().optional(),
});

export const BashResultSchema = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
  truncation: TruncationInfoSchema.optional(),
  jobId: z.string().min(1).optional(),
});

export const CellLanguageSchema = z.enum(['py', 'js']);

export const RunCellSchema = z.object({
  language: CellLanguageSchema,
  code: z.string(),
  title: z.string().min(1).optional(),
  /** Per-cell timeout in ms; omitted means the kernel default. */
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  /** Reset the kernel before this cell runs. */
  reset: z.boolean().optional(),
});

export const CellResultSchema = z.object({
  output: z.string(),
  images: z.array(z.string()).optional(),
});

export const ResetKernelSchema = z.object({
  language: CellLanguageSchema,
});

export const ResetKernelResponseSchema = z.object({
  ok: z.boolean(),
});

// ---------------------------------------------------------------------------
// P2b LSP + debug (SDK-direct, single-dispatch POST /:id/lsp + /:id/debug).
// ---------------------------------------------------------------------------

export const LspActionSchema = z.enum([
  'diagnostics',
  'definition',
  'references',
  'hover',
  'symbols',
  'rename',
  'rename_file',
  'code_actions',
  'type_definition',
  'implementation',
  'status',
  'reload',
  'capabilities',
  'request',
]);

export const LspRequestSchema = z.object({
  action: LspActionSchema,
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  /** Target name for `rename`. */
  new_name: z.string().min(1).optional(),
  /** `rename`/`rename_file` only: apply the edit instead of previewing it. */
  apply: z.boolean().optional(),
  /** Raw JSON payload for the `request` escape hatch. */
  payload: z.string().optional(),
});

export const LspResponseSchema = z.object({
  result: z.unknown(),
});

export const DebugActionSchema = z.enum([
  // SDK tool vocabulary (src/tools/debug.ts): one name set for TUI and web.
  'launch',
  'attach',
  'set_breakpoint',
  'remove_breakpoint',
  'set_instruction_breakpoint',
  'remove_instruction_breakpoint',
  'data_breakpoint_info',
  'set_data_breakpoint',
  'remove_data_breakpoint',
  'continue',
  'step_over',
  'step_in',
  'step_out',
  'pause',
  'evaluate',
  'stack_trace',
  'threads',
  'scopes',
  'variables',
  'disassemble',
  'read_memory',
  'write_memory',
  'modules',
  'loaded_sources',
  'custom_request',
  'output',
  'terminate',
  'sessions',
]);

export const DebugRequestSchema = z.object({
  action: DebugActionSchema,
  program: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(),
  adapter: z.string().min(1).optional(),
  pid: z.number().int().positive().optional(),
  port: z.number().int().positive().max(65_535).optional(),
  host: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  /** Function name for function breakpoints. */
  fn: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  /** Breakpoint id returned by a `set_*_breakpoint` action. */
  id: z.number().int().nonnegative().optional(),
  expression: z.string().min(1).optional(),
  /** Evaluate context: watch | repl | hover | variables | clipboard. */
  context: z.string().min(1).optional(),
  frameId: z.number().int().nonnegative().optional(),
  levels: z.number().int().positive().optional(),
  /** Scope or variable reference (`scopes` → `variables`). */
  ref: z.number().int().nonnegative().optional(),
  /** Raw JSON arguments for `custom_request`. */
  arguments: z.record(z.unknown()).optional(),
});

export const DebugResponseSchema = z.object({
  result: z.unknown(),
});
export const HubAgentMetricsSchema = z.object({
  tokens: z.number().nonnegative(),
  requests: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  durationMs: z.number().nonnegative(),
});

export const HubAgentSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  kind: z.string(),
  status: z.enum(['running', 'idle', 'parked', 'aborted']),
  parentId: z.string().min(1).optional(),
  activity: z.string().optional(),
  model: z.string().optional(),
  sessionFile: z.string().nullable(),
  createdAt: z.string().min(1),
  lastActivity: z.string().min(1),
  metrics: HubAgentMetricsSchema.optional(),
  /** Unread agent-to-agent messages waiting for this agent. */
  unread: z.number().int().nonnegative(),
  /** The registry can bring this agent back from its journal. */
  revivable: z.boolean(),
});

export const HubTranscriptEntrySchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  text: z.string(),
  createdAt: z.string().min(1),
});

export const HubMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  body: z.string(),
  ts: z.number(),
  replyTo: z.string().min(1).optional(),
});

export const HubSendSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  text: z.string().min(1).max(8000),
});

export const HubWaitResponseSchema = z.object({
  message: HubMessageSchema.nullable(),
});

export const HubSendResponseSchema = z.object({
  outcome: z.enum(['injected', 'woken', 'revived', 'failed']),
  error: z.string().optional(),
});

export const HubWaitSchema = z.object({
  from: z.string().min(1).optional(),
  /** Milliseconds to block; 0 waits indefinitely (server caps it). */
  timeoutMs: z.number().int().nonnegative().max(120_000).default(30_000),
});

export const HubInboxResponseSchema = z.object({
  messages: z.array(HubMessageSchema),
});

export const HubTranscriptResponseSchema = z.object({
  entries: z.array(HubTranscriptEntrySchema),
});

export const HubRosterResponseSchema = z.object({
  agents: z.array(HubAgentSchema),
});

export const HubSteerSchema = z.object({
  text: z.string().min(1),
});

export const HubReviveResponseSchema = z.object({
  revived: z.boolean(),
  revivable: z.boolean(),
  transcript: z.string().optional(),
});

export const HubKillResponseSchema = z.object({
  killed: z.boolean(),
});

export const HubJobSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  label: z.string(),
  agentId: z.string().optional(),
  startedAt: z.string().min(1),
});

export const HubJobsResponseSchema = z.object({
  jobs: z.array(HubJobSchema),
});

export const HubJobsCancelSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
});

export const HubJobsCancelResponseSchema = z.object({
  cancelled: z.array(z.string()),
});

export const HubSpawnSchema = z.object({
  sessionId: z.string().min(1),
  agent: z.string().min(1).optional(),
  task: z.string().min(1),
  context: z.string().optional(),
  outputSchema: z.unknown().optional(),
  schemaMode: z.enum(['permissive', 'strict']).optional(),
  /** Model override (provider/model id or role alias). */
  model: z.string().min(1).optional(),
  /** Coarse thinking effort for the subagent. */
  effort: z.enum(['lo', 'med', 'hi']).optional(),
  isolation: z
    .object({
      requested: z.boolean().optional(),
      merge: z.enum(['patch', 'branch']).optional(),
      apply: z.boolean().optional(),
    })
    .optional(),
  detached: z.boolean().optional(),
});

export const HubSpawnResponseSchema = z.object({
  agentId: z.string().min(1),
});

export const TodoStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'abandoned',
  'blocked',
]);

export const TodoTaskSchema = z.object({
  content: z.string().min(1),
  status: TodoStatusSchema,
  blocker: z.string().optional(),
});

export const TodoPhaseSchema = z.object({
  name: z.string().min(1),
  tasks: z.array(TodoTaskSchema),
});

export const TodosResponseSchema = z.object({
  phases: z.array(TodoPhaseSchema),
});

export const TodoOpSchema = z.object({
  op: z.enum(['init', 'start', 'done', 'rm', 'drop', 'block', 'unblock', 'append', 'view']),
  payload: z.unknown().optional(),
});

export const ArtifactRefSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  size: z.number().int().nonnegative(),
  path: z.string().min(1),
});

export const ArtifactsResponseSchema = z.object({
  artifacts: z.array(ArtifactRefSchema),
});

export const ArtifactQuerySchema = z.object({
  range: z.string().min(1).optional(),
});

export const ArtifactContentSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
  truncation: TruncationInfoSchema.optional(),
});

export type FilesQueryDto = z.infer<typeof FilesQuerySchema>;
export type FileContentDto = z.infer<typeof FileContentSchema>;
export type FileResponseDto = z.infer<typeof FileResponseSchema>;
export type DirEntryDto = z.infer<typeof DirEntrySchema>;
export type DirListResponseDto = z.infer<typeof DirListResponseSchema>;
export type BrowseQueryDto = z.infer<typeof BrowseQuerySchema>;
export type BrowseResponseDto = z.infer<typeof BrowseResponseSchema>;
export type WriteFileDto = z.infer<typeof WriteFileSchema>;
export type WriteFileResponseDto = z.infer<typeof WriteFileResponseSchema>;
export type EditFileDto = z.infer<typeof EditFileSchema>;
export type EditFileResponseDto = z.infer<typeof EditFileResponseSchema>;
export type BashRequestDto = z.infer<typeof BashRequestSchema>;
export type TruncationInfoDto = z.infer<typeof TruncationInfoSchema>;
export type BashResultDto = z.infer<typeof BashResultSchema>;
export type CellLanguageDto = z.infer<typeof CellLanguageSchema>;
export type RunCellDto = z.infer<typeof RunCellSchema>;
export type CellResultDto = z.infer<typeof CellResultSchema>;
export type ResetKernelDto = z.infer<typeof ResetKernelSchema>;
export type ResetKernelResponseDto = z.infer<typeof ResetKernelResponseSchema>;
export type TodoStatusDto = z.infer<typeof TodoStatusSchema>;
export type TodoTaskDto = z.infer<typeof TodoTaskSchema>;
export type TodoPhaseDto = z.infer<typeof TodoPhaseSchema>;
export type TodosResponseDto = z.infer<typeof TodosResponseSchema>;
export type TodoOpDto = z.infer<typeof TodoOpSchema>;
export type ArtifactRefDto = z.infer<typeof ArtifactRefSchema>;
export type ArtifactsResponseDto = z.infer<typeof ArtifactsResponseSchema>;
export type ArtifactQueryDto = z.infer<typeof ArtifactQuerySchema>;
export type ArtifactContentDto = z.infer<typeof ArtifactContentSchema>;
export type LspActionDto = z.infer<typeof LspActionSchema>;
export type LspRequestDto = z.infer<typeof LspRequestSchema>;
export type LspResponseDto = z.infer<typeof LspResponseSchema>;
export type DebugActionDto = z.infer<typeof DebugActionSchema>;
export type DebugRequestDto = z.infer<typeof DebugRequestSchema>;
export type DebugResponseDto = z.infer<typeof DebugResponseSchema>;
export type SessionInfoDto = z.infer<typeof SessionInfoSchema>;
export type SessionStatusDto = z.infer<typeof SessionStatusSchema>;
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;
export type PromptDto = z.infer<typeof PromptSchema>;
export type PromptImage = z.infer<typeof PromptImageSchema>;
export type MessagesQueryDto = z.infer<typeof MessagesQuerySchema>;
export type ToolPartDto = z.infer<typeof ToolPartSchema>;
export type HealthDto = z.infer<typeof HealthSchema>;
export type SessionListResponseDto = z.infer<typeof SessionListResponseSchema>;
export type CreateSessionResponseDto = z.infer<typeof CreateSessionResponseSchema>;
export type MessagesResponseDto = z.infer<typeof MessagesResponseSchema>;
export type PromptResponseDto = z.infer<typeof PromptResponseSchema>;
export type AbortResponseDto = z.infer<typeof AbortResponseSchema>;
export type ApprovalDecisionDto = z.infer<typeof ApprovalDecisionSchema>;
export type ApprovalDecisionResponseDto = z.infer<typeof ApprovalDecisionResponseSchema>;
export type TreeNodeDto = z.infer<typeof TreeNodeSchema>;
export type TreeResponseDto = z.infer<typeof TreeResponseSchema>;
export type NavigateDto = z.infer<typeof NavigateSchema>;
export type BranchDto = z.infer<typeof BranchSchema>;
export type BranchResponseDto = z.infer<typeof BranchResponseSchema>;
export type LabelDto = z.infer<typeof LabelSchema>;

export type ExportResponseDto = z.infer<typeof ExportResponseSchema>;
export type DumpResponseDto = z.infer<typeof DumpResponseSchema>;
export type ShareResponseDto = z.infer<typeof ShareResponseSchema>;
export type RenameDto = z.infer<typeof RenameSchema>;
export type GoalStatusDto = z.infer<typeof GoalStatusSchema>;
export type SessionGoalDto = z.infer<typeof SessionGoalSchema>;
export type GoalStateDto = z.infer<typeof GoalStateSchema>;
export type GoalResponseDto = z.infer<typeof GoalResponseSchema>;
export type GoalActionDto = z.infer<typeof GoalActionSchema>;
export type PlanProposalDto = z.infer<typeof PlanProposalSchema>;
export type PlanDecisionDto = z.infer<typeof PlanDecisionSchema>;
export type PlanDecisionResponseDto = z.infer<typeof PlanDecisionResponseSchema>;
export type QueueModeDto = z.infer<typeof QueueModeSchema>;
export type InterruptModeDto = z.infer<typeof InterruptModeSchema>;
export type SessionModesDto = z.infer<typeof SessionModesSchema>;
export type ModesResponseDto = z.infer<typeof ModesResponseSchema>;
export type MoveDto = z.infer<typeof MoveSchema>;
export type ModeActionDto = z.infer<typeof ModeActionSchema>;
export type OkDto = z.infer<typeof OkSchema>;
export type CompactDto = z.infer<typeof CompactSchema>;
export type RetryResponseDto = z.infer<typeof RetryResponseSchema>;
export type DropResponseDto = z.infer<typeof DropResponseSchema>;
export type HubAgentDto = z.infer<typeof HubAgentSchema>;
export type HubAgentMetricsDto = z.infer<typeof HubAgentMetricsSchema>;
export type HubTranscriptEntryDto = z.infer<typeof HubTranscriptEntrySchema>;
export type HubMessageDto = z.infer<typeof HubMessageSchema>;
export type HubSendDto = z.infer<typeof HubSendSchema>;
export type HubSendResponseDto = z.infer<typeof HubSendResponseSchema>;
export type HubWaitDto = z.infer<typeof HubWaitSchema>;
export type HubRosterResponseDto = z.infer<typeof HubRosterResponseSchema>;
export type HubSteerDto = z.infer<typeof HubSteerSchema>;
export type HubReviveResponseDto = z.infer<typeof HubReviveResponseSchema>;
export type HubKillResponseDto = z.infer<typeof HubKillResponseSchema>;
export type HubJobDto = z.infer<typeof HubJobSchema>;
export type HubJobsResponseDto = z.infer<typeof HubJobsResponseSchema>;
export type HubJobsCancelDto = z.infer<typeof HubJobsCancelSchema>;
export type HubJobsCancelResponseDto = z.infer<typeof HubJobsCancelResponseSchema>;
export type HubSpawnDto = z.infer<typeof HubSpawnSchema>;
export type HubSpawnResponseDto = z.infer<typeof HubSpawnResponseSchema>;

// ---------------------------------------------------------------------------
// P4 settings plane (server-cwd scope; secrets never leave the server).
// ---------------------------------------------------------------------------

export const SettingEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  group: z.string().min(1),
  tab: z.string().min(1),
  value: z.unknown().optional(),
  masked: z.boolean(),
});

export const SettingsListResponseSchema = z.object({
  entries: z.array(SettingEntrySchema),
});

export const SettingResponseSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  masked: z.boolean().optional(),
});

export const SettingUpdateSchema = z
  .object({ value: z.unknown() })
  .refine((o) => 'value' in o, { message: 'value is required' });

export const SettingResetResponseSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  masked: z.boolean().optional(),
  reset: z.literal(true),
});

export const ThemeInfoSchema = z.object({
  name: z.string().min(1),
});

export const ThemeListResponseSchema = z.object({
  themes: z.array(ThemeInfoSchema),
  current: z.string().min(1),
  /** Configured dark theme name (TUI keeps both slots). */
  dark: z.string().default(''),
  /** Configured light theme name. */
  light: z.string().default(''),
});

export const ThemeApplySchema = z.object({
  name: z.string().min(1),
  /** Theme slot to write: the TUI keeps a dark and a light theme. */
  slot: z.enum(['dark', 'light']).default('dark'),
});

export const ThemeApplyResponseSchema = z.object({
  current: z.string().min(1),
});

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  available: z.boolean(),
  source: z.string().min(1),
});

export const ModelsResponseSchema = z.object({
  models: z.array(ModelEntrySchema),
});

export const ProviderAuthSchema = z.enum(['key', 'oauth', 'keyless', 'none']);

export const ProviderEntrySchema = z.object({
  id: z.string().min(1),
  available: z.boolean(),
  auth: ProviderAuthSchema,
});

export const ModelRoleEntrySchema = z.object({
  role: z.string().min(1),
  /** Display name (configured tag or built-in role name). */
  name: z.string(),
  /** Assigned model id; null means the role falls back through the resolver. */
  model: z.string().nullable(),
});

export const ModelRolesResponseSchema = z.object({
  roles: z.array(ModelRoleEntrySchema),
});

export const ModelRoleUpdateSchema = z.object({
  /** Empty string clears the role's assignment. */
  model: z.string(),
});

export const ProvidersResponseSchema = z.object({
  providers: z.array(ProviderEntrySchema),
});

export const McpStatusSchema = z.enum(['connected', 'connecting', 'disconnected']);

export const McpServerEntrySchema = z.object({
  name: z.string().min(1),
  status: McpStatusSchema,
  transport: z.string().min(1),
  tools: z.number().int().nonnegative().optional(),
});

export const McpListResponseSchema = z.object({
  servers: z.array(McpServerEntrySchema),
});

export const McpActionSchema = z.enum(['test', 'reconnect', 'reload']);

export const McpToolEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  server: z.string(),
});

export const McpToolsResponseSchema = z.object({
  tools: z.array(McpToolEntrySchema),
});

export const McpActionResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});

export const SkillQuerySchema = z.object({
  path: z.string().min(1).optional(),
});

export const SessionSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Discovery source, e.g. `native:project` or `opencode:user`. */
  source: z.string(),
});

export const SessionSkillsResponseSchema = z.object({
  skills: z.array(SessionSkillSchema),
});

export const SkillContentResponseSchema = z.object({
  content: z.string(),
});

export const MemoryStateSchema = z.object({
  backend: z.string().min(1),
  /** Backend-specific status payload; null when the backend reports none. */
  status: z.unknown().nullable(),
});

export const MemoryOpSchema = z.object({
  op: z.enum(['status', 'view', 'stats', 'diagnose', 'queue', 'clear', 'enqueue', 'search']),
  query: z.string().min(1).max(2000).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const MemoryOpResultSchema = z.object({
  backend: z.string().min(1),
  result: z.unknown(),
});

export const MemoryBackendSchema = z.object({
  backend: z.enum(['off', 'local', 'hindsight', 'mnemopi', 'sharpshooter']),
});

export type SettingEntryDto = z.infer<typeof SettingEntrySchema>;
export type SettingsListResponseDto = z.infer<typeof SettingsListResponseSchema>;
export type SettingResponseDto = z.infer<typeof SettingResponseSchema>;
export type SettingUpdateDto = z.infer<typeof SettingUpdateSchema>;
export type SettingResetResponseDto = z.infer<typeof SettingResetResponseSchema>;
export type ThemeInfoDto = z.infer<typeof ThemeInfoSchema>;
export type ThemeListResponseDto = z.infer<typeof ThemeListResponseSchema>;
export type ThemeApplyDto = z.infer<typeof ThemeApplySchema>;
export type ThemeApplyResponseDto = z.infer<typeof ThemeApplyResponseSchema>;
export type ModelEntryDto = z.infer<typeof ModelEntrySchema>;
export type ModelsResponseDto = z.infer<typeof ModelsResponseSchema>;
export type ProviderAuthDto = z.infer<typeof ProviderAuthSchema>;
export type ProviderEntryDto = z.infer<typeof ProviderEntrySchema>;
export type ModelRoleEntryDto = z.infer<typeof ModelRoleEntrySchema>;
export type ModelRoleUpdateDto = z.infer<typeof ModelRoleUpdateSchema>;
export type ProvidersResponseDto = z.infer<typeof ProvidersResponseSchema>;
export type McpStatusDto = z.infer<typeof McpStatusSchema>;
export type McpServerEntryDto = z.infer<typeof McpServerEntrySchema>;
export type McpListResponseDto = z.infer<typeof McpListResponseSchema>;
export type McpActionDto = z.infer<typeof McpActionSchema>;
export type McpActionResponseDto = z.infer<typeof McpActionResponseSchema>;
export type McpToolEntryDto = z.infer<typeof McpToolEntrySchema>;
export type SkillQueryDto = z.infer<typeof SkillQuerySchema>;
export type SkillContentResponseDto = z.infer<typeof SkillContentResponseSchema>;
export type SessionSkillDto = z.infer<typeof SessionSkillSchema>;
export type MemoryStateDto = z.infer<typeof MemoryStateSchema>;
export type MemoryOpDto = z.infer<typeof MemoryOpSchema>;
export type MemoryOpResultDto = z.infer<typeof MemoryOpResultSchema>;
export type MemoryBackendDto = z.infer<typeof MemoryBackendSchema>;

export const CommandsQuerySchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const CommandInfoSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  description: z.string(),
  hint: z.string().optional(),
  source: z.enum(['builtin', 'file']),
  localOnly: z.boolean().optional(),
});

export const CommandsResponseSchema = z.object({
  commands: z.array(CommandInfoSchema),
});
export type CommandsQueryDto = z.infer<typeof CommandsQuerySchema>;
export type CommandInfoDto = z.infer<typeof CommandInfoSchema>;
export type CommandsResponseDto = z.infer<typeof CommandsResponseSchema>;

export const ModelRefSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
});

export const ConflictEntrySchema = z.object({
  id: z.number().int().positive(),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  oursLabel: z.string().nullable(),
  theirsLabel: z.string().nullable(),
  hasBase: z.boolean(),
});

export const ConflictsResponseSchema = z.object({
  conflicts: z.array(ConflictEntrySchema),
});

export const ConflictSideSchema = z.enum(['ours', 'theirs', 'base', 'both']);

export const ResolveConflictsSchema = z.object({
  /** Empty resolves every known conflict. */
  ids: z.array(z.number().int().positive()).max(500).default([]),
  side: ConflictSideSchema,
});

export const ResolveConflictsResponseSchema = z.object({
  /** Conflicts still registered after the write (0 means fully resolved). */
  remaining: z.number().int().nonnegative(),
});

export const ContextBreakdownSchema = z.object({
  contextWindow: z.number().int().nonnegative(),
  usedTokens: z.number().int().nonnegative(),
  anchored: z.boolean(),
  systemPromptTokens: z.number().int().nonnegative(),
  systemToolsTokens: z.number().int().nonnegative(),
  systemContextTokens: z.number().int().nonnegative(),
  skillsTokens: z.number().int().nonnegative(),
  messagesTokens: z.number().int().nonnegative(),
});

export const SessionWorkspaceSchema = z.object({
  cwd: z.string().min(1),
  directories: z.array(z.string().min(1)),
});

export const WorkspaceDirSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const WorkspaceDirChangeResponseSchema = z.object({
  added: z.string().nullable().optional(),
  removed: z.string().nullable().optional(),
  workspace: SessionWorkspaceSchema,
});

export const SessionStatsSchema = z.object({
  sessionFile: z.string().nullable(),
  tokens: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    reasoning: z.number().int().nonnegative(),
    cacheRead: z.number().int().nonnegative(),
    cacheWrite: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  cost: z.number().nonnegative(),
  premiumRequests: z.number().int().nonnegative(),
  credits: z
    .object({
      cost: z.number(),
      committedCost: z.number(),
      acuCost: z.number(),
    })
    .optional(),
  routedModels: z.record(z.string(), z.number().int().nonnegative()).optional(),
  userMessages: z.number().int().nonnegative(),
  assistantMessages: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolResults: z.number().int().nonnegative(),
  totalMessages: z.number().int().nonnegative(),
  context: z
    .object({
      tokens: z.number().int().nonnegative(),
      contextWindow: z.number().int().nonnegative(),
      percent: z.number().min(0),
    })
    .nullable(),
  contextBreakdown: ContextBreakdownSchema.nullable(),
});

export const SessionModelStateSchema = z.object({
  models: z.array(ModelRefSchema),
  current: ModelRefSchema.nullable(),
  thinking: z.string().nullable(),
});

export const SetModelSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

export const SetThinkingSchema = z.object({
  level: z.string().min(1),
});
export type ModelRefDto = z.infer<typeof ModelRefSchema>;
export type SessionModelStateDto = z.infer<typeof SessionModelStateSchema>;
export type SessionStatsDto = z.infer<typeof SessionStatsSchema>;
export type SessionWorkspaceDto = z.infer<typeof SessionWorkspaceSchema>;
export type WorkspaceDirDto = z.infer<typeof WorkspaceDirSchema>;
export type WorkspaceDirChangeResponseDto = z.infer<typeof WorkspaceDirChangeResponseSchema>;
export type ContextBreakdownDto = z.infer<typeof ContextBreakdownSchema>;
export type ConflictEntryDto = z.infer<typeof ConflictEntrySchema>;
export type ConflictSideDto = z.infer<typeof ConflictSideSchema>;
export type ResolveConflictsDto = z.infer<typeof ResolveConflictsSchema>;
export type ResolveConflictsResponseDto = z.infer<typeof ResolveConflictsResponseSchema>;
export type SetModelDto = z.infer<typeof SetModelSchema>;
export type SetThinkingDto = z.infer<typeof SetThinkingSchema>;

export const SetModelResponseSchema = z.object({
  current: ModelRefSchema,
});
export const SetThinkingResponseSchema = z.object({
  thinking: z.string().min(1),
});
export type SetModelResponseDto = z.infer<typeof SetModelResponseSchema>;
export type SetThinkingResponseDto = z.infer<typeof SetThinkingResponseSchema>;
