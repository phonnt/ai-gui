import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { errorMessage, errorToStatus } from './routes/errors.js';
import { healthResponse } from './routes/health.js';
import { messagesRoute } from './routes/messages.js';
import { abortRoute, promptRoute } from './routes/prompt.js';
import { createSessionRoute, listSessionsRoute } from './routes/sessions.js';
import { createRuntime } from './runtime/select.js';
import { createStreamBus } from './stream/bus.js';

const globals = globalThis as {
  process?: {
    env?: Record<string, string | undefined>;
    cwd?: () => string;
    on?: (signal: string, fn: () => void) => void;
    exit?: (code: number) => void;
  };
  Bun?: {
    serve: (options: {
      port: number;
      fetch: (
        req: Request,
        server: unknown,
      ) => Response | undefined | Promise<Response | undefined>;
      websocket: {
        open: (ws: unknown) => void;
        message: (ws: unknown, message: unknown) => void;
        close: (ws: unknown) => void;
      };
    }) => { stop: () => void };
  };
};

const STREAM_PATH = /^\/api\/sessions\/([^/]+)\/stream$/;
const MESSAGES_PATH = /^\/api\/sessions\/([^/]+)\/messages$/;
const PROMPT_PATH = /^\/api\/sessions\/([^/]+)\/prompt$/;
const ABORT_PATH = /^\/api\/sessions\/([^/]+)\/abort$/;

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function queryRecord(url: URL): Record<string, string | undefined> {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of url.searchParams) {
    if (record[key] === undefined) record[key] = value;
  }
  return record;
}

async function main(): Promise<void> {
  if (!globals.Bun) throw new Error('ai-gui server must run under Bun');
  const port = Number(globals.process?.env?.AI_GUI_PORT ?? 8787);
  const runtime: AgentRuntime = await createRuntime(globals.process?.cwd?.());
  const bus = createStreamBus(runtime);

  const stop = async (): Promise<void> => {
    bus.dispose();
    try {
      await runtime.dispose();
    } catch {
      /* best-effort */
    }
    globals.process?.exit?.(0);
  };
  globals.process?.on?.('SIGINT', () => void stop());
  globals.process?.on?.('SIGTERM', () => void stop());

  globals.Bun.serve({
    port,
    fetch: async (req: Request, server: unknown) => {
      const url = new URL(req.url);
      const { pathname } = url;
      const upgrade = (server as { upgrade?: (req: Request, options?: object) => boolean } | null)
        ?.upgrade;
      const streamMatch = STREAM_PATH.exec(pathname);
      if (streamMatch && upgrade) {
        const sessionId = decodeURIComponent(streamMatch[1] ?? '');
        const upgraded = (
          server as { upgrade: (req: Request, options?: object) => boolean }
        ).upgrade(req, { data: { sessionId } });
        if (upgraded) return undefined;
        return Response.json({ error: 'websocket upgrade failed' }, { status: 500 });
      }
      try {
        if (req.method === 'GET' && pathname === '/api/health') {
          return Response.json(healthResponse(runtime));
        }
        if (req.method === 'GET' && pathname === '/api/sessions') {
          return Response.json(await listSessionsRoute(runtime));
        }
        if (req.method === 'POST' && pathname === '/api/sessions') {
          return Response.json(await createSessionRoute(runtime, await readJson(req)));
        }
        const messagesMatch = MESSAGES_PATH.exec(pathname);
        if (req.method === 'GET' && messagesMatch) {
          const sessionId = decodeURIComponent(messagesMatch[1] ?? '');
          return Response.json(await messagesRoute(runtime, sessionId, queryRecord(url)));
        }
        const promptMatch = PROMPT_PATH.exec(pathname);
        if (req.method === 'POST' && promptMatch) {
          const sessionId = decodeURIComponent(promptMatch[1] ?? '');
          return Response.json(await promptRoute(runtime, sessionId, await readJson(req)));
        }
        const abortMatch = ABORT_PATH.exec(pathname);
        if (req.method === 'POST' && abortMatch) {
          const sessionId = decodeURIComponent(abortMatch[1] ?? '');
          return Response.json(await abortRoute(runtime, sessionId));
        }
        return Response.json({ error: 'not found' }, { status: 404 });
      } catch (err) {
        return Response.json({ error: errorMessage(err) }, { status: errorToStatus(err) });
      }
    },
    websocket: {
      open: (ws: unknown) => {
        const sessionId = (ws as { data?: { sessionId?: unknown } }).data?.sessionId;
        if (typeof sessionId === 'string' && sessionId) bus.add(sessionId, ws);
      },
      message: (_ws: unknown, _message: unknown) => {},
      close: (ws: unknown) => {
        bus.remove(ws);
      },
    },
  });
  console.log(`ai-gui server on :${port} runtime=${runtime.kind}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  globals.process?.exit?.(1);
});
