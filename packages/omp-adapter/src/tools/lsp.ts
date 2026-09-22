import {
  InvalidRequestError,
  type LspDiagnostic,
  type LspLocation,
  type LspStatus,
  type LspSymbol,
  ToolExecutionError,
} from '@grove/agent-runtime';
import { toInvalidRequestError } from '../client-errors.js';

import { builtTools, ensureEntry, runTool } from './core';
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

export function rangeStartOf(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const single = /^(\d+)$/.exec(range.trim());
  if (single) return Number(single[1]);
  const window = /^(\d*)-/.exec(range.trim());
  if (!window) return undefined;
  return window[1] ? Number(window[1]) : undefined;
}

// ---------------------------------------------------------------------------
// LSP (via BUILTIN_TOOLS.lsp execute; formatted text parsed back to structs).
// ---------------------------------------------------------------------------

/** Throw when the lsp tool reports a hard failure instead of a result. */

export function throwIfLspError(text: string): void {
  const line = text.trimStart().split('\n', 1)[0] ?? '';
  if (/^(error:|lsp error:|no language server found)/i.test(line)) {
    // A missing language server is a caller condition (per-session/cwd config),
    // not a Grove fault; classify before falling back to a tool failure.
    throw toInvalidRequestError(text) ?? new ToolExecutionError('lsp', text);
  }
}

export const DIAG_LINE_RE = /^(\d+):(\d+)\s*\[(error|warning|info|hint)\]\s*(.*)$/i;

export const HEADER_RE = /^(#{1,}) (.+?)\/?$/;

/** Regex group or '' (noUncheckedIndexedAccess-safe). */

export function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

/** Parse single/multi-file diagnostics text into LspDiagnostic[]. */

export function parseDiagnostics(text: string): LspDiagnostic[] {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === 'OK' || /^no files matched pattern:/i.test(trimmed)) return [];
  const out: LspDiagnostic[] = [];
  // Ungrouped fallback: `path:line:col [sev] message`.
  const ungrouped = /^(.+?):(\d+):(\d+)\s*\[(error|warning|info|hint)\]\s*(.*)$/i;
  // Grouped (`# dir/` / `## file` prefix-folded tree, `  line:col [sev] msg`
  // model lines): track the header stack to rebuild the file path.
  const stack: { depth: number; name: string }[] = [];
  let currentFile: string | null = null;
  const pushFile = (): void => {
    if (stack.length === 0) {
      currentFile = null;
      return;
    }
    currentFile = `${stack.map((part) => part.name).join('/')}`;
  };
  for (const raw of trimmed.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') continue;
    const header = HEADER_RE.exec(line);
    if (header) {
      const depth = group(header, 1).length;
      const name = group(header, 2);
      let top = stack[stack.length - 1];
      while (top && top.depth >= depth) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      stack.push({ depth, name });
      pushFile();
      continue;
    }
    const grouped = DIAG_LINE_RE.exec(line.trim());
    if (grouped && currentFile) {
      out.push({
        file: currentFile,
        line: Number(group(grouped, 1)),
        column: Number(group(grouped, 2)),
        severity: group(grouped, 3).toLowerCase(),
        message: group(grouped, 4),
      });
      continue;
    }
    const flat = ungrouped.exec(line.trim());
    if (flat) {
      out.push({
        file: group(flat, 1),
        line: Number(group(flat, 2)),
        column: Number(group(flat, 3)),
        severity: group(flat, 4).toLowerCase(),
        message: group(flat, 5),
      });
    }
  }
  return out;
}

export const DEFINITION_LINE_RE = /^ {2}(.+):(\d+):(\d+)\s*$/;

export const SYMBOL_LINE_RE = /^(?:\S+\s+)?(.+?)\s+@\s+(?:line\s+(\d+)|(.+?):(\d+)(?::(\d+))?)\s*$/;

/** Parse `Found N definition(s):\n  file:line:col` (+ context) output. */

export function parseLocations(text: string): LspLocation[] {
  const trimmed = text.trim();
  if (/^no .* found/i.test(trimmed)) return [];
  const out: LspLocation[] = [];
  for (const raw of trimmed.split('\n')) {
    const match = DEFINITION_LINE_RE.exec(raw);
    if (match) {
      out.push({
        file: group(match, 1),
        line: Number(group(match, 2)),
        column: Number(group(match, 3)),
      });
    }
  }
  return out;
}
/**
 * Parse symbol lines (`<icon> name [detail] @ line N` document symbols,
 * `<icon> name [(container)] @ file:line:col` workspace symbols).
 */

export function parseSymbols(text: string): LspSymbol[] {
  const trimmed = text.trim();
  if (/^no symbols/i.test(trimmed)) return [];
  const out: LspSymbol[] = [];
  for (const raw of trimmed.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') continue;
    if (/symbol\(s\)|symbols in/i.test(line)) continue;
    const match = SYMBOL_LINE_RE.exec(line);
    if (!match) continue;
    const name =
      group(match, 1)
        .replace(/\s*\(.*\)\s*$/, '')
        .trim() || group(match, 1).trim();
    if (match[2] !== undefined) {
      out.push({ name, kind: '', line: Number(match[2]) });
    } else if (match[3] !== undefined) {
      out.push({
        name: `${name} (${group(match, 3)}:${group(match, 4)})`,
        kind: '',
        line: Number(group(match, 4)),
      });
    }
  }
  return out;
}

/** Parse `Language servers: name (status), …` status text. */

export function parseLspStatus(text: string): LspStatus {
  const trimmed = text.trim();
  if (/^no language servers configured/i.test(trimmed)) return { servers: [], ok: false };
  const first = trimmed.split('\n', 1)[0] ?? '';
  const list = first.replace(/^language servers:\s*/i, '');
  const servers: { name: string; status: string }[] = [];
  for (const part of list.split(/,\s*/)) {
    const match = /^(.+?)\s*\((.+)\)\s*$/.exec(part.trim());
    if (match) servers.push({ name: group(match, 1), status: group(match, 2) });
  }
  return { servers, ok: servers.some((server) => /ready/i.test(server.status)) };
}

export function lspTimeout(timeoutMs?: number): Record<string, unknown> {
  return timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {};
}

export async function lspDiagnosticsImpl(
  sessionId: string,
  file: string,
  timeoutMs?: number,
): Promise<LspDiagnostic[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(
    tools.lsp,
    entry,
    { action: 'diagnostics', file, ...lspTimeout(timeoutMs) },
    'lsp',
  );
  throwIfLspError(text);
  const diagnostics = parseDiagnostics(text);
  if (diagnostics.length === 0) {
    // Empty text means either "no diagnostics" or "no language server"; only the
    // status tells them apart, and answering 200 with no server hides a real
    // misconfiguration (symbols already refuses in that case).
    const status = await lspStatusImpl(sessionId);
    if (!status.ok) throw new InvalidRequestError('No language server configured for this session');
  }
  return diagnostics;
}

export async function lspDefinitionImpl(
  sessionId: string,
  file: string,
  line: number,
  symbol: string,
): Promise<LspLocation[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(
    tools.lsp,
    entry,
    { action: 'definition', file, line, symbol },
    'lsp',
  );
  throwIfLspError(text);
  return parseLocations(text);
}

export async function lspHoverImpl(
  sessionId: string,
  file: string,
  line: number,
  symbol: string,
): Promise<string> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(tools.lsp, entry, { action: 'hover', file, line, symbol }, 'lsp');
  throwIfLspError(text);
  return text.trim() === 'No hover information' ? '' : text;
}

export async function lspSymbolsImpl(
  sessionId: string,
  file: string,
  query?: string,
): Promise<LspSymbol[]> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const workspace = query !== undefined || file === '*';
  const { text } = await runTool(
    tools.lsp,
    entry,
    workspace ? { action: 'symbols', file: '*', query } : { action: 'symbols', file },
    'lsp',
  );
  throwIfLspError(text);
  return parseSymbols(text);
}

export async function lspStatusImpl(sessionId: string): Promise<LspStatus> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const { text } = await runTool(tools.lsp, entry, { action: 'status' }, 'lsp');
  return parseLspStatus(text);
}

// ---------------------------------------------------------------------------
// Debug (via BUILTIN_TOOLS.debug execute; structured state from details).
// ---------------------------------------------------------------------------

/**
 * Map a REST/debug action (+ step kind) to the SDK debug action.
 * Pure (no SDK import) for unit tests.
 */
/**
 * Raw LSP request: forwards the TUI's own parameter object to the lsp tool, so
 * every action the SDK supports (references, rename, code_actions, reload, …)
 * works without the backend re-deriving per-action shapes. Returns the tool's
 * text output plus its structured details.
 */

export async function lspRequestImpl(
  sessionId: string,
  params: Record<string, unknown>,
): Promise<{ text: string; details: Record<string, unknown> | undefined }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  return runTool(tools.lsp, entry, params, 'lsp');
}

/** Raw debug request, same rationale as {@link lspRequestImpl}. */
