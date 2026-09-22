import { readFile as readArtifactFile, readdir, stat } from 'node:fs/promises';
import {
  ArtifactNotFoundError,
  type ArtifactRef,
  OperationNotSupportedError,
  type TodoPhase,
  type TruncationInfo,
} from '@grove/agent-runtime';
import type { TodoPhase as SdkTodoPhase } from '@oh-my-pi/pi-coding-agent/tools';
import {
  artifactsDirForSessionFile,
  findArtifactFilename,
  parseArtifactFilename,
  sliceLinesByRange,
} from '../tool-helpers.js';

import { builtTools, ensureEntry, mapTodoPhases, runTool, type SessionEntry } from './core';
import { rangeStartOf } from './lsp';
/**
 * SDK-direct SessionTools: every method executes a real `BUILTIN_TOOLS`
 * factory outside any agent turn.
 *
 * Tool → factory mapping (all from `BUILTIN_TOOLS.<name>(toolSession)`):
 * - readFile/listDir → `read` (ReadTool). listDir resolves + type-checks the
 *   directory through the read tool, then structures entries via node:fs
 *   (the read tool renders listings as text, which carries no sizes).
 * - writeFile → `write` (WriteTool).
 * - editFile → `edit` (EditTool, hashline mode pinned by settings).
 * - runBash → `bash` (BashTool; `timeoutMs` converted to SDK seconds).
 * - runCell/resetKernel → `eval` (EvalTool; reset via `reset: true`).
 * - getTodos/applyTodoOp → `todo` (TodoTool over in-memory session phases).
 * - listArtifacts/readArtifact → no tool exists: resolved from the session
 *   journal's artifact directory with the SDK naming rule (`<id>.<tool>.log`,
 *   `<id>.` prefix match). Needs a registered session file.
 * - lsp* → `lsp` (LspTool; `timeoutMs` converted to SDK seconds). The tool
 *   renders formatted text, so diagnostics/definition/symbols/status are
 *   parsed back into structures (see `parse*` below); hover passes through.
 * - debug* → `debug` (DebugTool over the process-wide DAP singleton; the
 *   tool serializes requests, so no per-session locking here). Structured
 *   state (threads/frames/scopes/variables/sessions/snapshots) comes from
 *   result `details`; `remove_breakpoint` needs file+line or function, so
 *   breakpoint targets are tracked per web session (see `breakpointRegs`).
 *
 * Settings keys consumed (see `session-tool-settings.ts`): `bash.enabled`,
 * `todo.enabled`, `eval.js`, `eval.py`, `lsp.enabled`, `debug.enabled`,
 * `tools.xdev`, `edit.mode`.
 */

export async function getTodosImpl(sessionId: string): Promise<TodoPhase[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.todo, entry, { op: 'view' }, 'todo');
  return mapTodoPhases((details as { phases?: SdkTodoPhase[] } | undefined)?.phases);
}

export async function applyTodoOpImpl(
  sessionId: string,
  op: string,
  payload?: unknown,
): Promise<TodoPhase[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const extra = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const { details } = await runTool(tools.todo, entry, { op, ...extra }, 'todo');
  return mapTodoPhases((details as { phases?: SdkTodoPhase[] } | undefined)?.phases);
}

export function artifactsDirOrThrow(entry: SessionEntry): string {
  const file = entry.handle.getSessionFile();
  if (!file) {
    throw new OperationNotSupportedError('artifacts: session has no session file yet');
  }
  const dir = artifactsDirForSessionFile(file);
  if (!dir) {
    throw new OperationNotSupportedError('artifacts: session has no session file yet');
  }
  return dir;
}

export async function listArtifactsImpl(sessionId: string): Promise<ArtifactRef[]> {
  const entry = await ensureEntry(sessionId);
  const dir = artifactsDirOrThrow(entry);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ArtifactRef[] = [];
  for (const name of names) {
    const parsed = parseArtifactFilename(name);
    if (!parsed) continue;
    const abs = `${dir}/${name}`;
    try {
      const child = await stat(abs);
      if (child.isDirectory()) continue;
      out.push({ id: parsed.id, kind: parsed.kind, size: child.size, path: abs });
    } catch {
      /* vanished mid-listing */
    }
  }
  out.sort((a, b) => Number(a.id) - Number(b.id));
  return out;
}

export async function readArtifactImpl(
  sessionId: string,
  id: string,
  range?: string,
): Promise<{ content: string; truncated: boolean; truncation?: TruncationInfo }> {
  const entry = await ensureEntry(sessionId);
  const dir = artifactsDirOrThrow(entry);
  let names: string[] | null = null;
  try {
    names = await readdir(dir);
  } catch {
    names = null;
  }
  const match = names ? findArtifactFilename(names, id) : null;
  if (!match) throw new ArtifactNotFoundError(id);
  let text: string;
  try {
    text = await readArtifactFile(`${dir}/${match}`, 'utf8');
  } catch {
    throw new ArtifactNotFoundError(id);
  }
  const slice = sliceLinesByRange(text, range);
  if (!slice.truncated) return slice;
  // Paging hint for range reads: the next window after the one just served.
  const totalLines = text.split('\n').length;
  const shownStart = rangeStartOf(range) ?? 1;
  return {
    ...slice,
    truncation: {
      direction: 'head',
      truncatedBy: 'lines',
      totalLines,
      totalBytes: text.length,
      shownRange: { start: shownStart, end: shownStart + slice.content.split('\n').length - 1 },
      nextOffset: shownStart + slice.content.split('\n').length,
    },
  };
}

/** First line of a `N`/`N-M`/`-N` range string (1-indexed), when parseable. */
