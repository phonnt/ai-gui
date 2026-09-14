import type { AgentRuntime, HubOps, SessionTools } from '@ai-gui/agent-runtime';
import {
  createHubOps,
  createSessionTools,
  dropSessionTools,
  resolveToolCwd,
  setSessionCwd,
  setSessionFile,
} from '@ai-gui/omp-adapter';
import { listArtifactsRoute, readArtifactRoute } from './routes/artifacts.js';
import { bashRoute } from './routes/bash.js';
import { listModelsRoute, listProvidersRoute } from './routes/catalog.js';
import { resetKernelRoute, runCellRoute } from './routes/cells.js';
import { listCommandsRoute } from './routes/commands.js';
import { debugRoute } from './routes/debug.js';
import { errorMessage, errorToStatus } from './routes/errors.js';
import {
  browseRoute,
  editFileRoute,
  listDirRoute,
  readFileRoute,
  writeFileRoute,
} from './routes/files.js';
import { getGoalRoute, goalActionRoute } from './routes/goal.js';
import { healthResponse } from './routes/health.js';
import {
  hubJobsCancelRoute,
  hubJobsRoute,
  hubKillRoute,
  hubReviveRoute,
  hubRosterRoute,
  hubSpawnRoute,
  hubSteerRoute,
} from './routes/hub.js';
import {
  enqueueMemoryRoute,
  getMemoryRoute,
  listSkillsRoute,
  readSkillRoute,
} from './routes/knowledge.js';
import { lspRoute } from './routes/lsp.js';
import { listMcpRoute, mcpActionRoute } from './routes/mcp.js';
import { messagesRoute } from './routes/messages.js';
import { getModelRoute, setModelRoute, setThinkingRoute } from './routes/model.js';
import { getModesRoute, modeActionRoute } from './routes/modes.js';
import {
  clearSessionRoute,
  compactSessionRoute,
  dropSessionRoute,
  forkSessionRoute,
  freshSessionRoute,
  renameSessionRoute,
  retryTurnRoute,
} from './routes/ops.js';
import { abortRoute, promptRoute } from './routes/prompt.js';
import { createSessionRoute, listSessionsRoute } from './routes/sessions.js';
import {
  applyThemeRoute,
  getSettingRoute,
  listSettingsRoute,
  listThemesRoute,
  resetSettingRoute,
  setSettingRoute,
} from './routes/settings.js';
import { dumpRoute, exportRoute, shareRoute } from './routes/share.js';
import { applyTodoOpRoute, getTodosRoute } from './routes/todos.js';
import { branchRoute, labelTreeEntryRoute, navigateTreeRoute, treeRoute } from './routes/tree.js';
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
const COMPACT_PATH = /^\/api\/sessions\/([^/]+)\/compact$/;
const RETRY_PATH = /^\/api\/sessions\/([^/]+)\/retry$/;
const TREE_PATH = /^\/api\/sessions\/([^/]+)\/tree$/;
const TREE_LABEL_PATH = /^\/api\/sessions\/([^/]+)\/tree\/label$/;
const MODEL_PATH = /^\/api\/sessions\/([^/]+)\/model$/;
const THINKING_PATH = /^\/api\/sessions\/([^/]+)\/thinking$/;
const NAVIGATE_PATH = /^\/api\/sessions\/([^/]+)\/tree\/navigate$/;
const BRANCH_PATH = /^\/api\/sessions\/([^/]+)\/branch$/;
const EXPORT_PATH = /^\/api\/sessions\/([^/]+)\/export$/;
const DUMP_PATH = /^\/api\/sessions\/([^/]+)\/dump$/;
const SHARE_PATH = /^\/api\/sessions\/([^/]+)\/share$/;
const SESSION_PATH = /^\/api\/sessions\/([^/]+)$/;
const GOAL_PATH = /^\/api\/sessions\/([^/]+)\/goal$/;
const MODES_PATH = /^\/api\/sessions\/([^/]+)\/modes$/;
const FILES_PATH = /^\/api\/sessions\/([^/]+)\/files$/;
const FILES_LIST_PATH = /^\/api\/sessions\/([^/]+)\/files\/list$/;
const EDIT_PATH = /^\/api\/sessions\/([^/]+)\/edit$/;
const BASH_PATH = /^\/api\/sessions\/([^/]+)\/bash$/;
const CELLS_PATH = /^\/api\/sessions\/([^/]+)\/cells$/;
const CELLS_RESET_PATH = /^\/api\/sessions\/([^/]+)\/cells\/reset$/;
const LSP_PATH = /^\/api\/sessions\/([^/]+)\/lsp$/;
const DEBUG_PATH = /^\/api\/sessions\/([^/]+)\/debug$/;
const TODOS_PATH = /^\/api\/sessions\/([^/]+)\/todos$/;
const ARTIFACTS_PATH = /^\/api\/sessions\/([^/]+)\/artifacts$/;
const ARTIFACT_PATH = /^\/api\/sessions\/([^/]+)\/artifacts\/([^/]+)$/;
const HUB_AGENTS_PATH = /^\/api\/hub\/agents$/;
const HUB_AGENT_PATH = /^\/api\/hub\/agents\/([^/]+)\/(steer|revive|kill)$/;
const HUB_JOBS_PATH = /^\/api\/hub\/jobs$/;
const HUB_JOBS_CANCEL_PATH = /^\/api\/hub\/jobs\/cancel$/;
const HUB_SPAWN_PATH = /^\/api\/hub\/spawn$/;
const SETTINGS_PATH = /^\/api\/settings$/;
const SETTING_PATH = /^\/api\/settings\/([^/]+)$/;
const THEMES_PATH = /^\/api\/themes$/;
const THEMES_APPLY_PATH = /^\/api\/themes\/apply$/;
const MODELS_PATH = /^\/api\/models$/;
const PROVIDERS_PATH = /^\/api\/providers$/;
const MCP_PATH = /^\/api\/mcp$/;
const MCP_ACTION_PATH = /^\/api\/mcp\/([^/]+)\/(test|reconnect|reload)$/;
const SKILLS_PATH = /^\/api\/skills$/;
const SKILL_PATH = /^\/api\/skills\/([^/]+)$/;
const MEMORY_PATH = /^\/api\/memory$/;
const MEMORY_ENQUEUE_PATH = /^\/api\/memory\/enqueue$/;
const COMMANDS_PATH = /^\/api\/commands$/;
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
  const tools: SessionTools = createSessionTools();
  const hub: HubOps = createHubOps();
  // createSession responses, consulted for cwd jailing on every tool route.
  // Falls back to the on-disk session listing so a server restart does not
  // orphan existing web sessions.
  const sessionCwds = new Map<string, string>();
  const toolCwd = async (sessionId: string): Promise<string> => {
    const cwd = sessionCwds.get(sessionId);
    if (cwd) return cwd;
    const resolved = await resolveToolCwd(sessionId);
    sessionCwds.set(sessionId, resolved);
    return resolved;
  };

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
        if (req.method === 'GET' && pathname === '/api/fs/browse') {
          return Response.json(await browseRoute(queryRecord(url)));
        }
        if (req.method === 'GET' && pathname === '/api/sessions') {
          return Response.json(await listSessionsRoute(runtime));
        }
        if (req.method === 'POST' && pathname === '/api/sessions') {
          const created = await createSessionRoute(runtime, await readJson(req));
          if (created.session && typeof created.session === 'object') {
            const raw = created.session as Record<string, unknown>;
            const id = raw.id;
            const cwd = raw.cwd;
            if (typeof id === 'string' && id) {
              if (typeof cwd === 'string' && cwd) {
                sessionCwds.set(id, cwd);
                setSessionCwd(id, cwd);
              }
              try {
                setSessionFile(id, await runtime.getSessionFile(id));
              } catch {
                /* journal not ready yet; artifact routes report it when used */
              }
            }
          }
          return Response.json(created);
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
        const compactMatch = COMPACT_PATH.exec(pathname);
        if (req.method === 'POST' && compactMatch) {
          const sessionId = decodeURIComponent(compactMatch[1] ?? '');
          return Response.json(await compactSessionRoute(runtime, sessionId, await readJson(req)));
        }
        const retryMatch = RETRY_PATH.exec(pathname);
        if (req.method === 'POST' && retryMatch) {
          const sessionId = decodeURIComponent(retryMatch[1] ?? '');
          return Response.json(await retryTurnRoute(runtime, sessionId));
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
        const modelMatch = MODEL_PATH.exec(pathname);
        if (req.method === 'GET' && modelMatch) {
          return Response.json(
            await getModelRoute(runtime, decodeURIComponent(modelMatch[1] ?? '')),
          );
        }
        if (req.method === 'POST' && modelMatch) {
          const sessionId = decodeURIComponent(modelMatch[1] ?? '');
          return Response.json(await setModelRoute(runtime, sessionId, await readJson(req)));
        }
        const thinkingMatch = THINKING_PATH.exec(pathname);
        if (req.method === 'POST' && thinkingMatch) {
          const sessionId = decodeURIComponent(thinkingMatch[1] ?? '');
          return Response.json(await setThinkingRoute(runtime, sessionId, await readJson(req)));
        }
        const branchMatch = BRANCH_PATH.exec(pathname);
        if (req.method === 'POST' && branchMatch) {
          const sessionId = decodeURIComponent(branchMatch[1] ?? '');
          return Response.json(await branchRoute(runtime, sessionId, await readJson(req)));
        }
        const treeLabelMatch = TREE_LABEL_PATH.exec(pathname);
        if (req.method === 'POST' && treeLabelMatch) {
          const sessionId = decodeURIComponent(treeLabelMatch[1] ?? '');
          return Response.json(await labelTreeEntryRoute(runtime, sessionId, await readJson(req)));
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
          const dropped = await dropSessionRoute(runtime, sessionId);
          sessionCwds.delete(sessionId);
          dropSessionTools(sessionId);
          return Response.json(dropped);
        }
        if (req.method === 'PATCH' && sessionMatch) {
          const sessionId = decodeURIComponent(sessionMatch[1] ?? '');
          return Response.json(await renameSessionRoute(runtime, sessionId, await readJson(req)));
        }
        const goalMatch = GOAL_PATH.exec(pathname);
        if (goalMatch) {
          const sessionId = decodeURIComponent(goalMatch[1] ?? '');
          if (req.method === 'GET') return Response.json(await getGoalRoute(runtime, sessionId));
          if (req.method === 'POST') {
            return Response.json(await goalActionRoute(runtime, sessionId, await readJson(req)));
          }
        }
        const modesMatch = MODES_PATH.exec(pathname);
        if (modesMatch) {
          const sessionId = decodeURIComponent(modesMatch[1] ?? '');
          if (req.method === 'GET') return Response.json(await getModesRoute(runtime, sessionId));
          if (req.method === 'POST') {
            return Response.json(await modeActionRoute(runtime, sessionId, await readJson(req)));
          }
        }
        const filesListMatch = FILES_LIST_PATH.exec(pathname);
        if (req.method === 'GET' && filesListMatch) {
          const sessionId = decodeURIComponent(filesListMatch[1] ?? '');
          return Response.json(
            await listDirRoute(tools, sessionId, await toolCwd(sessionId), queryRecord(url)),
          );
        }
        const filesMatch = FILES_PATH.exec(pathname);
        if (req.method === 'GET' && filesMatch) {
          const sessionId = decodeURIComponent(filesMatch[1] ?? '');
          return Response.json(
            await readFileRoute(tools, sessionId, await toolCwd(sessionId), queryRecord(url)),
          );
        }
        if (req.method === 'POST' && filesMatch) {
          const sessionId = decodeURIComponent(filesMatch[1] ?? '');
          return Response.json(
            await writeFileRoute(tools, sessionId, await toolCwd(sessionId), await readJson(req)),
          );
        }
        const editMatch = EDIT_PATH.exec(pathname);
        if (req.method === 'POST' && editMatch) {
          const sessionId = decodeURIComponent(editMatch[1] ?? '');
          return Response.json(
            await editFileRoute(tools, sessionId, await toolCwd(sessionId), await readJson(req)),
          );
        }
        const bashMatch = BASH_PATH.exec(pathname);
        if (req.method === 'POST' && bashMatch) {
          const sessionId = decodeURIComponent(bashMatch[1] ?? '');
          return Response.json(
            await bashRoute(tools, sessionId, await toolCwd(sessionId), await readJson(req)),
          );
        }
        const cellsResetMatch = CELLS_RESET_PATH.exec(pathname);
        if (req.method === 'POST' && cellsResetMatch) {
          const sessionId = decodeURIComponent(cellsResetMatch[1] ?? '');
          return Response.json(await resetKernelRoute(tools, sessionId, await readJson(req)));
        }
        const cellsMatch = CELLS_PATH.exec(pathname);
        if (req.method === 'POST' && cellsMatch) {
          const sessionId = decodeURIComponent(cellsMatch[1] ?? '');
          return Response.json(await runCellRoute(tools, sessionId, await readJson(req)));
        }
        const lspMatch = LSP_PATH.exec(pathname);
        if (req.method === 'POST' && lspMatch) {
          const sessionId = decodeURIComponent(lspMatch[1] ?? '');
          return Response.json(
            await lspRoute(tools, sessionId, await toolCwd(sessionId), await readJson(req)),
          );
        }
        const debugMatch = DEBUG_PATH.exec(pathname);
        if (req.method === 'POST' && debugMatch) {
          const sessionId = decodeURIComponent(debugMatch[1] ?? '');
          return Response.json(
            await debugRoute(tools, sessionId, await toolCwd(sessionId), await readJson(req)),
          );
        }
        const todosMatch = TODOS_PATH.exec(pathname);
        if (req.method === 'GET' && todosMatch) {
          const sessionId = decodeURIComponent(todosMatch[1] ?? '');
          return Response.json(await getTodosRoute(tools, sessionId));
        }
        if (req.method === 'POST' && todosMatch) {
          const sessionId = decodeURIComponent(todosMatch[1] ?? '');
          return Response.json(await applyTodoOpRoute(tools, sessionId, await readJson(req)));
        }
        const artifactsMatch = ARTIFACTS_PATH.exec(pathname);
        if (req.method === 'GET' && artifactsMatch) {
          const sessionId = decodeURIComponent(artifactsMatch[1] ?? '');
          return Response.json(await listArtifactsRoute(tools, sessionId));
        }
        const artifactMatch = ARTIFACT_PATH.exec(pathname);
        if (req.method === 'GET' && artifactMatch) {
          const sessionId = decodeURIComponent(artifactMatch[1] ?? '');
          const artifactId = decodeURIComponent(artifactMatch[2] ?? '');
          return Response.json(
            await readArtifactRoute(tools, sessionId, artifactId, queryRecord(url)),
          );
        }
        const hubAgentsMatch = HUB_AGENTS_PATH.exec(pathname);
        if (req.method === 'GET' && hubAgentsMatch) {
          return Response.json(await hubRosterRoute(hub));
        }
        const hubAgentMatch = HUB_AGENT_PATH.exec(pathname);
        if (req.method === 'POST' && hubAgentMatch) {
          const id = decodeURIComponent(hubAgentMatch[1] ?? '');
          const op = hubAgentMatch[2];
          if (op === 'steer')
            return Response.json(await hubSteerRoute(hub, id, await readJson(req)));
          if (op === 'revive') return Response.json(await hubReviveRoute(hub, id));
          return Response.json(await hubKillRoute(hub, id));
        }
        if (req.method === 'GET' && HUB_JOBS_PATH.exec(pathname)) {
          return Response.json(await hubJobsRoute(hub));
        }
        if (req.method === 'POST' && HUB_JOBS_CANCEL_PATH.exec(pathname)) {
          return Response.json(await hubJobsCancelRoute(hub, await readJson(req)));
        }
        if (req.method === 'POST' && HUB_SPAWN_PATH.exec(pathname)) {
          return Response.json(await hubSpawnRoute(hub, await readJson(req)));
        }
        if (req.method === 'GET' && SETTINGS_PATH.exec(pathname)) {
          return Response.json(await listSettingsRoute());
        }
        const settingMatch = SETTING_PATH.exec(pathname);
        if (req.method === 'GET' && settingMatch) {
          return Response.json(await getSettingRoute(settingMatch[1] ?? ''));
        }
        if (req.method === 'PUT' && settingMatch) {
          return Response.json(await setSettingRoute(settingMatch[1] ?? '', await readJson(req)));
        }
        if (req.method === 'DELETE' && settingMatch) {
          return Response.json(await resetSettingRoute(settingMatch[1] ?? ''));
        }
        if (req.method === 'GET' && THEMES_PATH.exec(pathname)) {
          return Response.json(await listThemesRoute());
        }
        if (req.method === 'POST' && THEMES_APPLY_PATH.exec(pathname)) {
          return Response.json(await applyThemeRoute(await readJson(req)));
        }
        if (req.method === 'GET' && MODELS_PATH.exec(pathname)) {
          return Response.json(await listModelsRoute());
        }
        if (req.method === 'GET' && PROVIDERS_PATH.exec(pathname)) {
          return Response.json(await listProvidersRoute());
        }
        if (req.method === 'GET' && MCP_PATH.exec(pathname)) {
          return Response.json(await listMcpRoute());
        }
        const mcpActionMatch = MCP_ACTION_PATH.exec(pathname);
        if (req.method === 'POST' && mcpActionMatch) {
          let mcpName: string;
          try {
            mcpName = decodeURIComponent(mcpActionMatch[1] ?? '');
          } catch {
            return Response.json({ error: 'bad mcp server name' }, { status: 400 });
          }
          return Response.json(await mcpActionRoute(mcpName, mcpActionMatch[2] ?? ''));
        }
        if (req.method === 'GET' && SKILLS_PATH.exec(pathname)) {
          return Response.json(await listSkillsRoute());
        }
        const skillMatch = SKILL_PATH.exec(pathname);
        if (req.method === 'GET' && skillMatch) {
          return Response.json(await readSkillRoute(skillMatch[1] ?? '', queryRecord(url)));
        }
        if (req.method === 'GET' && MEMORY_PATH.exec(pathname)) {
          return Response.json(await getMemoryRoute());
        }
        if (req.method === 'POST' && MEMORY_ENQUEUE_PATH.exec(pathname)) {
          return Response.json(await enqueueMemoryRoute());
        }
        if (req.method === 'GET' && COMMANDS_PATH.exec(pathname)) {
          return Response.json(await listCommandsRoute(queryRecord(url)));
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
