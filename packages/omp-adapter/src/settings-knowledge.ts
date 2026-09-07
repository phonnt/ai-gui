import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { getAgentDir } from '@oh-my-pi/pi-coding-agent';
import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import { loadSkills } from '@oh-my-pi/pi-coding-agent/extensibility/skills';
import { resolveMemoryBackend } from '@oh-my-pi/pi-coding-agent/memory-backend/resolve';

/**
 * P4 knowledge plane (SDK-direct, out-of-turn): skills + memory.
 *
 * Skills come from the real SDK loader (`loadSkills`, same discovery the
 * session uses); previews are plain file reads of the skill's `SKILL.md`.
 * Memory routes through `resolveMemoryBackend(settings)` — the single source
 * of truth every memory consumer uses — with `status` for the view and
 * `enqueue` for consolidation.
 */

export interface KnowledgeScope {
  cwd: string;
  agentDir?: string;
}

export interface SkillEntry {
  name: string;
  description?: string;
  source: string;
}

/** Preview cap: skills render as a preview, never a full dump. */
export const SKILL_PREVIEW_LIMIT = 32_000;

function scopeOf(options?: Partial<KnowledgeScope>): Required<KnowledgeScope> {
  return {
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? getAgentDir(),
  };
}

export async function skillsList(options?: Partial<KnowledgeScope>): Promise<SkillEntry[]> {
  const scope = scopeOf(options);
  const { skills } = await loadSkills({ cwd: scope.cwd });
  return skills
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      source: skill.source,
    }));
}

function assertWithinDir(dir: string, target: string): string {
  const resolved = path.resolve(dir, target);
  const root = path.resolve(dir) + path.sep;
  if (resolved !== path.resolve(dir) && !resolved.startsWith(root)) {
    throw new Error(`path escapes skill directory: ${target}`);
  }
  return resolved;
}

/**
 * Preview a skill's content: its `SKILL.md` by default, or `path` (jailed to
 * the skill dir) when given. Throws `unknown skill: <name>` for bad names.
 */
export async function skillRead(
  name: string,
  relPath?: string,
  options?: Partial<KnowledgeScope>,
): Promise<{ content: string }> {
  const scope = scopeOf(options);
  const { skills } = await loadSkills({ cwd: scope.cwd });
  const skill = skills.find((s) => s.name === name);
  if (!skill) throw new Error(`unknown skill: ${name}`);
  const file = relPath ? assertWithinDir(skill.baseDir, relPath) : skill.filePath;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new Error(`not a file: ${relPath ?? skill.filePath}`);
  const text = await readFile(file, 'utf-8');
  if (text.length <= SKILL_PREVIEW_LIMIT) return { content: text };
  return {
    content: `${text.slice(0, SKILL_PREVIEW_LIMIT)}\n\n…[truncated ${text.length - SKILL_PREVIEW_LIMIT} chars]`,
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
