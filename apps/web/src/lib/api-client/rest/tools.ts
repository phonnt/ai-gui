import {
  type ArtifactContentDto,
  ArtifactContentSchema,
  type ArtifactRefDto,
  ArtifactsResponseSchema,
  type BashResultDto,
  BashResultSchema,
  type BrowseResponseDto,
  BrowseResponseSchema,
  type CellLanguageDto,
  type CellResultDto,
  CellResultSchema,
  type DebugRequestDto,
  DebugResponseSchema,
  type DirEntryDto,
  DirListResponseSchema,
  type EditFileResponseDto,
  EditFileResponseSchema,
  type FileContentDto,
  FileResponseSchema,
  type GlobResponseDto,
  GlobResponseSchema,
  type GrepResponseDto,
  GrepResponseSchema,
  type JobCancelResponseDto,
  JobCancelResponseSchema,
  type JobsResponseDto,
  JobsResponseSchema,
  type LspRequestDto,
  LspResponseSchema,
  type PreludeResultDto,
  PreludeResultSchema,
  type ProcessResultDto,
  ProcessResultSchema,
  type ResetKernelResponseDto,
  ResetKernelResponseSchema,
  type SecurityScanResponseDto,
  SecurityScanResponseSchema,
  type SessionToolInfoDto,
  SessionToolsResponseSchema,
  type TodoPhaseDto,
  TodosResponseSchema,
  type WriteFileResponseDto,
  WriteFileResponseSchema,
} from '@grove/protocol';

import { call, type Result, sessionPath, unwrapEnvelope, withJson } from './core';

export type P2aFileContent = FileContentDto;

export type P2aDirEntry = DirEntryDto;

export type P2aBashResult = BashResultDto;

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

export function toolsPath(sessionId: string, suffix: string): string {
  return sessionPath(sessionId, suffix);
}

export function filesQuery(path?: string, range?: string): string {
  const params = new URLSearchParams();
  if (path !== undefined) params.set('path', path);
  if (range !== undefined && range !== '') params.set('range', range);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
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

/** GET /api/sessions/:id/jobs → { jobs } (running + recently settled). */

export function listJobs(sessionId: string): Promise<Result<JobsResponseDto>> {
  return call(`${toolsPath(sessionId, '/jobs')}`, JobsResponseSchema);
}

/** POST /api/sessions/:id/jobs/:id/cancel → { cancelled }. */

export function cancelJob(sessionId: string, id: string): Promise<Result<JobCancelResponseDto>> {
  return call(
    toolsPath(sessionId, `/jobs/${encodeURIComponent(id)}/cancel`),
    JobCancelResponseSchema,
    withJson('POST', {}),
  );
}

/** GET /api/sessions/:id/grep?pattern&path&case&skip → { files, text, … }. */

export function grepFiles(
  sessionId: string,
  pattern: string,
  options?: { path?: string; caseSensitive?: boolean; skip?: number },
): Promise<Result<GrepResponseDto>> {
  const qs = new URLSearchParams({ pattern });
  if (options?.path) qs.set('path', options.path);
  if (options?.caseSensitive) qs.set('case', '1');
  if (options?.skip !== undefined) qs.set('skip', String(options.skip));
  return call(`${toolsPath(sessionId, '/grep')}?${qs.toString()}`, GrepResponseSchema);
}

/** GET /api/sessions/:id/glob?pattern&limit → { paths, truncated }. */

export function globFiles(
  sessionId: string,
  pattern: string,
  limit?: number,
): Promise<Result<GlobResponseDto>> {
  const qs = new URLSearchParams({ pattern });
  if (limit !== undefined) qs.set('limit', String(limit));
  return call(`${toolsPath(sessionId, '/glob')}?${qs.toString()}`, GlobResponseSchema);
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

export type LspInput = LspRequestDto;

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

export async function unwrapResult(
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
// P3 Agent Hub (SDK-direct wave 1). NOTE: @grove/protocol currently defines
// no hub schemas/routes, so shapes here mirror the wave-1 contract:
// GET /api/hub/agents → {agents}; POST /api/hub/agents/:id/steer {text} → {ok};
// POST /:id/revive → {revived, revivable}; POST /:id/kill → {killed};
// GET /api/hub/jobs → {jobs}; POST /api/hub/jobs/cancel {ids?} → {cancelled};
// POST /api/hub/spawn {agent?, task, context?, outputSchema?} → {agentId}.
// If protocol gains hub schemas, prefer importing them and delete the local
// mirrors below.
// ---------------------------------------------------------------------------

export function browserAction(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Result<PreludeResultDto>> {
  return call(sessionPath(sessionId, '/browser'), PreludeResultSchema, withJson('POST', params));
}

/** POST /api/sessions/:id/computer { action, … } → prelude result (TUI `/computer`). */

export function computerAction(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Result<PreludeResultDto>> {
  return call(sessionPath(sessionId, '/computer'), PreludeResultSchema, withJson('POST', params));
}

/** POST /api/sessions/:id/process { op, … } → supervised-process result. */

export function processAction(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Result<ProcessResultDto>> {
  return call(sessionPath(sessionId, '/process'), ProcessResultSchema, withJson('POST', params));
}

/** POST /api/sessions/:id/security { action, … } → { text, details }. */

export function securityScan(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<Result<SecurityScanResponseDto>> {
  return call(
    sessionPath(sessionId, '/security'),
    SecurityScanResponseSchema,
    withJson('POST', params),
  );
}

/** GET /api/sessions/:id/tools → registered tools with their active flag. */

export function getSessionTools(sessionId: string): Promise<Result<SessionToolInfoDto[]>> {
  return unwrapEnvelope(
    call<{ tools: SessionToolInfoDto[] }>(
      sessionPath(sessionId, '/tools'),
      SessionToolsResponseSchema,
    ),
    'tools',
  );
}

/** GET /api/foreign-sessions?source → { sessions } (TUI `/resume @claude|@codex`). */
