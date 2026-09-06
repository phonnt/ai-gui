import type { SessionInfo } from '@ai-gui/core';
import {
  type AbortResponseDto,
  AbortResponseSchema,
  type CreateSessionDto,
  type CreateSessionResponseDto,
  CreateSessionResponseSchema,
  type DropResponseDto,
  DropResponseSchema,
  type DumpResponseDto,
  DumpResponseSchema,
  type ExportResponseDto,
  ExportResponseSchema,
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
  SessionListResponseSchema,
  type ShareResponseDto,
  ShareResponseSchema,
  type TreeResponseDto,
  TreeResponseSchema,
} from '@ai-gui/protocol';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface ResponseShape<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

async function parseBody<T>(res: Response, schema: ResponseShape<T>): Promise<Result<T>> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: body || `Request failed with status ${res.status}` };
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
