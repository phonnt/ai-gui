import { readFile } from 'node:fs/promises';
import { InvalidRequestError, type PreludeResult } from '@grove/agent-runtime';
import type { EvalPreludeDefinition } from '@oh-my-pi/pi-coding-agent/eval/preludes';
import { createBrowserPrelude } from '@oh-my-pi/pi-coding-agent/tools/browser';
import { createComputerPrelude } from '@oh-my-pi/pi-coding-agent/tools/computer';
import { liveSettingsGetterFor } from '../tools-session.js';

import {
  ensureEntry,
  preludeCache,
  refreshToolSessionSettings,
  resultText,
  type SessionEntry,
  type ToolRawResult,
} from './core';
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

export function preludesFor(entry: SessionEntry): {
  browser?: EvalPreludeDefinition;
  computer?: EvalPreludeDefinition;
} {
  const existing = preludeCache.get(entry.id);
  if (existing) return existing;
  const fresh: { browser?: EvalPreludeDefinition; computer?: EvalPreludeDefinition } = {
    browser: createBrowserPrelude(entry.handle.session),
    computer: createComputerPrelude(entry.handle.session),
  };
  preludeCache.set(entry.id, fresh);
  return fresh;
}

export const PRELUDE_IMAGE_LIMIT = 4_000_000;

/** Data URLs for the image parts a prelude returned, plus screenshot files. */

export async function preludeImages(result: {
  content?: unknown;
  details?: unknown;
}): Promise<string[] | undefined> {
  const images: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const record = part as { type?: unknown; data?: unknown; mimeType?: unknown; source?: unknown };
    if (record.type !== 'image') continue;
    const data = typeof record.data === 'string' ? record.data : undefined;
    const mime = typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
    if (data) images.push(`data:${mime};base64,${data}`);
  }
  // Screenshots are written to disk; the run only returns their metadata, so
  // the bytes are read back here for the pane to render.
  const details = result.details as { screenshots?: unknown } | undefined;
  const shots = Array.isArray(details?.screenshots) ? details.screenshots : [];
  for (const shot of shots) {
    if (!shot || typeof shot !== 'object') continue;
    const record = shot as { dest?: unknown; mimeType?: unknown; bytes?: unknown };
    if (typeof record.dest !== 'string') continue;
    if (typeof record.bytes === 'number' && record.bytes > PRELUDE_IMAGE_LIMIT) continue;
    try {
      const bytes = await readFile(record.dest);
      const mime = typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
      images.push(`data:${mime};base64,${bytes.toString('base64')}`);
    } catch {
      /* screenshot file vanished: the metadata still reaches the client */
    }
  }
  return images.length > 0 ? images : undefined;
}

/** Shared plumbing for both prelude passthroughs. */

export async function runPreludeAction(
  sessionId: string,
  params: Record<string, unknown>,
  which: 'browser' | 'computer',
): Promise<PreludeResult> {
  const setting = which === 'browser' ? 'browser.enabled' : 'computer.enabled';
  // Gate first: `ensureEntry` builds the whole tool session (the preludes probe
  // the OS for displays and screen-recording permission), which took 25-33s
  // before answering "disabled". The live settings getter is registered at
  // attach, so a disabled prelude can fail without building anything.
  const liveSettings = liveSettingsGetterFor(sessionId)?.();
  if (liveSettings && liveSettings.get(setting) !== true) {
    throw new InvalidRequestError(
      `${which} is disabled. Enable ${setting} before using the ${which} pane.`,
    );
  }
  const entry = await ensureEntry(sessionId);
  refreshToolSessionSettings(entry, sessionId);
  // Read the live session's settings: the tool session's copy is a snapshot
  // taken at attach, so a toggle made afterwards would be ignored here.
  const settings = liveSettingsGetterFor(sessionId)?.() ?? entry.handle.session.settings;
  if (settings.get(setting) !== true) {
    throw new InvalidRequestError(
      `${which} is disabled. Enable ${setting} before using the ${which} pane.`,
    );
  }
  const prelude = preludesFor(entry)[which];
  if (!prelude) throw new InvalidRequestError(`${which} prelude is unavailable`);
  const result = (await prelude.invoke(params, {
    session: entry.handle.session,
    toolCallId: `web-prelude-${entry.seq++}`,
  })) as { content?: unknown; details?: unknown };
  const images = await preludeImages(result);
  return {
    text: resultText(result as ToolRawResult),
    details:
      result.details && typeof result.details === 'object'
        ? (result.details as Record<string, unknown>)
        : undefined,
    ...(images ? { images } : {}),
  };
}

export async function browserActionImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<PreludeResult> {
  return runPreludeAction(sessionId, params, 'browser');
}

export async function computerActionImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<PreludeResult> {
  return runPreludeAction(sessionId, params, 'computer');
}
