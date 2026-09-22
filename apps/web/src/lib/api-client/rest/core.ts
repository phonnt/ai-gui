import type {
  DebugActionDto,
  HubAgentDto,
  HubTranscriptEntryDto,
  LspActionDto,
  ModelRefDto,
  ProviderAuthDto,
  ThemeInfoDto,
  TodoTaskDto,
  TruncationInfoDto,
} from '@grove/protocol';

export type { PromptImage } from '@grove/protocol';

/** Truncation facts attached to bounded tool output (ranges + full artifact). */

export type P2aTruncation = TruncationInfoDto;

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ResponseShape<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown };
}

export async function parseBody<T>(res: Response, schema: ResponseShape<T>): Promise<Result<T>> {
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

export async function call<T>(
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

export function withBody<T>(body: T): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function withJson(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method, headers: { 'Content-Type': 'application/json' } }
    : { method, body: JSON.stringify(body) };
}

export function sessionPath(sessionId: string, suffix = ''): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

export type P2aTodoTask = TodoTaskDto;

export async function unwrapEnvelope<T, K extends string>(
  promise: Promise<Result<Record<K, T>>>,
  key: K,
): Promise<Result<T>> {
  const res = await promise;
  if (!res.ok) return res;
  return { ok: true, data: res.data[key] };
}

export type LspAction = LspActionDto;

export type DebugAction = DebugActionDto;

export type HubAgentStatus = HubAgentDto['status'];

export type HubTranscriptEntry = HubTranscriptEntryDto;

export type ThemeInfo = ThemeInfoDto;

export type ProviderAuth = ProviderAuthDto;

export type SessionModel = ModelRefDto;

/** GET /api/sessions/:id/model → { models, current, thinking }. */
