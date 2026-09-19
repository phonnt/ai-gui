import type { AgentRuntime, HubOps, SessionTools } from '@ai-gui/agent-runtime';
import {
  createHubOps,
  createSessionTools,
  dropSessionTools,
  resolveToolCwd,
  setSessionCwd,
  setSessionFile,
} from '@ai-gui/omp-adapter';
import { isApiPath, isAuthorized, tokenCookieHeader } from './auth.js';
import { listArtifactsRoute, readArtifactRoute } from './routes/artifacts.js';
import { bashRoute } from './routes/bash.js';
import {
  listModelRolesRoute,
  listModelsRoute,
  listProvidersRoute,
  setModelRoleRoute,
} from './routes/catalog.js';
import { resetKernelRoute, runCellRoute } from './routes/cells.js';
import { listCommandsRoute } from './routes/commands.js';
import { conflictsRoute, resolveConflictsRoute } from './routes/conflicts.js';
import { debugRoute } from './routes/debug.js';
import { errorMessage, errorToStatus } from './routes/errors.js';
import {
  browseRoute,
  editFileRoute,
  globRoute,
  grepRoute,
  listDirRoute,
  readFileRoute,
  writeFileRoute,
} from './routes/files.js';
import { getGoalRoute, goalActionRoute, guidedGoalRoute } from './routes/goal.js';
import { healthResponse } from './routes/health.js';
import {
  hubInboxRoute,
  hubJobsCancelRoute,
  hubJobsRoute,
  hubKillRoute,
  hubReviveRoute,
  hubRosterRoute,
  hubSendRoute,
  hubSpawnRoute,
  hubSteerRoute,
  hubTranscriptRoute,
  hubWaitRoute,
} from './routes/hub.js';
import { cancelJobRoute, listJobsRoute } from './routes/jobs.js';
import {
  getMemoryRoute,
  memoryOpRoute,
  sessionSkillContentRoute,
  sessionSkillsRoute,
  setMemoryBackendRoute,
} from './routes/knowledge.js';
import { getLoopRoute, pauseLoopRoute, startLoopRoute, stopLoopRoute } from './routes/loop.js';
import { lspRoute } from './routes/lsp.js';
import { listMcpRoute, listMcpToolsRoute, mcpActionRoute } from './routes/mcp.js';
import { messagesRoute } from './routes/messages.js';
import { getModelRoute, getStatsRoute, setModelRoute, setThinkingRoute } from './routes/model.js';
import {
  getModesRoute,
  modeActionRoute,
  planDecisionRoute,
  planDraftRoute,
  sessionToolsRoute,
} from './routes/modes.js';
import {
  clearSessionRoute,
  compactSessionRoute,
  dropSessionRoute,
  forkSessionRoute,
  freshSessionRoute,
  moveSessionRoute,
  renameSessionRoute,
  retryTurnRoute,
} from './routes/ops.js';
import { abortRoute, approvalRoute, promptRoute } from './routes/prompt.js';
import { securityScanRoute } from './routes/security.js';
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
import {
  addWorkspaceDirRoute,
  removeWorkspaceDirRoute,
  workspaceRoute,
} from './routes/workspace.js';
import { createRuntime } from './runtime/select.js';
import { classifyStaticPath, contentTypeFor, isImmutableAsset, STATIC_CSP } from './static.js';
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
      hostname?: string;
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
const APPROVAL_PATH = /^\/api\/sessions\/([^/]+)\/approval\/([^/]+)$/;
const FORK_PATH = /^\/api\/sessions\/([^/]+)\/fork$/;
const CLEAR_PATH = /^\/api\/sessions\/([^/]+)\/clear$/;
const FRESH_PATH = /^\/api\/sessions\/([^/]+)\/fresh$/;
const COMPACT_PATH = /^\/api\/sessions\/([^/]+)\/compact$/;
const RETRY_PATH = /^\/api\/sessions\/([^/]+)\/retry$/;
const TREE_PATH = /^\/api\/sessions\/([^/]+)\/tree$/;
const TREE_LABEL_PATH = /^\/api\/sessions\/([^/]+)\/tree\/label$/;
const MODEL_PATH = /^\/api\/sessions\/([^/]+)\/model$/;
const STATS_PATH = /^\/api\/sessions\/([^/]+)\/stats$/;
const SECURITY_SCAN_PATH = /^\/api\/sessions\/([^/]+)\/security$/;
const GUIDED_GOAL_PATH = /^\/api\/sessions\/([^/]+)\/guided-goal$/;
const SESSION_TOOLS_PATH = /^\/api\/sessions\/([^/]+)\/tools$/;
const LOOP_PATH = /^\/api\/sessions\/([^/]+)\/loop$/;
const LOOP_PAUSE_PATH = /^\/api\/sessions\/([^/]+)\/loop\/pause$/;
const PLAN_DECISION_PATH = /^\/api\/sessions\/([^/]+)\/plan$/;
const WORKSPACE_PATH = /^\/api\/sessions\/([^/]+)\/workspace$/;
const WORKSPACE_DIRS_PATH = /^\/api\/sessions\/([^/]+)\/workspace\/dirs$/;
const CONFLICTS_PATH = /^\/api\/sessions\/([^/]+)\/conflicts$/;
const CONFLICTS_RESOLVE_PATH = /^\/api\/sessions\/([^/]+)\/conflicts\/resolve$/;
const THINKING_PATH = /^\/api\/sessions\/([^/]+)\/thinking$/;
const NAVIGATE_PATH = /^\/api\/sessions\/([^/]+)\/tree\/navigate$/;
const BRANCH_PATH = /^\/api\/sessions\/([^/]+)\/branch$/;
const EXPORT_PATH = /^\/api\/sessions\/([^/]+)\/export$/;
const DUMP_PATH = /^\/api\/sessions\/([^/]+)\/dump$/;
const SHARE_PATH = /^\/api\/sessions\/([^/]+)\/share$/;
const SESSION_PATH = /^\/api\/sessions\/([^/]+)$/;
const MOVE_PATH = /^\/api\/sessions\/([^/]+)\/move$/;
const GOAL_PATH = /^\/api\/sessions\/([^/]+)\/goal$/;
const MODES_PATH = /^\/api\/sessions\/([^/]+)\/modes$/;
const FILES_PATH = /^\/api\/sessions\/([^/]+)\/files$/;
const JOBS_PATH = /^\/api\/sessions\/([^/]+)\/jobs$/;
const JOB_CANCEL_PATH = /^\/api\/sessions\/([^/]+)\/jobs\/([^/]+)\/cancel$/;
const GREP_PATH = /^\/api\/sessions\/([^/]+)\/grep$/;
const GLOB_PATH = /^\/api\/sessions\/([^/]+)\/glob$/;
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
const HUB_TRANSCRIPT_PATH = /^\/api\/hub\/agents\/([^/]+)\/transcript$/;
const HUB_INBOX_PATH = /^\/api\/hub\/agents\/([^/]+)\/inbox$/;
const HUB_WAIT_PATH = /^\/api\/hub\/agents\/([^/]+)\/wait$/;
const HUB_MESSAGES_PATH = /^\/api\/hub\/messages$/;
const HUB_JOBS_PATH = /^\/api\/hub\/jobs$/;
const HUB_JOBS_CANCEL_PATH = /^\/api\/hub\/jobs\/cancel$/;
const HUB_SPAWN_PATH = /^\/api\/hub\/spawn$/;
const SETTINGS_PATH = /^\/api\/settings$/;
const SETTING_PATH = /^\/api\/settings\/([^/]+)$/;
const THEMES_PATH = /^\/api\/themes$/;
const THEMES_APPLY_PATH = /^\/api\/themes\/apply$/;
const MODELS_PATH = /^\/api\/models$/;
const MODEL_ROLES_PATH = /^\/api\/model-roles$/;
const MODEL_ROLE_PATH = /^\/api\/model-roles\/([^/]+)$/;
const PROVIDERS_PATH = /^\/api\/providers$/;
const MCP_PATH = /^\/api\/mcp$/;
const MCP_TOOLS_PATH = /^\/api\/mcp\/tools$/;
const MCP_ACTION_PATH = /^\/api\/mcp\/([^/]+)\/(test|reconnect|reload)$/;
const SESSION_SKILLS_PATH = /^\/api\/sessions\/([^/]+)\/skills$/;
const SESSION_SKILL_PATH = /^\/api\/sessions\/([^/]+)\/skills\/([^/]+)$/;
const SESSION_MEMORY_PATH = /^\/api\/sessions\/([^/]+)\/memory$/;
const SESSION_MEMORY_BACKEND_PATH = /^\/api\/sessions\/([^/]+)\/memory\/backend$/;
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
  const webDist = globals.process?.env?.AI_GUI_WEB_DIST;
  const authToken = globals.process?.env?.AI_GUI_TOKEN;
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
  // Extra workspace roots widen the tool jail (`/add-dir`). A session that
  // cannot be attached keeps the cwd-only jail rather than failing the route.
  const toolRoots = async (sessionId: string): Promise<readonly string[]> => {
    try {
      return (await runtime.getWorkspace(sessionId)).directories;
    } catch {
      return [];
    }
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
    hostname: '127.0.0.1',
    fetch: async (req: Request, server: unknown) => {
      const url = new URL(req.url);
      const { pathname } = url;
      const upgrade = (server as { upgrade?: (req: Request, options?: object) => boolean } | null)
        ?.upgrade;
      const streamMatch = STREAM_PATH.exec(pathname);
      if (streamMatch && upgrade) {
        const sessionId = decodeURIComponent(streamMatch[1] ?? '');
        if (!isAuthorized(req, authToken)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
        const upgraded = (
          server as { upgrade: (req: Request, options?: object) => boolean }
        ).upgrade(req, { data: { sessionId } });
        if (upgraded) return undefined;
        return Response.json({ error: 'websocket upgrade failed' }, { status: 500 });
      }
      try {
        if (authToken && isApiPath(pathname) && !isAuthorized(req, authToken)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
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
        const approvalMatch = APPROVAL_PATH.exec(pathname);
        if (req.method === 'POST' && approvalMatch) {
          const sessionId = decodeURIComponent(approvalMatch[1] ?? '');
          const approvalId = decodeURIComponent(approvalMatch[2] ?? '');
          return Response.json(
            await approvalRoute(runtime, sessionId, approvalId, await readJson(req)),
          );
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
        const conflictsMatch = CONFLICTS_PATH.exec(pathname);
        if (req.method === 'GET' && conflictsMatch) {
          const sessionId = decodeURIComponent(conflictsMatch[1] ?? '');
          return Response.json(await conflictsRoute(runtime, sessionId));
        }
        const resolveConflictsMatch = CONFLICTS_RESOLVE_PATH.exec(pathname);
        if (req.method === 'POST' && resolveConflictsMatch) {
          const sessionId = decodeURIComponent(resolveConflictsMatch[1] ?? '');
          return Response.json(
            await resolveConflictsRoute(runtime, sessionId, await readJson(req)),
          );
        }
        const statsMatch = STATS_PATH.exec(pathname);
        if (req.method === 'GET' && statsMatch) {
          const sessionId = decodeURIComponent(statsMatch[1] ?? '');
          return Response.json(await getStatsRoute(runtime, sessionId));
        }
        const guidedGoalMatch = GUIDED_GOAL_PATH.exec(pathname);
        if (req.method === 'POST' && guidedGoalMatch) {
          const sessionId = decodeURIComponent(guidedGoalMatch[1] ?? '');
          return Response.json(await guidedGoalRoute(runtime, sessionId, await readJson(req)));
        }
        const securityScanMatch = SECURITY_SCAN_PATH.exec(pathname);
        if (req.method === 'POST' && securityScanMatch) {
          const sessionId = decodeURIComponent(securityScanMatch[1] ?? '');
          return Response.json(await securityScanRoute(tools, sessionId, await readJson(req)));
        }
        const sessionToolsMatch = SESSION_TOOLS_PATH.exec(pathname);
        if (req.method === 'GET' && sessionToolsMatch) {
          const sessionId = decodeURIComponent(sessionToolsMatch[1] ?? '');
          return Response.json(await sessionToolsRoute(runtime, sessionId));
        }
        const loopMatch = LOOP_PATH.exec(pathname);
        if (loopMatch) {
          const sessionId = decodeURIComponent(loopMatch[1] ?? '');
          if (req.method === 'GET') return Response.json(await getLoopRoute(runtime, sessionId));
          if (req.method === 'POST') {
            return Response.json(await startLoopRoute(runtime, sessionId, await readJson(req)));
          }
          if (req.method === 'DELETE')
            return Response.json(await stopLoopRoute(runtime, sessionId));
        }
        const loopPauseMatch = LOOP_PAUSE_PATH.exec(pathname);
        if (req.method === 'POST' && loopPauseMatch) {
          const sessionId = decodeURIComponent(loopPauseMatch[1] ?? '');
          return Response.json(await pauseLoopRoute(runtime, sessionId, await readJson(req)));
        }
        const planDecisionMatch = PLAN_DECISION_PATH.exec(pathname);
        if (req.method === 'GET' && planDecisionMatch) {
          const sessionId = decodeURIComponent(planDecisionMatch[1] ?? '');
          return Response.json(await planDraftRoute(runtime, sessionId));
        }
        if (req.method === 'POST' && planDecisionMatch) {
          const sessionId = decodeURIComponent(planDecisionMatch[1] ?? '');
          return Response.json(await planDecisionRoute(runtime, sessionId, await readJson(req)));
        }
        const workspaceMatch = WORKSPACE_PATH.exec(pathname);
        if (req.method === 'GET' && workspaceMatch) {
          const sessionId = decodeURIComponent(workspaceMatch[1] ?? '');
          return Response.json(await workspaceRoute(runtime, sessionId));
        }
        const workspaceDirsMatch = WORKSPACE_DIRS_PATH.exec(pathname);
        if (req.method === 'POST' && workspaceDirsMatch) {
          const sessionId = decodeURIComponent(workspaceDirsMatch[1] ?? '');
          return Response.json(await addWorkspaceDirRoute(runtime, sessionId, await readJson(req)));
        }
        if (req.method === 'DELETE' && workspaceDirsMatch) {
          const sessionId = decodeURIComponent(workspaceDirsMatch[1] ?? '');
          return Response.json(await removeWorkspaceDirRoute(runtime, sessionId, queryRecord(url)));
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
          const userThemes = url.searchParams.get('theme') === 'user';
          return Response.json(await exportRoute(runtime, sessionId, userThemes));
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
        const moveMatch = MOVE_PATH.exec(pathname);
        if (req.method === 'POST' && moveMatch) {
          const sessionId = decodeURIComponent(moveMatch[1] ?? '');
          const body = await readJson(req);
          const res = await moveSessionRoute(runtime, sessionId, body);
          const cwd =
            body && typeof body === 'object' && 'cwd' in body && typeof body.cwd === 'string'
              ? body.cwd
              : undefined;
          if (cwd) {
            sessionCwds.set(sessionId, cwd);
            setSessionCwd(sessionId, cwd);
          }
          return Response.json(res);
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
        const jobsMatch = JOBS_PATH.exec(pathname);
        if (req.method === 'GET' && jobsMatch) {
          const sessionId = decodeURIComponent(jobsMatch[1] ?? '');
          return Response.json(await listJobsRoute(tools, sessionId));
        }
        const jobCancelMatch = JOB_CANCEL_PATH.exec(pathname);
        if (req.method === 'POST' && jobCancelMatch) {
          const sessionId = decodeURIComponent(jobCancelMatch[1] ?? '');
          return Response.json(await cancelJobRoute(tools, sessionId, jobCancelMatch[2] ?? ''));
        }
        const grepMatch = GREP_PATH.exec(pathname);
        if (req.method === 'GET' && grepMatch) {
          const sessionId = decodeURIComponent(grepMatch[1] ?? '');
          return Response.json(await grepRoute(tools, sessionId, queryRecord(url)));
        }
        const globMatch = GLOB_PATH.exec(pathname);
        if (req.method === 'GET' && globMatch) {
          const sessionId = decodeURIComponent(globMatch[1] ?? '');
          return Response.json(await globRoute(tools, sessionId, queryRecord(url)));
        }
        const filesListMatch = FILES_LIST_PATH.exec(pathname);
        if (req.method === 'GET' && filesListMatch) {
          const sessionId = decodeURIComponent(filesListMatch[1] ?? '');
          return Response.json(
            await listDirRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              queryRecord(url),
            ),
          );
        }
        const filesMatch = FILES_PATH.exec(pathname);
        if (req.method === 'GET' && filesMatch) {
          const sessionId = decodeURIComponent(filesMatch[1] ?? '');
          return Response.json(
            await readFileRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              queryRecord(url),
            ),
          );
        }
        if (req.method === 'POST' && filesMatch) {
          const sessionId = decodeURIComponent(filesMatch[1] ?? '');
          return Response.json(
            await writeFileRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              await readJson(req),
            ),
          );
        }
        const editMatch = EDIT_PATH.exec(pathname);
        if (req.method === 'POST' && editMatch) {
          const sessionId = decodeURIComponent(editMatch[1] ?? '');
          return Response.json(
            await editFileRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              await readJson(req),
            ),
          );
        }
        const bashMatch = BASH_PATH.exec(pathname);
        if (req.method === 'POST' && bashMatch) {
          const sessionId = decodeURIComponent(bashMatch[1] ?? '');
          return Response.json(
            await bashRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              await readJson(req),
            ),
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
            await lspRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              await readJson(req),
            ),
          );
        }
        const debugMatch = DEBUG_PATH.exec(pathname);
        if (req.method === 'POST' && debugMatch) {
          const sessionId = decodeURIComponent(debugMatch[1] ?? '');
          return Response.json(
            await debugRoute(
              tools,
              sessionId,
              await toolCwd(sessionId),
              await toolRoots(sessionId),
              await readJson(req),
            ),
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
        const hubTranscriptMatch = HUB_TRANSCRIPT_PATH.exec(pathname);
        if (req.method === 'GET' && hubTranscriptMatch) {
          const id = decodeURIComponent(hubTranscriptMatch[1] ?? '');
          const limitRaw = url.searchParams.get('limit');
          const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
          return Response.json(
            await hubTranscriptRoute(hub, id, Number.isFinite(limit) ? limit : undefined),
          );
        }
        const hubInboxMatch = HUB_INBOX_PATH.exec(pathname);
        if (req.method === 'GET' && hubInboxMatch) {
          const id = decodeURIComponent(hubInboxMatch[1] ?? '');
          const peek = url.searchParams.get('peek') === 'true';
          return Response.json(await hubInboxRoute(hub, id, peek));
        }
        const hubWaitMatch = HUB_WAIT_PATH.exec(pathname);
        if (req.method === 'POST' && hubWaitMatch) {
          const id = decodeURIComponent(hubWaitMatch[1] ?? '');
          return Response.json(await hubWaitRoute(hub, id, await readJson(req)));
        }
        if (req.method === 'POST' && HUB_MESSAGES_PATH.exec(pathname)) {
          return Response.json(await hubSendRoute(hub, await readJson(req)));
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

        if (req.method === 'GET' && MODEL_ROLES_PATH.exec(pathname)) {
          return Response.json(await listModelRolesRoute());
        }
        const modelRoleMatch = MODEL_ROLE_PATH.exec(pathname);
        if (req.method === 'PUT' && modelRoleMatch) {
          return Response.json(
            await setModelRoleRoute(modelRoleMatch[1] ?? '', await readJson(req)),
          );
        }
        if (req.method === 'GET' && PROVIDERS_PATH.exec(pathname)) {
          return Response.json(await listProvidersRoute());
        }
        if (req.method === 'GET' && MCP_PATH.exec(pathname)) {
          return Response.json(await listMcpRoute());
        }

        if (req.method === 'GET' && MCP_TOOLS_PATH.exec(pathname)) {
          const server = url.searchParams.get('server') ?? undefined;
          const discover = url.searchParams.get('discover') ?? undefined;
          return Response.json(
            await listMcpToolsRoute({
              ...(server ? { server } : {}),
              ...(discover ? { discover } : {}),
            }),
          );
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
        const sessionSkillsMatch = SESSION_SKILLS_PATH.exec(pathname);
        if (req.method === 'GET' && sessionSkillsMatch) {
          const sessionId = decodeURIComponent(sessionSkillsMatch[1] ?? '');
          return Response.json(await sessionSkillsRoute(runtime, sessionId));
        }
        const sessionSkillMatch = SESSION_SKILL_PATH.exec(pathname);
        if (req.method === 'GET' && sessionSkillMatch) {
          const sessionId = decodeURIComponent(sessionSkillMatch[1] ?? '');
          return Response.json(
            await sessionSkillContentRoute(
              runtime,
              sessionId,
              sessionSkillMatch[2] ?? '',
              queryRecord(url),
            ),
          );
        }
        const sessionMemoryMatch = SESSION_MEMORY_PATH.exec(pathname);
        if (sessionMemoryMatch) {
          const sessionId = decodeURIComponent(sessionMemoryMatch[1] ?? '');
          if (req.method === 'GET') {
            return Response.json(await getMemoryRoute(runtime, sessionId));
          }
          if (req.method === 'POST') {
            return Response.json(await memoryOpRoute(runtime, sessionId, await readJson(req)));
          }
        }
        const sessionMemoryBackendMatch = SESSION_MEMORY_BACKEND_PATH.exec(pathname);
        if (req.method === 'POST' && sessionMemoryBackendMatch) {
          const sessionId = decodeURIComponent(sessionMemoryBackendMatch[1] ?? '');
          return Response.json(
            await setMemoryBackendRoute(runtime, sessionId, await readJson(req)),
          );
        }
        if (req.method === 'GET' && COMMANDS_PATH.exec(pathname)) {
          return Response.json(await listCommandsRoute(queryRecord(url)));
        }
        if (webDist && !isApiPath(pathname)) {
          const target = classifyStaticPath(webDist, pathname);
          if (target.kind === 'blocked') {
            return new Response('not found', { status: 404 });
          }
          if (target.kind === 'spa') {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            try {
              const html = await readFile(join(webDist, 'index.html'));
              const headers: Record<string, string> = {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-cache',
                'content-security-policy': STATIC_CSP,
              };
              if (authToken) headers['set-cookie'] = tokenCookieHeader(authToken);
              return new Response(html, { headers });
            } catch {
              return new Response('web dist missing index.html', { status: 500 });
            }
          }
          const { readFile } = await import('node:fs/promises');
          try {
            const body = await readFile(target.filePath);
            return new Response(body, {
              headers: {
                'content-type': contentTypeFor(target.filePath),
                'cache-control': isImmutableAsset(target.filePath)
                  ? 'public, max-age=31536000, immutable'
                  : 'no-cache',
                'content-security-policy': STATIC_CSP,
              },
            });
          } catch {
            return new Response('not found', { status: 404 });
          }
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
