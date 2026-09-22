import type { AgentRuntime } from '@grove/agent-runtime';
import { SshHostInputSchema, SshHostTargetSchema, SshScopeSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** GET /api/sessions/:id/ssh?scope=user|project → { hosts }. */
export async function listSshHostsRoute(
  runtime: AgentRuntime,
  cwd: string,
  scope: unknown,
): Promise<{ hosts: string[] }> {
  const parsed = SshScopeSchema.safeParse(scope);
  if (!parsed.success) throw new HttpError(400, 'scope must be user or project');
  return { hosts: await runtime.listSshHosts(cwd, parsed.data) };
}

/** POST /api/sessions/:id/ssh { scope, name, host, user?, port? } → { hosts }. */
export async function addSshHostRoute(
  runtime: AgentRuntime,
  cwd: string,
  body: unknown,
): Promise<{ hosts: string[] }> {
  const parsed = SshHostInputSchema.safeParse(body);
  if (!parsed.success) {
    // The raw zod dump is unreadable in a toast; name the field that failed.
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') ?? 'body';
    throw new HttpError(400, `invalid ssh host: ${field} ${issue?.message ?? 'is invalid'}`);
  }
  await runtime.addSshHost({ ...parsed.data, cwd });
  return { hosts: await runtime.listSshHosts(cwd, parsed.data.scope) };
}

/** DELETE /api/sessions/:id/ssh?scope=user|project&name=<host> → { hosts }. */
export async function removeSshHostRoute(
  runtime: AgentRuntime,
  cwd: string,
  query: Record<string, string | undefined>,
): Promise<{ hosts: string[] }> {
  const parsed = SshHostTargetSchema.safeParse({ scope: query.scope, name: query.name });
  if (!parsed.success) throw new HttpError(400, 'scope and name are required');
  await runtime.removeSshHost({ ...parsed.data, cwd });
  return { hosts: await runtime.listSshHosts(cwd, parsed.data.scope) };
}
