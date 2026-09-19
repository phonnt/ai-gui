import type { SessionInfo } from '@ai-gui/core';
import {
  type AbortResponseDto,
  AbortResponseSchema,
  type ApprovalDecisionResponseDto,
  ApprovalDecisionResponseSchema,
  type ArtifactContentDto,
  ArtifactContentSchema,
  type ArtifactRefDto,
  ArtifactsResponseSchema,
  type BashResultDto,
  BashResultSchema,
  type BranchResponseDto,
  BranchResponseSchema,
  type BrowseResponseDto,
  BrowseResponseSchema,
  type CellLanguageDto,
  type CellResultDto,
  CellResultSchema,
  type CommandInfoDto,
  CommandsResponseSchema,
  type ConflictEntryDto,
  ConflictsResponseSchema,
  type CreateSessionDto,
  type CreateSessionResponseDto,
  CreateSessionResponseSchema,
  type DebugActionDto,
  type DebugRequestDto,
  DebugResponseSchema,
  type DirEntryDto,
  DirListResponseSchema,
  type DropResponseDto,
  DropResponseSchema,
  type DumpResponseDto,
  DumpResponseSchema,
  type EditFileResponseDto,
  EditFileResponseSchema,
  type ExportResponseDto,
  ExportResponseSchema,
  type FileContentDto,
  FileResponseSchema,
  type GoalActionDto,
  type GoalResponseDto,
  GoalResponseSchema,
  type GoalStateDto,
  type HealthDto,
  HealthSchema,
  type HubAgentDto,
  HubAgentSchema,
  type HubJobDto,
  HubJobSchema,
  HubJobsCancelResponseSchema,
  HubJobsResponseSchema,
  HubKillResponseSchema,
  HubReviveResponseSchema,
  HubRosterResponseSchema,
  HubSpawnResponseSchema,
  type HubTranscriptEntryDto,
  HubTranscriptEntrySchema,
  HubTranscriptResponseSchema,
  type LspActionDto,
  type LspRequestDto,
  LspResponseSchema,
  type McpActionDto,
  type McpActionResponseDto,
  McpActionResponseSchema,
  McpListResponseSchema,
  type McpServerEntryDto,
  MemoryEnqueueResponseSchema,
  type MemoryResponseDto,
  MemoryResponseSchema,
  type MessagesQueryDto,
  type MessagesResponseDto,
  MessagesResponseSchema,
  type ModeActionDto,
  type ModelEntryDto,
  type ModelRefDto,
  ModelsResponseSchema,
  type ModesResponseDto,
  ModesResponseSchema,
  type OkDto,
  OkSchema,
  type PromptDto,
  type PromptResponseDto,
  PromptResponseSchema,
  type ProviderAuthDto,
  type ProviderEntryDto,
  ProvidersResponseSchema,
  type ResetKernelResponseDto,
  ResetKernelResponseSchema,
  type ResolveConflictsDto,
  type ResolveConflictsResponseDto,
  ResolveConflictsResponseSchema,
  type RetryResponseDto,
  RetryResponseSchema,
  SessionListResponseSchema,
  type SessionModelStateDto,
  SessionModelStateSchema,
  type SessionModesDto,
  type SessionStatsDto,
  SessionStatsSchema,
  SetModelResponseSchema,
  SetThinkingResponseSchema,
  type SettingEntryDto,
  type SettingResetResponseDto,
  SettingResetResponseSchema,
  type SettingResponseDto,
  SettingResponseSchema,
  SettingsListResponseSchema,
  type ShareResponseDto,
  ShareResponseSchema,
  type SkillContentResponseDto,
  SkillContentResponseSchema,
  type SkillEntryDto,
  SkillsResponseSchema,
  type ThemeApplyResponseDto,
  ThemeApplyResponseSchema,
  type ThemeInfoDto,
  type ThemeListResponseDto,
  ThemeListResponseSchema,
  type TodoPhaseDto,
  TodosResponseSchema,
  type TodoTaskDto,
  type TreeResponseDto,
  TreeResponseSchema,
  type TruncationInfoDto,
  type WriteFileResponseDto,
  WriteFileResponseSchema,
} from '@ai-gui/protocol';

export type { PromptImage } from '@ai-gui/protocol';

/** Truncation facts attached to bounded tool output (ranges + full artifact). */
export type P2aTruncation = TruncationInfoDto;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface ResponseShape<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

async function parseBody<T>(res: Response, schema: ResponseShape<T>): Promise<Result<T>> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    try {
      const body: unknown = JSON.parse(text);
      if (typeof body === 'object' && body !== null && 'error' in body) {
        const message: unknown = body.error;
        if (typeof message === 'string' && message) return { ok: false, error: message };
      }
    } catch {
      /* non-JSON error body falls through to raw text */
    }
    return { ok: false, error: text || `Request failed with status ${res.status}` };
  }
  const json: unknown = await res.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'Unexpected response shape from server' };
  return { ok: true, data: parsed.data };
}

async function call<T>(
  path: string,
  schema: ResponseShape<T>,
  init?: RequestInit,
): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
  return parseBody(res, schema);
}

function withBody<T>(body: T): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

function queryString(query?: MessagesQueryDto): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function getHealth(): Promise<Result<HealthDto>> {
  return call('/api/health', HealthSchema);
}

export async function listSessions(): Promise<Result<SessionInfo[]>> {
  const res = await call('/api/sessions', SessionListResponseSchema);
  if (!res.ok) return res;
  return { ok: true, data: res.data.sessions };
}

export async function createSession(input: CreateSessionDto): Promise<Result<SessionInfo>> {
  const res = await call('/api/sessions', CreateSessionResponseSchema, withBody(input));
  if (!res.ok) return res;
  return { ok: true, data: res.data.session };
}

export function getMessages(
  sessionId: string,
  query?: MessagesQueryDto,
): Promise<Result<MessagesResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages${queryString(query)}`,
    MessagesResponseSchema,
  );
}

export function promptSession(
  sessionId: string,
  input: PromptDto,
): Promise<Result<PromptResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
    PromptResponseSchema,
    withBody(input),
  );
}

export function abortSession(sessionId: string): Promise<Result<AbortResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/abort`,
    AbortResponseSchema,
    withBody({}),
  );
}

export function decideApproval(
  sessionId: string,
  approvalId: string,
  approved: boolean,
): Promise<Result<ApprovalDecisionResponseDto>> {
  return call(
    `/api/sessions/${encodeURIComponent(sessionId)}/approval/${encodeURIComponent(approvalId)}`,
    ApprovalDecisionResponseSchema,
    withBody({ approved }),
  );
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

function withJson(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method, headers: { 'Content-Type': 'application/json' } }
    : { method, body: JSON.stringify(body) };
}

function sessionPath(sessionId: string, suffix = ''): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

async function unwrapSession(res: Result<CreateSessionResponseDto>): Promise<Result<SessionInfo>> {
  if (!res.ok) return res;
  return { ok: true, data: res.data.session };
}

export function forkSession(sessionId: string): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(sessionId, '/fork'),
    CreateSessionResponseSchema,
    withJson('POST', {}),
  ).then(unwrapSession);
}

export function clearSession(sessionId: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/clear'), OkSchema, withJson('POST', {}));
}

export function freshSession(sessionId: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/fresh'), OkSchema, withJson('POST', {}));
}

export function compactSession(sessionId: string, instructions?: string): Promise<Result<OkDto>> {
  return call(
    sessionPath(sessionId, '/compact'),
    OkSchema,
    withJson('POST', instructions ? { instructions } : {}),
  );
}

export function retryTurn(sessionId: string): Promise<Result<RetryResponseDto>> {
  return call(sessionPath(sessionId, '/retry'), RetryResponseSchema, withJson('POST', {}));
}

export function dropSession(sessionId: string): Promise<Result<DropResponseDto>> {
  return call(sessionPath(sessionId), DropResponseSchema, withJson('DELETE'));
}

export function getTree(sessionId: string): Promise<Result<TreeResponseDto>> {
  return call(sessionPath(sessionId, '/tree'), TreeResponseSchema);
}

export function navigateTree(input: NavigateInput): Promise<Result<OkDto>> {
  return call(
    sessionPath(input.sessionId, '/tree/navigate'),
    OkSchema,
    withJson('POST', { leafId: input.leafId }),
  );
}

export function branchSession(input: BranchInput): Promise<Result<BranchResponseDto>> {
  return call(
    sessionPath(input.sessionId, '/branch'),
    BranchResponseSchema,
    withJson('POST', input.parentId === undefined ? {} : { parentId: input.parentId }),
  );
}

export function labelTreeEntry(
  sessionId: string,
  entryId: string,
  label: string,
): Promise<Result<OkDto>> {
  return call(
    sessionPath(sessionId, '/tree/label'),
    OkSchema,
    withJson('POST', { entryId, label }),
  );
}

export function exportHtml(
  sessionId: string,
  userThemes?: boolean,
): Promise<Result<ExportResponseDto>> {
  const qs = userThemes ? '?theme=user' : '';
  return call(sessionPath(sessionId, `/export${qs}`), ExportResponseSchema);
}

export function dumpSession(sessionId: string): Promise<Result<DumpResponseDto>> {
  return call(sessionPath(sessionId, '/dump'), DumpResponseSchema);
}

export function shareSession(sessionId: string): Promise<Result<ShareResponseDto>> {
  return call(sessionPath(sessionId, '/share'), ShareResponseSchema, withJson('POST', {}));
}

export function moveSession(sessionId: string, cwd: string): Promise<Result<OkDto>> {
  return call(sessionPath(sessionId, '/move'), OkSchema, withJson('POST', { cwd }));
}

export function renameSession(input: RenameInput): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(input.sessionId),
    CreateSessionResponseSchema,
    withJson('PATCH', { title: input.title }),
  ).then(unwrapSession);
}

export function getGoal(sessionId: string): Promise<Result<GoalStateDto>> {
  return unwrapEnvelope(
    call<GoalResponseDto>(sessionPath(sessionId, '/goal'), GoalResponseSchema),
    'goal',
  );
}

export function goalAction(
  sessionId: string,
  action: GoalActionDto,
): Promise<Result<GoalStateDto>> {
  return unwrapEnvelope(
    call<GoalResponseDto>(
      sessionPath(sessionId, '/goal'),
      GoalResponseSchema,
      withJson('POST', action),
    ),
    'goal',
  );
}

export function getModes(sessionId: string): Promise<Result<SessionModesDto>> {
  return unwrapEnvelope(
    call<ModesResponseDto>(sessionPath(sessionId, '/modes'), ModesResponseSchema),
    'modes',
  );
}

export function modeAction(
  sessionId: string,
  action: ModeActionDto,
): Promise<Result<SessionModesDto>> {
  return unwrapEnvelope(
    call<ModesResponseDto>(
      sessionPath(sessionId, '/modes'),
      ModesResponseSchema,
      withJson('POST', action),
    ),
    'modes',
  );
}
// P2a session tools (validated against protocol schemas).
// ---------------------------------------------------------------------------

export type P2aFileContent = FileContentDto;
export type P2aDirEntry = DirEntryDto;
export type P2aBashResult = BashResultDto;
export type P2aTodoTask = TodoTaskDto;
export type P2aTodoPhase = TodoPhaseDto;
export type P2aArtifactRef = ArtifactRefDto;
export type P2aArtifactContent = ArtifactContentDto;
export type P2aWriteResult = WriteFileResponseDto;
export type P2aEditResult = EditFileResponseDto;
export type P2aCellLanguage = CellLanguageDto;

/**
 * Server sends cell images as plain strings; the union keeps the client
 * tolerant if a future backend emits structured { mimeType, data } images.
 */
export type P2aCellResult = Omit<CellResultDto, 'images'> & {
  images?: (string | P2aCellImage)[];
};

export interface P2aCellImage {
  mimeType: string;
  data: string;
}

export function cellImageSrc(image: string | P2aCellImage): string {
  if (typeof image === 'string') return image;
  if (image.data.startsWith('data:')) return image.data;
  return `data:${image.mimeType};base64,${image.data}`;
}

function toolsPath(sessionId: string, suffix: string): string {
  return sessionPath(sessionId, suffix);
}

function filesQuery(path?: string, range?: string): string {
  const params = new URLSearchParams();
  if (path !== undefined) params.set('path', path);
  if (range !== undefined && range !== '') params.set('range', range);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function unwrapEnvelope<T, K extends string>(
  promise: Promise<Result<Record<K, T>>>,
  key: K,
): Promise<Result<T>> {
  const res = await promise;
  if (!res.ok) return res;
  return { ok: true, data: res.data[key] };
}

export function readFile(
  sessionId: string,
  path: string,
  range?: string,
): Promise<Result<P2aFileContent>> {
  return unwrapEnvelope(
    call<{ file: P2aFileContent }>(
      toolsPath(sessionId, `/files${filesQuery(path, range)}`),
      FileResponseSchema,
    ),
    'file',
  );
}

export function listDir(sessionId: string, path?: string): Promise<Result<P2aDirEntry[]>> {
  return unwrapEnvelope(
    call<{ entries: P2aDirEntry[] }>(
      toolsPath(sessionId, `/files/list${filesQuery(path)}`),
      DirListResponseSchema,
    ),
    'entries',
  );
}
export function browseDir(path?: string): Promise<Result<BrowseResponseDto['browse']>> {
  const qs = path !== undefined ? `?path=${encodeURIComponent(path)}` : '';
  return unwrapEnvelope(
    call<BrowseResponseDto>(`/api/fs/browse${qs}`, BrowseResponseSchema),
    'browse',
  );
}

export function writeFile(
  sessionId: string,
  path: string,
  content: string,
): Promise<Result<P2aWriteResult>> {
  return call<P2aWriteResult>(
    toolsPath(sessionId, '/files'),
    WriteFileResponseSchema,
    withJson('POST', { path, content }),
  );
}

export function editFile(
  sessionId: string,
  path: string,
  tag: string,
  input: string,
): Promise<Result<P2aEditResult>> {
  return call<P2aEditResult>(
    toolsPath(sessionId, '/edit'),
    EditFileResponseSchema,
    withJson('POST', { path, tag, input }),
  );
}

export interface RunBashOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Extra environment variables for this command only. */
  env?: Record<string, string>;
  /** Allocate a PTY (interactive programs). */
  pty?: boolean;
  /** Detach into the background job manager. */
  async?: boolean;
}

export function runBash(
  sessionId: string,
  command: string,
  options: RunBashOptions = {},
): Promise<Result<P2aBashResult>> {
  return call<P2aBashResult>(
    toolsPath(sessionId, '/bash'),
    BashResultSchema,
    withJson('POST', { command, ...options }),
  );
}

export interface RunCellOptions {
  title?: string;
  /** Per-cell timeout in milliseconds; omitted means the kernel default. */
  timeoutMs?: number;
  /** Reset the kernel before running this cell. */
  reset?: boolean;
}

export function runCell(
  sessionId: string,
  language: P2aCellLanguage,
  code: string,
  options: RunCellOptions = {},
): Promise<Result<P2aCellResult>> {
  return call<P2aCellResult>(
    toolsPath(sessionId, '/cells'),
    CellResultSchema,
    withJson('POST', { language, code, ...options }),
  );
}

export function resetKernel(
  sessionId: string,
  language: P2aCellLanguage,
): Promise<Result<ResetKernelResponseDto>> {
  return call<ResetKernelResponseDto>(
    toolsPath(sessionId, '/cells/reset'),
    ResetKernelResponseSchema,
    withJson('POST', { language }),
  );
}

export function getTodos(sessionId: string): Promise<Result<P2aTodoPhase[]>> {
  return unwrapEnvelope(
    call<{ phases: P2aTodoPhase[] }>(toolsPath(sessionId, '/todos'), TodosResponseSchema),
    'phases',
  );
}

export function applyTodoOp(
  sessionId: string,
  op: string,
  payload?: unknown,
): Promise<Result<P2aTodoPhase[]>> {
  return unwrapEnvelope(
    call<{ phases: P2aTodoPhase[] }>(
      toolsPath(sessionId, '/todos'),
      TodosResponseSchema,
      withJson('POST', { op, payload }),
    ),
    'phases',
  );
}
export function listArtifacts(sessionId: string): Promise<Result<P2aArtifactRef[]>> {
  return unwrapEnvelope(
    call<{ artifacts: P2aArtifactRef[] }>(
      toolsPath(sessionId, '/artifacts'),
      ArtifactsResponseSchema,
    ),
    'artifacts',
  );
}

export function readArtifact(
  sessionId: string,
  id: string,
  range?: string,
): Promise<Result<P2aArtifactContent>> {
  const params = new URLSearchParams();
  if (range !== undefined && range !== '') params.set('range', range);
  const qs = params.toString();
  return call<P2aArtifactContent>(
    toolsPath(sessionId, `/artifacts/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`),
    ArtifactContentSchema,
  );
}

// ---------------------------------------------------------------------------
// P2b LSP + debug (single-dispatch POST routes, validated against protocol
// schemas: LspRequestSchema/LspResponseSchema, DebugRequestSchema/
// DebugResponseSchema → {result: unknown} envelopes).
// ---------------------------------------------------------------------------

export type LspAction = LspActionDto;
export type LspInput = LspRequestDto;
export type DebugAction = DebugActionDto;
export type DebugInput = DebugRequestDto;

export interface P2bLspDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: string;
  message: string;
}

export interface P2bLspLocation {
  file: string;
  line: number;
  column?: number;
}

export interface P2bLspSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface P2bLspStatus {
  servers: { name: string; status: string }[];
  ok: boolean;
}

export interface P2bDebugThread {
  id: number;
  name: string;
}

export interface P2bDebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
}

async function unwrapResult(
  promise: Promise<Result<{ result?: unknown }>>,
): Promise<Result<unknown>> {
  const res = await promise;
  if (!res.ok) return res;
  return { ok: true, data: res.data.result };
}

/** Single-dispatch LSP call: POST /:id/lsp {action, file?, line?, …} → result. */
export function lsp(sessionId: string, input: LspInput): Promise<Result<unknown>> {
  return unwrapResult(
    call(toolsPath(sessionId, '/lsp'), LspResponseSchema, withJson('POST', input)),
  );
}

/** Single-dispatch debug call: POST /:id/debug {action, …passthrough} → result. */
export function debugDebug(sessionId: string, input: DebugInput): Promise<Result<unknown>> {
  return unwrapResult(
    call(toolsPath(sessionId, '/debug'), DebugResponseSchema, withJson('POST', input)),
  );
}

/** Alias kept for callers that expect a `debug` export name. */
export const debug = debugDebug;

// ---------------------------------------------------------------------------
// P3 Agent Hub (SDK-direct wave 1). NOTE: @ai-gui/protocol currently defines
// no hub schemas/routes, so shapes here mirror the wave-1 contract:
// GET /api/hub/agents → {agents}; POST /api/hub/agents/:id/steer {text} → {ok};
// POST /:id/revive → {revived, revivable}; POST /:id/kill → {killed};
// GET /api/hub/jobs → {jobs}; POST /api/hub/jobs/cancel {ids?} → {cancelled};
// POST /api/hub/spawn {agent?, task, context?, outputSchema?} → {agentId}.
// If protocol gains hub schemas, prefer importing them and delete the local
// mirrors below.
// ---------------------------------------------------------------------------

export type HubAgentStatus = HubAgentDto['status'];
export type HubAgent = HubAgentDto;
export type HubJob = HubJobDto;
export type HubTranscriptEntry = HubTranscriptEntryDto;

export interface SpawnInput {
  sessionId: string;
  agent?: string;
  task: string;
  context?: string;
  outputSchema?: unknown;
}

export interface HubReviveResult {
  revived: boolean;
  revivable: boolean;
}

function hubAgentPath(id: string, suffix = ''): string {
  return `/api/hub/agents/${encodeURIComponent(id)}${suffix}`;
}

/** GET /api/hub/agents → {agents}. */
export function listHubAgents(): Promise<Result<HubAgent[]>> {
  return unwrapEnvelope(call('/api/hub/agents', HubRosterResponseSchema), 'agents');
}

/** POST /api/hub/agents/:id/steer {text} → {ok}. Steer uses the same prompt path. */
export function steerHubAgent(id: string, text: string): Promise<Result<{ ok: true }>> {
  return call(hubAgentPath(id, '/steer'), OkSchema, withJson('POST', { text }));
}

/** POST /api/hub/agents/:id/revive → {revived, revivable}. */
export function reviveHubAgent(id: string): Promise<Result<HubReviveResult>> {
  return call(hubAgentPath(id, '/revive'), HubReviveResponseSchema, withJson('POST', {}));
}

/** POST /api/hub/agents/:id/kill → {killed}. */
export function killHubAgent(id: string): Promise<Result<{ killed: boolean }>> {
  return call(hubAgentPath(id, '/kill'), HubKillResponseSchema, withJson('POST', {}));
}

/** GET /api/hub/agents/:id/transcript → read-only agent transcript rows. */
export function getHubTranscript(
  id: string,
  limit?: number,
): Promise<Result<HubTranscriptEntryDto[]>> {
  const qs = limit !== undefined ? `?limit=${limit}` : '';
  return unwrapEnvelope(
    call<{ entries: HubTranscriptEntryDto[] }>(
      hubAgentPath(id, `/transcript${qs}`),
      HubTranscriptResponseSchema,
    ),
    'entries',
  );
}

/** GET /api/hub/jobs → {jobs}. */
export function listHubJobs(): Promise<Result<HubJob[]>> {
  return unwrapEnvelope(call('/api/hub/jobs', HubJobsResponseSchema), 'jobs');
}

/** POST /api/hub/jobs/cancel {ids?} → {cancelled}. Omitted ids cancels all. */
export function cancelHubJobs(ids?: string[]): Promise<Result<{ cancelled: string[] }>> {
  return call(
    '/api/hub/jobs/cancel',
    HubJobsCancelResponseSchema,
    withJson('POST', ids === undefined ? {} : { ids }),
  );
}

/** POST /api/hub/spawn {agent?, task, context?, outputSchema?} → {agentId}. */
export function spawnHubAgent(input: SpawnInput): Promise<Result<{ agentId: string }>> {
  const body: Record<string, unknown> = { sessionId: input.sessionId, task: input.task };
  if (input.agent !== undefined && input.agent.trim().length > 0) body.agent = input.agent;
  if (input.context !== undefined && input.context.trim().length > 0) body.context = input.context;
  if (input.outputSchema !== undefined) body.outputSchema = input.outputSchema;
  return call('/api/hub/spawn', HubSpawnResponseSchema, withJson('POST', body));
}
// ---------------------------------------------------------------------------
// P4 Settings plane (SDK-direct, server-cwd scope; secrets never leave the
// server). Shapes validated against @ai-gui/protocol schemas.
// ---------------------------------------------------------------------------

export type SettingsEntry = SettingEntryDto;
export type SettingValue = SettingResponseDto;
export type SettingResetResult = SettingResetResponseDto;
export type ThemeInfo = ThemeInfoDto;
export type ThemesState = ThemeListResponseDto;
export type ModelInfo = ModelEntryDto;
export type ProviderAuth = ProviderAuthDto;
export type ProviderInfo = ProviderEntryDto;
export type McpServerInfo = McpServerEntryDto;
export type McpActionResult = McpActionResponseDto;
export type SkillInfo = SkillEntryDto;
export type SkillContent = SkillContentResponseDto;
export type MemoryState = MemoryResponseDto;

/** Tool count advertised by an MCP server (protocol: optional non-negative int). */
export function mcpToolCount(server: McpServerInfo): number | null {
  return server.tools ?? null;
}

/** Renderable text for a memory summary (protocol: unknown, usually string). */
export function memorySummaryText(state: MemoryState): string | null {
  const summary = state.summary;
  if (typeof summary === 'string') return summary.length > 0 ? summary : null;
  if (summary === undefined || summary === null) return null;
  try {
    return JSON.stringify(summary) ?? null;
  } catch {
    return null;
  }
}

/** GET /api/settings → {entries}. */
export function listSettings(): Promise<Result<SettingsEntry[]>> {
  return unwrapEnvelope(call('/api/settings', SettingsListResponseSchema), 'entries');
}

/** GET /api/settings/:key → {key,value}. */
export function getSetting(key: string): Promise<Result<SettingValue>> {
  return call(`/api/settings/${encodeURIComponent(key)}`, SettingResponseSchema);
}

/** PUT /api/settings/:key {value} → {key,value}. */
export function putSetting(key: string, value: unknown): Promise<Result<SettingValue>> {
  return call(
    `/api/settings/${encodeURIComponent(key)}`,
    SettingResponseSchema,
    withJson('PUT', { value }),
  );
}

/** DELETE /api/settings/:key → {key,value,reset:true}. */
export function resetSetting(key: string): Promise<Result<SettingResetResult>> {
  return call(
    `/api/settings/${encodeURIComponent(key)}`,
    SettingResetResponseSchema,
    withJson('DELETE'),
  );
}

/** GET /api/themes → {themes,current}. */
export function listThemes(): Promise<Result<ThemesState>> {
  return call('/api/themes', ThemeListResponseSchema);
}

/** POST /api/themes/apply {name} → {current}. */
export function applyTheme(name: string): Promise<Result<ThemeApplyResponseDto>> {
  return call('/api/themes/apply', ThemeApplyResponseSchema, withJson('POST', { name }));
}

/** GET /api/models → {models}. */
export function listModels(): Promise<Result<ModelInfo[]>> {
  return unwrapEnvelope(call('/api/models', ModelsResponseSchema), 'models');
}

/** GET /api/providers → {providers}. */
export function listProviders(): Promise<Result<ProviderInfo[]>> {
  return unwrapEnvelope(call('/api/providers', ProvidersResponseSchema), 'providers');
}

/** GET /api/mcp → {servers}. */
export function listMcpServers(): Promise<Result<McpServerInfo[]>> {
  return unwrapEnvelope(call('/api/mcp', McpListResponseSchema), 'servers');
}

function mcpActionPath(name: string, action: McpActionDto): string {
  return `/api/mcp/${encodeURIComponent(name)}/${action}`;
}

/** POST /api/mcp/:name/test → {ok,detail?}. */
export function testMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'test'), McpActionResponseSchema, withJson('POST', {}));
}

/** POST /api/mcp/:name/reconnect → {ok,detail?}. */
export function reconnectMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'reconnect'), McpActionResponseSchema, withJson('POST', {}));
}

/** POST /api/mcp/:name/reload → {ok,detail?}. */
export function reloadMcpServer(name: string): Promise<Result<McpActionResult>> {
  return call(mcpActionPath(name, 'reload'), McpActionResponseSchema, withJson('POST', {}));
}

/** GET /api/skills → {skills}. */
export function listSkills(): Promise<Result<SkillInfo[]>> {
  return unwrapEnvelope(call('/api/skills', SkillsResponseSchema), 'skills');
}

/** GET /api/skills/:name[?path=…] → {content}. */
export function readSkill(name: string, path?: string): Promise<Result<SkillContent>> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  return call(`/api/skills/${encodeURIComponent(name)}${qs}`, SkillContentResponseSchema);
}

/** GET /api/memory → {backend,summary?}. */
export function getMemory(): Promise<Result<MemoryState>> {
  return call('/api/memory', MemoryResponseSchema);
}

/** POST /api/memory/enqueue → {ok}. Forces pending-memory consolidation now (no text payload; the backend takes none). */
export function enqueueMemory(): Promise<Result<{ ok: boolean }>> {
  return call('/api/memory/enqueue', MemoryEnqueueResponseSchema, withJson('POST', {}));
}

export type SlashCommand = CommandInfoDto;

/** GET /api/commands?cwd= → {commands}. Built-ins plus discovered file commands. */
export function listCommands(cwd?: string): Promise<Result<SlashCommand[]>> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  return unwrapEnvelope(call(`/api/commands${qs}`, CommandsResponseSchema), 'commands');
}

export type SessionModel = ModelRefDto;

/** GET /api/sessions/:id/model → { models, current, thinking }. */
export function getSessionModels(sessionId: string): Promise<Result<SessionModelStateDto>> {
  return call(sessionPath(sessionId, '/model'), SessionModelStateSchema);
}

export function listConflicts(sessionId: string): Promise<Result<ConflictEntryDto[]>> {
  return unwrapEnvelope(
    call<{ conflicts: ConflictEntryDto[] }>(
      sessionPath(sessionId, '/conflicts'),
      ConflictsResponseSchema,
    ),
    'conflicts',
  );
}

export function resolveConflicts(
  sessionId: string,
  input: ResolveConflictsDto,
): Promise<Result<ResolveConflictsResponseDto>> {
  return call(
    sessionPath(sessionId, '/conflicts/resolve'),
    ResolveConflictsResponseSchema,
    withBody(input),
  );
}

/** GET /api/sessions/:id/stats → cumulative tokens/cost/context. */
export function getSessionStats(sessionId: string): Promise<Result<SessionStatsDto>> {
  return call(sessionPath(sessionId, '/stats'), SessionStatsSchema);
}

/** POST /api/sessions/:id/model { provider, modelId } → { current }. */
export function setSessionModel(
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<Result<ModelRefDto>> {
  return unwrapEnvelope(
    call(
      sessionPath(sessionId, '/model'),
      SetModelResponseSchema,
      withJson('POST', { provider, modelId }),
    ),
    'current',
  );
}

/** POST /api/sessions/:id/thinking { level } → { thinking }. */
export function setSessionThinking(sessionId: string, level: string): Promise<Result<string>> {
  return unwrapEnvelope(
    call(
      sessionPath(sessionId, '/thinking'),
      SetThinkingResponseSchema,
      withJson('POST', { level }),
    ),
    'thinking',
  );
}
