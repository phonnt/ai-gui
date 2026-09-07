import type { SessionTools } from '@ai-gui/agent-runtime';
import { LspRequestSchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';
import { resolveSessionPath } from './jail.js';

/** POST /api/sessions/:id/lsp { action, file?, line?, symbol?, query?, timeoutMs? } → { result }. */
export async function lspRoute(
  tools: SessionTools,
  sessionId: string,
  cwd: string,
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
          file: resolveSessionPath(cwd, data.file),
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
          file: resolveSessionPath(cwd, data.file),
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
          file: resolveSessionPath(cwd, data.file),
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
          file: data.file === '*' ? '*' : resolveSessionPath(cwd, data.file),
          ...(data.query !== undefined ? { query: data.query } : {}),
        }),
      };
    }
    case 'status': {
      return { result: await tools.lspStatus({ sessionId }) };
    }
  }
}
