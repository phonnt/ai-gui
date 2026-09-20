import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { SessionTools } from '@grove/agent-runtime';
import {
  BrowseQuerySchema,
  EditFileSchema,
  FilesQuerySchema,
  GlobQuerySchema,
  GrepQuerySchema,
  WriteFileSchema,
} from '@grove/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/**
 * GET /api/fs/browse?path → { browse: { path, parent, entries } }.
 * Workspace picker: list directories anywhere on the server filesystem.
 * Deliberately unjailed — same privilege the client already has via
 * createSession({ cwd }) and session bash. Returns directories only.
 */
export async function browseRoute(query: Record<string, string | undefined>): Promise<{
  browse: unknown;
}> {
  const parsed = BrowseQuerySchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  let raw = parsed.data.path?.trim() || homedir();
  if (raw === '~' || raw.startsWith('~/')) raw = join(homedir(), raw.slice(1));
  const path = resolve(raw);
  const dirents = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!dirents) throw new HttpError(404, `cannot list directory: ${path}`);
  const entries = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .slice(0, 1000)
    .map((d) => ({ name: d.name, path: join(path, d.name), kind: 'dir' as const }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { browse: { path, parent: dirname(path) === path ? null : dirname(path), entries } };
}

/** GET /api/sessions/:id/files?path&range → { file }. */
export async function readFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  query: Record<string, string | undefined>,
): Promise<{ file: unknown }> {
  const parsed = FilesQuerySchema.safeParse({
    ...(query.path !== undefined ? { path: query.path } : {}),
    ...(query.range !== undefined ? { range: query.range } : {}),
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  if (!parsed.data.path) throw new HttpError(400, 'path is required');
  const file = await tools.readFile({
    sessionId,
    path: resolveSessionPath(cwd, parsed.data.path, roots),
    ...(parsed.data.range ? { range: parsed.data.range } : {}),
  });
  return { file };
}

/**
 * GET /api/sessions/:id/glob?pattern&limit → { paths, truncated }.
 * Workspace search for the composer's file mentions and the explorer.
 */
export async function globRoute(
  tools: SessionTools,
  sessionId: string,
  query: Record<string, string | undefined>,
): Promise<{ paths: string[]; truncated: boolean }> {
  const parsed = GlobQuerySchema.safeParse(
    query.pattern !== undefined
      ? { pattern: query.pattern, ...(query.limit !== undefined ? { limit: query.limit } : {}) }
      : {},
  );
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.globFiles({
    sessionId,
    pattern: parsed.data.pattern,
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
  });
}

/**
 * GET /api/sessions/:id/grep?pattern&path&case&skip → { files, text, … }.
 * Content search for the explorer; the text is the SDK's own rendering.
 */
export async function grepRoute(
  tools: SessionTools,
  sessionId: string,
  query: Record<string, string | undefined>,
): Promise<{
  files: { path: string; count: number }[];
  text: string;
  matchCount: number;
  truncated: boolean;
}> {
  const parsed = GrepQuerySchema.safeParse(
    Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)),
  );
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.grepFiles({
    sessionId,
    pattern: parsed.data.pattern,
    ...(parsed.data.path !== undefined ? { path: parsed.data.path } : {}),
    ...(parsed.data.case === '1' ? { caseSensitive: true } : {}),
    ...(parsed.data.skip !== undefined ? { skip: parsed.data.skip } : {}),
  });
}

/** GET /api/sessions/:id/files/list?path → { entries }. */
export async function listDirRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  query: Record<string, string | undefined>,
): Promise<{ entries: unknown }> {
  const parsed = FilesQuerySchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const entries = await tools.listDir({
    sessionId,
    ...(parsed.data.path ? { path: resolveSessionPath(cwd, parsed.data.path, roots) } : {}),
  });
  return { entries };
}

/** POST /api/sessions/:id/files { path, content } → { bytes, tag }. */
export async function writeFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  body: unknown,
): Promise<{ bytes: number; tag: string }> {
  const parsed = WriteFileSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.writeFile({
    sessionId,
    path: resolveSessionPath(cwd, parsed.data.path, roots),
    content: parsed.data.content,
  });
}

/** POST /api/sessions/:id/edit { path, tag, input } → { tag, applied }. */
export async function editFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  body: unknown,
): Promise<{ tag: string; applied: boolean }> {
  const parsed = EditFileSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.editFile({
    sessionId,
    path: resolveSessionPath(cwd, parsed.data.path, roots),
    tag: parsed.data.tag,
    input: parsed.data.input,
  });
}
