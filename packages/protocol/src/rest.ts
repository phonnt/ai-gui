import { z } from 'zod';

export const SessionInfoSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const CreateSessionSchema = z.object({
  cwd: z.string().min(1).optional(),
});

export const PromptSchema = z.object({
  text: z.string().min(1),
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

export const ExportResponseSchema = z.object({
  html: z.string(),
});

export const DumpResponseSchema = z.object({
  text: z.string(),
});

export const ShareResponseSchema = z.object({
  url: z.string().min(1),
});

export const RenameSchema = z.object({
  title: z.string().min(1),
});

export const OkSchema = z.object({
  ok: z.literal(true),
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

export const FileContentSchema = z.object({
  path: z.string().min(1),
  tag: z.string().min(1).optional(),
  text: z.string(),
  truncated: z.boolean(),
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
});

export const BashResultSchema = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  truncated: z.boolean(),
});

export const CellLanguageSchema = z.enum(['py', 'js']);

export const RunCellSchema = z.object({
  language: CellLanguageSchema,
  code: z.string(),
  title: z.string().min(1).optional(),
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

export const LspActionSchema = z.enum(['diagnostics', 'definition', 'hover', 'symbols', 'status']);

export const LspRequestSchema = z.object({
  action: LspActionSchema,
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
});

export const LspResponseSchema = z.object({
  result: z.unknown(),
});

export const DebugActionSchema = z.enum([
  'launch',
  'attach',
  'breakpoint',
  'unbreak',
  'continue',
  'step',
  'pause',
  'evaluate',
  'threads',
  'stack',
  'scopes',
  'variables',
  'output',
  'terminate',
  'sessions',
]);

export const DebugStepKindSchema = z.enum(['over', 'in', 'out']);

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
  fn: z.string().min(1).optional(),
  condition: z.string().min(1).optional(),
  id: z.number().int().nonnegative().optional(),
  kind: DebugStepKindSchema.optional(),
  expression: z.string().min(1).optional(),
  frameId: z.number().int().nonnegative().optional(),
  levels: z.number().int().positive().optional(),
  ref: z.number().int().nonnegative().optional(),
});

export const DebugResponseSchema = z.object({
  result: z.unknown(),
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
export type DebugStepKindDto = z.infer<typeof DebugStepKindSchema>;
export type DebugRequestDto = z.infer<typeof DebugRequestSchema>;
export type DebugResponseDto = z.infer<typeof DebugResponseSchema>;
export type SessionInfoDto = z.infer<typeof SessionInfoSchema>;
export type CreateSessionDto = z.infer<typeof CreateSessionSchema>;
export type PromptDto = z.infer<typeof PromptSchema>;
export type MessagesQueryDto = z.infer<typeof MessagesQuerySchema>;
export type ToolPartDto = z.infer<typeof ToolPartSchema>;
export type HealthDto = z.infer<typeof HealthSchema>;
export type SessionListResponseDto = z.infer<typeof SessionListResponseSchema>;
export type CreateSessionResponseDto = z.infer<typeof CreateSessionResponseSchema>;
export type MessagesResponseDto = z.infer<typeof MessagesResponseSchema>;
export type PromptResponseDto = z.infer<typeof PromptResponseSchema>;
export type AbortResponseDto = z.infer<typeof AbortResponseSchema>;

export type TreeNodeDto = z.infer<typeof TreeNodeSchema>;
export type TreeResponseDto = z.infer<typeof TreeResponseSchema>;
export type NavigateDto = z.infer<typeof NavigateSchema>;
export type BranchDto = z.infer<typeof BranchSchema>;
export type ExportResponseDto = z.infer<typeof ExportResponseSchema>;
export type DumpResponseDto = z.infer<typeof DumpResponseSchema>;
export type ShareResponseDto = z.infer<typeof ShareResponseSchema>;
export type RenameDto = z.infer<typeof RenameSchema>;
export type OkDto = z.infer<typeof OkSchema>;
export type DropResponseDto = z.infer<typeof DropResponseSchema>;
export type HubAgentDto = z.infer<typeof HubAgentSchema>;
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
});

export const ThemeApplySchema = z.object({
  name: z.string().min(1),
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

export const McpActionResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string().optional(),
});

export const SkillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  source: z.string().min(1),
});

export const SkillsResponseSchema = z.object({
  skills: z.array(SkillEntrySchema),
});

export const SkillQuerySchema = z.object({
  path: z.string().min(1).optional(),
});

export const SkillContentResponseSchema = z.object({
  content: z.string(),
});

export const MemoryResponseSchema = z.object({
  backend: z.string().min(1),
  summary: z.unknown().optional(),
});

export const MemoryEnqueueResponseSchema = z.object({
  ok: z.literal(true),
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
export type ProvidersResponseDto = z.infer<typeof ProvidersResponseSchema>;
export type McpStatusDto = z.infer<typeof McpStatusSchema>;
export type McpServerEntryDto = z.infer<typeof McpServerEntrySchema>;
export type McpListResponseDto = z.infer<typeof McpListResponseSchema>;
export type McpActionDto = z.infer<typeof McpActionSchema>;
export type McpActionResponseDto = z.infer<typeof McpActionResponseSchema>;
export type SkillEntryDto = z.infer<typeof SkillEntrySchema>;
export type SkillsResponseDto = z.infer<typeof SkillsResponseSchema>;
export type SkillQueryDto = z.infer<typeof SkillQuerySchema>;
export type SkillContentResponseDto = z.infer<typeof SkillContentResponseSchema>;
export type MemoryResponseDto = z.infer<typeof MemoryResponseSchema>;
export type MemoryEnqueueResponseDto = z.infer<typeof MemoryEnqueueResponseSchema>;

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
