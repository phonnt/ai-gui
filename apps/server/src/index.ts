import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { errorMessage, errorToStatus } from './routes/errors.js';
import { healthResponse } from './routes/health.js';
import { messagesRoute } from './routes/messages.js';
import {
  clearSessionRoute,
  dropSessionRoute,
  forkSessionRoute,
  freshSessionRoute,
  renameSessionRoute,
} from './routes/ops.js';
import { abortRoute, promptRoute } from './routes/prompt.js';
import { createSessionRoute, listSessionsRoute } from './routes/sessions.js';
import { dumpRoute, exportRoute, shareRoute } from './routes/share.js';
import { branchRoute, navigateTreeRoute, treeRoute } from './routes/tree.js';
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
const FORK_PATH = /^\/api\/sessions\/([^/]+)\/fork$/;
const CLEAR_PATH = /^\/api\/sessions\/([^/]+)\/clear$/;
const FRESH_PATH = /^\/api\/sessions\/([^/]+)\/fresh$/;
const TREE_PATH = /^\/api\/sessions\/([^/]+)\/tree$/;
const NAVIGATE_PATH = /^\/api\/sessions\/([^/]+)\/tree\/navigate$/;
const BRANCH_PATH = /^\/api\/sessions\/([^/]+)\/branch$/;
const EXPORT_PATH = /^\/api\/sessions\/([^/]+)\/export$/;
const DUMP_PATH = /^\/api\/sessions\/([^/]+)\/dump$/;
const SHARE_PATH = /^\/api\/sessions\/([^/]+)\/share$/;
const SESSION_PATH = /^\/api\/sessions\/([^/]+)$/;

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
        const forkMatch = FORK_PATH.exec(pathname);
        if (req.method === 'POST' && forkMatch) {
          const sessionId = decodeURIComponent(forkMatch[1] ?? '');
          return Response.json(await forkSessionRoute(runtime, sessionId));
        }
        const clearMatch = CLEAR_PATH.exec(pathname);
        if (req.method === 'POST' && clearMatch) {
          const sessionId = decodeURIComponent(clearMatch[1] ?? '');
          return Response.json(await clearSessionRoute(runtime, sessionId));
        }
        const freshMatch = FRESH_PATH.exec(pathname);
        if (req.method === 'POST' && freshMatch) {
          const sessionId = decodeURIComponent(freshMatch[1] ?? '');
          return Response.json(await freshSessionRoute(runtime, sessionId));
        }
        const navigateMatch = NAVIGATE_PATH.exec(pathname);
        if (req.method === 'POST' && navigateMatch) {
          const sessionId = decodeURIComponent(navigateMatch[1] ?? '');
          return Response.json(await navigateTreeRoute(runtime, sessionId, await readJson(req)));
        }
        const treeMatch = TREE_PATH.exec(pathname);
        if (req.method === 'GET' && treeMatch) {
          const sessionId = decodeURIComponent(treeMatch[1] ?? '');
          return Response.json(await treeRoute(runtime, sessionId));
        }
        const branchMatch = BRANCH_PATH.exec(pathname);
        if (req.method === 'POST' && branchMatch) {
          const sessionId = decodeURIComponent(branchMatch[1] ?? '');
          return Response.json(await branchRoute(runtime, sessionId, await readJson(req)));
        }
        const exportMatch = EXPORT_PATH.exec(pathname);
        if (req.method === 'GET' && exportMatch) {
          const sessionId = decodeURIComponent(exportMatch[1] ?? '');
          return Response.json(await exportRoute(runtime, sessionId));
        }
        const dumpMatch = DUMP_PATH.exec(pathname);
        if (req.method === 'GET' && dumpMatch) {
          const sessionId = decodeURIComponent(dumpMatch[1] ?? '');
          return Response.json(await dumpRoute(runtime, sessionId));
        }
        const shareMatch = SHARE_PATH.exec(pathname);
        if (req.method === 'POST' && shareMatch) {
          const sessionId = decodeURIComponent(shareMatch[1] ?? '');
          return Response.json(await shareRoute(runtime, sessionId));
        }
        const sessionMatch = SESSION_PATH.exec(pathname);
        if (req.method === 'DELETE' && sessionMatch) {
          const sessionId = decodeURIComponent(sessionMatch[1] ?? '');
          return Response.json(await dropSessionRoute(runtime, sessionId));
        }
        if (req.method === 'PATCH' && sessionMatch) {
          const sessionId = decodeURIComponent(sessionMatch[1] ?? '');
          return Response.json(await renameSessionRoute(runtime, sessionId, await readJson(req)));
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
