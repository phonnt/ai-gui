import type { SessionTools } from '@ai-gui/agent-runtime';
import { ArtifactQuerySchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/artifacts → { artifacts }. */
export async function listArtifactsRoute(
  tools: SessionTools,
  sessionId: string,
): Promise<{ artifacts: unknown }> {
  return { artifacts: await tools.listArtifacts({ sessionId }) };
}

/** GET /api/sessions/:id/artifacts/:aid?range → { content, truncated }. */
export async function readArtifactRoute(
  tools: SessionTools,
  sessionId: string,
  artifactId: string,
  query: Record<string, string | undefined>,
): Promise<{ content: string; truncated: boolean }> {
  const parsed = ArtifactQuerySchema.safeParse(
    query.range !== undefined ? { range: query.range } : {},
  );
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  if (!artifactId) throw new HttpError(400, 'artifact id is required');
  return tools.readArtifact({
    sessionId,
    id: artifactId,
    ...(parsed.data.range ? { range: parsed.data.range } : {}),
  });
}
