import type { SessionTools } from '@ai-gui/agent-runtime';
import { LspRequestSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/**
 * Wire LSP params → SDK tool params. Only `timeoutMs` (ms) needs converting
 * (`timeout` in seconds) and `file` needs jailing; the rest share names.
 */
function toSdkLspParams(
  data: Record<string, unknown>,
  cwd: string,
  roots: readonly string[],
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (key === 'timeoutMs') {
      params.timeout = Math.max(5, Math.ceil((value as number) / 1000));
    } else if (key === 'file' && typeof value === 'string' && value !== '*') {
      params.file = resolveSessionPath(cwd, value, roots);
    } else {
      params[key] = value;
    }
  }
  return params;
}

/** POST /api/sessions/:id/lsp { action, file?, line?, symbol?, query?, timeoutMs? } → { result }. */
export async function lspRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
  roots: readonly string[],
  body: unknown,
): Promise<{ result: unknown }> {
  const parsed = LspRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  const data = parsed.data;
  switch (data.action) {
    case 'diagnostics': {
      if (!data.file) throw new HttpError(400, 'file is required for diagnostics');
      return {
        result: await tools.lspDiagnostics({
          sessionId,
          file: resolveSessionPath(cwd, data.file, roots),
          ...(data.timeoutMs !== undefined ? { timeoutMs: data.timeoutMs } : {}),
        }),
      };
    }
    case 'definition': {
      if (!data.file) throw new HttpError(400, 'file is required for definition');
      if (data.line === undefined) throw new HttpError(400, 'line is required for definition');
      if (!data.symbol) throw new HttpError(400, 'symbol is required for definition');
      return {
        result: await tools.lspDefinition({
          sessionId,
          file: resolveSessionPath(cwd, data.file, roots),
          line: data.line,
          symbol: data.symbol,
        }),
      };
    }
    case 'hover': {
      if (!data.file) throw new HttpError(400, 'file is required for hover');
      if (data.line === undefined) throw new HttpError(400, 'line is required for hover');
      if (!data.symbol) throw new HttpError(400, 'symbol is required for hover');
      return {
        result: await tools.lspHover({
          sessionId,
          file: resolveSessionPath(cwd, data.file, roots),
          line: data.line,
          symbol: data.symbol,
        }),
      };
    }
    case 'symbols': {
      if (!data.file) throw new HttpError(400, 'file is required for symbols');
      return {
        result: await tools.lspSymbols({
          sessionId,
          file: data.file === '*' ? '*' : resolveSessionPath(cwd, data.file, roots),
          ...(data.query !== undefined ? { query: data.query } : {}),
        }),
      };
    }
    case 'status': {
      return { result: await tools.lspStatus({ sessionId }) };
    }
    default: {
      // SDK-only actions (references, rename, rename_file, code_actions,
      // type_definition, implementation, reload, capabilities, request) pass
      // the TUI's own parameter object straight to the lsp tool.
      return {
        result: await tools.lspRequest({
          sessionId,
          params: toSdkLspParams(data, cwd, roots),
        }),
      };
    }
  }
}
