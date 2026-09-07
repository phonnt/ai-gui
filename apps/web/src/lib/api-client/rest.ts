import type { SessionInfo } from '@ai-gui/core';
import {
  type AbortResponseDto,
  AbortResponseSchema,
  type ArtifactContentDto,
  ArtifactContentSchema,
  type ArtifactRefDto,
  ArtifactsResponseSchema,
  type BashResultDto,
  BashResultSchema,
  type CellLanguageDto,
  type CellResultDto,
  CellResultSchema,
  type CreateSessionDto,
  type CreateSessionResponseDto,
  CreateSessionResponseSchema,
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
  type HealthDto,
  HealthSchema,
  type MessagesQueryDto,
  type MessagesResponseDto,
  MessagesResponseSchema,
  type OkDto,
  OkSchema,
  type PromptDto,
  type PromptResponseDto,
  PromptResponseSchema,
  type ResetKernelResponseDto,
  ResetKernelResponseSchema,
  SessionListResponseSchema,
  type ShareResponseDto,
  ShareResponseSchema,
  type TodoPhaseDto,
  TodosResponseSchema,
  type TodoTaskDto,
  type TreeResponseDto,
  TreeResponseSchema,
  type WriteFileResponseDto,
  WriteFileResponseSchema,
} from '@ai-gui/protocol';

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

export function branchSession(input: BranchInput): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(input.sessionId, '/branch'),
    CreateSessionResponseSchema,
    withJson('POST', input.parentId === undefined ? {} : { parentId: input.parentId }),
  ).then(unwrapSession);
}

export function exportHtml(sessionId: string): Promise<Result<ExportResponseDto>> {
  return call(sessionPath(sessionId, '/export'), ExportResponseSchema);
}

export function dumpSession(sessionId: string): Promise<Result<DumpResponseDto>> {
  return call(sessionPath(sessionId, '/dump'), DumpResponseSchema);
}

export function shareSession(sessionId: string): Promise<Result<ShareResponseDto>> {
  return call(sessionPath(sessionId, '/share'), ShareResponseSchema, withJson('POST', {}));
}

export function renameSession(input: RenameInput): Promise<Result<SessionInfo>> {
  return call(
    sessionPath(input.sessionId),
    CreateSessionResponseSchema,
    withJson('PATCH', { title: input.title }),
  ).then(unwrapSession);
}
// ---------------------------------------------------------------------------
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

export function runBash(
  sessionId: string,
  command: string,
  cwd?: string,
  timeoutMs?: number,
): Promise<Result<P2aBashResult>> {
  return call<P2aBashResult>(
    toolsPath(sessionId, '/bash'),
    BashResultSchema,
    withJson('POST', { command, cwd, timeoutMs }),
  );
}

export function runCell(
  sessionId: string,
  language: P2aCellLanguage,
  code: string,
  title?: string,
): Promise<Result<P2aCellResult>> {
  return call<P2aCellResult>(
    toolsPath(sessionId, '/cells'),
    CellResultSchema,
    withJson('POST', { language, code, title }),
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
