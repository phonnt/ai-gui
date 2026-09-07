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
