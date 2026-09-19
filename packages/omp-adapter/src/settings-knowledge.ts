import { getAgentDir } from '@oh-my-pi/pi-coding-agent';
import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import { resolveMemoryBackend } from '@oh-my-pi/pi-coding-agent/memory-backend/resolve';

/**
 * P4 knowledge plane (SDK-direct, out-of-turn): memory.
 *
 * Memory routes through `resolveMemoryBackend(settings)` — the single source of
 * truth every memory consumer uses — with `status` for the view and `enqueue`
 * for consolidation. Skills live on the session (`SessionSkills` contract):
 * only the session knows which inventory it actually loaded.
 */

export interface KnowledgeScope {
  cwd: string;
  agentDir?: string;
}

function scopeOf(options?: Partial<KnowledgeScope>): Required<KnowledgeScope> {
  return {
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? getAgentDir(),
  };
}

export async function memoryView(
  options?: Partial<KnowledgeScope>,
): Promise<{ backend: string; summary?: unknown }> {
  const scope = scopeOf(options);
  const settings = await Settings.loadIsolated({ cwd: scope.cwd, agentDir: scope.agentDir });
  const backend = await resolveMemoryBackend(settings);
  const status = await backend.status?.({ agentDir: scope.agentDir, cwd: scope.cwd });
  return { backend: backend.id, ...(status !== undefined ? { summary: status } : {}) };
}

/** Force consolidation/retain now (slash `/memory enqueue` equivalent). */
export async function memoryEnqueue(options?: Partial<KnowledgeScope>): Promise<{ ok: true }> {
  const scope = scopeOf(options);
  const settings = await Settings.loadIsolated({ cwd: scope.cwd, agentDir: scope.agentDir });
  const backend = await resolveMemoryBackend(settings);
  await backend.enqueue(scope.agentDir, scope.cwd);
  return { ok: true as const };
}
