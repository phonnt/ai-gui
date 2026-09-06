import type { SessionInfo } from '@ai-gui/core';
import {
  type AbortResponseDto,
  AbortResponseSchema,
  type CreateSessionDto,
  CreateSessionResponseSchema,
  type HealthDto,
  HealthSchema,
  type MessagesQueryDto,
  type MessagesResponseDto,
  MessagesResponseSchema,
  type PromptDto,
  type PromptResponseDto,
  PromptResponseSchema,
  SessionListResponseSchema,
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
