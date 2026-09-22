import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { type DirEntry, type FileContent, ToolExecutionError } from '@grove/agent-runtime';
import { getEditStore } from '@oh-my-pi/pi-coding-agent/edit';
import { hasHashlineSection, splitHashlineHeader } from '../tool-helpers.js';

import { builtTools, ensureEntry, entrySession, type ReadDetails, runTool } from './core';
import { toTruncationInfo } from './shell';
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

export async function readFileImpl(
  sessionId: string,
  path: string,
  range?: string,
): Promise<FileContent> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text, details } = await runTool(
    tools.read,
    entry,
    { path: range ? `${path}:${range}` : path },
    'read',
  );
  const info = (details ?? {}) as ReadDetails;
  if (info.isDirectory === true) {
    throw new ToolExecutionError('read', `path is a directory: ${path}`);
  }
  const displayText = info.displayContent;
  const { body, tag: headerTag } = splitHashlineHeader(text);
  const bodyText = typeof displayText?.text === 'string' ? displayText.text : body;
  let tag = headerTag;
  if (typeof info.resolvedPath === 'string' && info.resolvedPath) {
    tag = getEditStore(entrySession(entry)).headHash(info.resolvedPath) ?? tag;
  }
  const truncation = toTruncationInfo(info.truncation);
  return {
    path,
    ...(tag ? { tag } : {}),
    text: bodyText,
    truncated: truncation !== undefined || info.truncation?.truncated === true,
    ...(truncation ? { truncation } : {}),
  };
}

export async function listDirImpl(sessionId: string, path?: string): Promise<DirEntry[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const target = path ?? session.cwd;
  const { details } = await runTool(tools.read, entry, { path: target }, 'read');
  const info = (details ?? {}) as ReadDetails;
  if (typeof info.resolvedPath !== 'string' || !info.resolvedPath) {
    throw new ToolExecutionError('read', `cannot resolve directory: ${target}`);
  }
  let dirStat: Stats;
  try {
    dirStat = await stat(info.resolvedPath);
  } catch {
    throw new ToolExecutionError('read', `cannot stat directory: ${target}`);
  }
  if (!dirStat.isDirectory()) {
    throw new ToolExecutionError('read', `not a directory: ${target}`);
  }
  let names: string[];
  try {
    names = await readdir(info.resolvedPath);
  } catch (err) {
    throw new ToolExecutionError('read', err instanceof Error ? err.message : String(err));
  }
  const out: DirEntry[] = [];
  for (const name of names) {
    const abs = `${info.resolvedPath}/${name}`;
    let kind: 'file' | 'dir' = 'file';
    let size: number | undefined;
    try {
      const child = await stat(abs);
      kind = child.isDirectory() ? 'dir' : 'file';
      if (!child.isDirectory()) size = child.size;
    } catch {
      /* vanished mid-listing: keep the name without size */
    }
    const rel = relative(session.cwd, abs);
    out.push({
      name,
      path: rel.startsWith('..') || rel === '' ? abs : rel,
      kind,
      ...(size !== undefined ? { size } : {}),
    });
  }
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

/**
 * Live output tails for background jobs the web started, keyed by job id.
 *
 * The SDK's job manager keeps only the latest *details* per job, so a running
 * job's text is unreachable through it; capturing the tool's progress updates
 * here is what makes a live tail possible for detached commands we launch.
 * In-turn background jobs (started by the agent) surface their output once
 * they settle, via the job's result text.
 */

export async function globFilesImpl(
  sessionId: string,
  pattern: string,
  limit = 100,
): Promise<{ paths: string[]; truncated: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const capped = Math.max(1, Math.min(500, limit));
  const { details } = await runTool(tools.glob, entry, { path: pattern, limit: capped }, 'glob');
  const info = (details ?? {}) as { files?: unknown; truncated?: unknown };
  const files = Array.isArray(info.files)
    ? info.files.filter((f): f is string => typeof f === 'string')
    : [];
  const paths = files.map((file) => {
    const rel = relative(session.cwd, resolve(session.cwd, file));
    return rel.startsWith('..') ? file : rel;
  });
  return { paths, truncated: info.truncated === true || files.length > capped };
}

export async function writeFileImpl(
  sessionId: string,
  path: string,
  content: string,
): Promise<{ bytes: number; tag: string }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { details } = await runTool(tools.write, entry, { path, content }, 'write');
  const resolved =
    details && typeof details.resolvedPath === 'string' && details.resolvedPath
      ? (details.resolvedPath as string)
      : resolve(entrySession(entry).cwd, path);
  const store = getEditStore(entrySession(entry));
  const tag = store.headHash(resolved) ?? store.recordSnapshot(resolved, content);
  return { bytes: new TextEncoder().encode(content).length, tag };
}

export async function editFileImpl(
  sessionId: string,
  path: string,
  tag: string,
  input: string,
): Promise<{ tag: string; applied: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const body = hasHashlineSection(input) ? input : `[${path}#${tag}]\n${input}`;
  await runTool(tools.edit, entry, { input: body }, 'edit');
  const abs = resolve(entrySession(entry).cwd, path);
  let next = getEditStore(entrySession(entry)).headHash(abs) ?? undefined;
  if (!next) {
    // Rename/move edits resolve elsewhere: re-read to mint the fresh tag.
    next = (await readFileImpl(sessionId, path)).tag ?? tag;
  }
  return { tag: next, applied: true };
}

/**
 * Content search via the SDK `grep` tool outside any turn. Paths are returned
 * cwd-relative; `text` is the tool's own pre-formatted rendering, so the UI
 * never re-implements the hashline/gutter format.
 */

export async function grepFilesImpl(
  sessionId: string,
  pattern: string,
  path?: string,
  caseSensitive?: boolean,
  skip?: number,
): Promise<{
  files: { path: string; count: number }[];
  text: string;
  matchCount: number;
  truncated: boolean;
}> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const session = entrySession(entry);
  const { text, details } = await runTool(
    tools.grep,
    entry,
    {
      pattern,
      ...(path !== undefined ? { path } : {}),
      ...(caseSensitive ? { case: true } : {}),
      ...(skip !== undefined ? { skip } : {}),
    },
    'grep',
    { throwOnError: false },
  );
  const info = (details ?? {}) as {
    files?: unknown;
    fileMatches?: unknown;
    matchCount?: unknown;
    truncated?: unknown;
    displayContent?: unknown;
  };
  const toRel = (value: string): string => {
    const rel = relative(session.cwd, resolve(session.cwd, value));
    return rel.startsWith('..') ? value : rel;
  };
  const fromFileMatches = Array.isArray(info.fileMatches)
    ? info.fileMatches
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const rec = item as { path?: unknown; count?: unknown };
          if (typeof rec.path !== 'string') return null;
          return { path: toRel(rec.path), count: typeof rec.count === 'number' ? rec.count : 0 };
        })
        .filter((item): item is { path: string; count: number } => item !== null)
    : [];
  const fromFiles = Array.isArray(info.files)
    ? info.files
        .filter((item): item is string => typeof item === 'string')
        .map((file) => ({ path: toRel(file), count: 0 }))
    : [];
  return {
    files: fromFileMatches.length > 0 ? fromFileMatches : fromFiles,
    text: typeof info.displayContent === 'string' ? info.displayContent : text,
    matchCount: typeof info.matchCount === 'number' ? info.matchCount : 0,
    truncated: info.truncated === true,
  };
}

/**
 * Eval-prelude host calls (`browser`, `computer`).
 *
 * Both preludes are the SDK's own bridge: they own tab supervision, CDP, the
 * desktop controller and screenshot storage. The web calls the same `invoke`
 * the eval snippet would, so nothing about the automation is re-implemented
 * here — only the transport.
 */

/**
 * Re-seed the tool session's settings from the live session.
 *
 * The tool session holds an isolated settings instance seeded at attach time,
 * but the SDK reads user-facing keys at call time (browser mode/headless,
 * prelude gates, timeouts). Without a refresh those reads see attach-time
 * values, so a setting toggled in the UI never reaches the tool.
 */
