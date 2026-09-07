import type { SessionTools } from '@ai-gui/agent-runtime';
import { EditFileSchema, FilesQuerySchema, WriteFileSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/** GET /api/sessions/:id/files?path&range → { file }. */
export async function readFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
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
    path: resolveSessionPath(cwd, parsed.data.path),
    ...(parsed.data.range ? { range: parsed.data.range } : {}),
  });
  return { file };
}

/** GET /api/sessions/:id/files/list?path → { entries }. */
export async function listDirRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  query: Record<string, string | undefined>,
): Promise<{ entries: unknown }> {
  const parsed = FilesQuerySchema.safeParse(query.path !== undefined ? { path: query.path } : {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const entries = await tools.listDir({
    sessionId,
    ...(parsed.data.path ? { path: resolveSessionPath(cwd, parsed.data.path) } : {}),
  });
  return { entries };
}

/** POST /api/sessions/:id/files { path, content } → { bytes, tag }. */
export async function writeFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  body: unknown,
): Promise<{ bytes: number; tag: string }> {
  const parsed = WriteFileSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.writeFile({
    sessionId,
    path: resolveSessionPath(cwd, parsed.data.path),
    content: parsed.data.content,
  });
}

/** POST /api/sessions/:id/edit { path, tag, input } → { tag, applied }. */
export async function editFileRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  body: unknown,
): Promise<{ tag: string; applied: boolean }> {
  const parsed = EditFileSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return tools.editFile({
    sessionId,
    path: resolveSessionPath(cwd, parsed.data.path),
    tag: parsed.data.tag,
    input: parsed.data.input,
  });
}
