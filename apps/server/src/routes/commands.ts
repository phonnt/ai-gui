import { listCommands } from '@ai-gui/omp-adapter';
import { CommandsQuerySchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

/** GET /api/commands?cwd= → { commands }. File discovery is scoped to cwd. */
export async function listCommandsRoute(query: Record<string, string | undefined>): Promise<{
  commands: unknown;
}> {
  const parsed = CommandsQuerySchema.safeParse({
    ...(query.cwd !== undefined ? { cwd: query.cwd } : {}),
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return { commands: await listCommands(parsed.data.cwd) };
}
