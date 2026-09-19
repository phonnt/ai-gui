import type { SessionInfo } from '@ai-gui/core';
import type {
  BranchResponseDto,
  ConflictEntryDto,
  CreateSessionDto,
  DumpResponseDto,
  ExportResponseDto,
  GoalActionDto,
  GoalStateDto,
  JobCancelResponseDto,
  LoopStateDto,
  McpToolEntryDto,
  MemoryBackendDto,
  MemoryOpDto,
  MemoryOpResultDto,
  MemoryStateDto,
  ModeActionDto,
  ModelRoleEntryDto,
  PromptDto,
  ResolveConflictsDto,
  SessionModesDto,
  SessionStatsDto,
  ShareResponseDto,
  TreeResponseDto,
} from '@ai-gui/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DebugInput,
  HubAgent,
  HubJob,
  HubReviveResult,
  LspInput,
  McpActionResult,
  P2aArtifactContent,
  P2aArtifactRef,
  P2aBashResult,
  P2aCellLanguage,
  P2aCellResult,
  P2aDirEntry,
  P2aEditResult,
  P2aFileContent,
  P2aTodoPhase,
  P2aWriteResult,
  P2bDebugStackFrame,
  P2bDebugThread,
  P2bLspDiagnostic,
  P2bLspLocation,
  P2bLspStatus,
  P2bLspSymbol,
  RunBashOptions,
  RunCellOptions,
  SettingResetResult,
  SettingValue,
  SpawnInput,
} from './rest';

export type { P2aTruncation } from './rest';

import {
  abortSession,
  addWorkspaceDir,
  applyTheme,
  applyTodoOp,
  branchSession,
  browseDir,
  cancelHubJobs,
  cancelJob,
  clearSession,
  compactSession,
  createSession,
  debugDebug,
  decideApproval,
  decidePlan,
  dropSession,
  dumpSession,
  editFile,
  exportHtml,
  forkSession,
  freshSession,
  getGoal,
  getHubInbox,
  getHubTranscript,
  getLoop,
  getMemory,
  getMessages,
  getModes,
  getSessionModels,
  getSessionStats,
  getSetting,
  getTodos,
  getTree,
  getWorkspace,
  globFiles,
  goalAction,
  killHubAgent,
  labelTreeEntry,
  listArtifacts,
  listCommands,
  listConflicts,
  listDir,
  listHubAgents,
  listHubJobs,
  listJobs,
  listMcpServers,
  listMcpTools,
  listModelRoles,
  listModels,
  listProviders,
  listSessionSkills,
  listSessions,
  listSettings,
  listThemes,
  lsp,
  modeAction,
  moveSession,
  navigateTree,
  pauseLoop,
  promptSession,
  putSetting,
  readArtifact,
  readFile,
  readSessionSkill,
  reconnectMcpServer,
  reloadMcpServer,
  removeWorkspaceDir,
  renameSession,
  resetKernel,
  resetSetting,
  resolveConflicts,
  retryTurn,
  reviveHubAgent,
  runBash,
  runCell,
  runMemoryOp,
  sendHubMessage,
  setMemoryBackend,
  setModelRole,
  setSessionModel,
  setSessionThinking,
  shareSession,
  spawnHubAgent,
  startLoop,
  steerHubAgent,
  stopLoop,
  testMcpServer,
  writeFile,
} from './rest';

async function unwrap<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>,
): Promise<T> {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => unwrap(listSessions()),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionDto) => unwrap(createSession(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useMessages(sessionId: string | undefined, limit = 50) {
  return useInfiniteQuery({
    queryKey: ['messages', sessionId],
    enabled: Boolean(sessionId),
    // Transient 409s while a turn streams are absorbed by short retries;
    // cached pages stay rendered meanwhile (see ChatPage error gating).
    retry: 3,
    retryDelay: 1000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(getMessages(sessionId as string, { cursor: pageParam, limit })),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function usePrompt(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PromptDto) => unwrap(promptSession(sessionId, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useAbort(sessionId: string) {
  return useMutation({
    mutationFn: () => unwrap(abortSession(sessionId)),
  });
}

/** Answer one approval prompt (Approve/Deny) for the current turn. */
export function useDecideApproval(sessionId: string) {
  return useMutation({
    mutationFn: ({ approvalId, approved }: { approvalId: string; approved: boolean }) =>
      unwrap(decideApproval(sessionId, approvalId, approved)),
  });
}

function invalidateSession(qc: QueryClient, sessionId: string) {
  void qc.invalidateQueries({ queryKey: ['sessions'] });
  void qc.invalidateQueries({ queryKey: ['messages', sessionId] });
  void qc.invalidateQueries({ queryKey: ['tree', sessionId] });
}

export function useSessionTree(sessionId: string | undefined) {
  return useQuery<TreeResponseDto>({
    queryKey: ['tree', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getTree(sessionId as string)),
  });
}

export function useForkSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<SessionInfo, Error, void>({
    mutationFn: () => unwrap(forkSession(sessionId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useClearSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(clearSession(sessionId)),
    onSuccess: () => invalidateSession(qc, sessionId),
  });
}

export function useFreshSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(freshSession(sessionId)),
    onSuccess: () => invalidateSession(qc, sessionId),
  });
}

export function useCompactSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instructions?: string) => unwrap(compactSession(sessionId, instructions)),
    onSuccess: () => invalidateSession(qc, sessionId),
  });
}

export function useRetryTurn(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(retryTurn(sessionId)),
    onSuccess: () => invalidateSession(qc, sessionId),
  });
}

export function useDropSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => unwrap(dropSession(sessionId)),
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['messages', sessionId] });
      void qc.invalidateQueries({ queryKey: ['tree', sessionId] });
    },
  });
}

export function useNavigateTree(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leafId: string) => unwrap(navigateTree({ leafId, sessionId })),
    onSuccess: () => invalidateSession(qc, sessionId),
  });
}

export function useBranchSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<BranchResponseDto, Error, string | undefined>({
    mutationFn: (parentId) => unwrap(branchSession({ parentId, sessionId })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['tree', sessionId] });
    },
  });
}

export function useLabelTreeEntry(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, label }: { entryId: string; label: string }) =>
      unwrap(labelTreeEntry(sessionId, entryId, label)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tree', sessionId] });
    },
  });
}

export function useExportHtml(sessionId: string) {
  return useMutation<ExportResponseDto, Error, boolean | undefined>({
    mutationFn: (userThemes) => unwrap(exportHtml(sessionId, userThemes)),
  });
}

export function useDumpSession(sessionId: string) {
  return useMutation<DumpResponseDto, Error, void>({
    mutationFn: () => unwrap(dumpSession(sessionId)),
  });
}

export function useShareSession(sessionId: string) {
  return useMutation<ShareResponseDto, Error, void>({
    mutationFn: () => unwrap(shareSession(sessionId)),
  });
}

export function useRenameSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<SessionInfo, Error, string>({
    mutationFn: (title) => unwrap(renameSession({ sessionId, title })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
export function useMoveSession(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cwd: string) => unwrap(moveSession(sessionId, cwd)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useGoal(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['goal', sessionId ?? ''],
    queryFn: () => unwrap(getGoal(sessionId as string)),
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}

export function useGoalAction(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<GoalStateDto, Error, GoalActionDto>({
    mutationFn: (action) => unwrap(goalAction(sessionId, action)),
    onSuccess: (goal) => {
      qc.setQueryData(['goal', sessionId], goal);
    },
  });
}

export function useModes(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['modes', sessionId ?? ''],
    queryFn: () => unwrap(getModes(sessionId as string)),
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}

export function useSetMode(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<SessionModesDto, Error, ModeActionDto>({
    mutationFn: (action) => unwrap(modeAction(sessionId, action)),
    onSuccess: (modes) => {
      qc.setQueryData(['modes', sessionId], modes);
    },
  });
}

// ---------------------------------------------------------------------------
// P2a session tools.
// ---------------------------------------------------------------------------

function toolsKey(sessionId: string, scope: string, extra?: unknown[]): (string | unknown)[] {
  return extra === undefined
    ? ['session-tools', scope, sessionId]
    : ['session-tools', scope, sessionId, ...extra];
}

export function useFileContent(sessionId: string, path: string, range?: string) {
  return useQuery({
    queryKey: toolsKey(sessionId, 'file', [path, range ?? '']),
    queryFn: () => unwrap(readFile(sessionId, path, range)),
    enabled: path.trim().length > 0,
  });
}

export function useDirEntries(sessionId: string, path: string) {
  return useQuery({
    queryKey: toolsKey(sessionId, 'dir', [path]),
    queryFn: () => unwrap(listDir(sessionId, path)),
  });
}

export function useBrowseDir(path: string | undefined) {
  return useQuery({
    queryKey: ['fs-browse', path ?? ''],
    queryFn: () => unwrap(browseDir(path)),
  });
}

export function useWriteFile(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<P2aWriteResult, Error, { path: string; content: string }>({
    mutationFn: (input) => unwrap(writeFile(sessionId, input.path, input.content)),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: toolsKey(sessionId, 'file', [input.path, '']) });
      void qc.invalidateQueries({ queryKey: toolsKey(sessionId, 'dir') });
    },
  });
}

export function useEditFile(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<P2aEditResult, Error, { path: string; tag: string; input: string }>({
    mutationFn: (vars) => unwrap(editFile(sessionId, vars.path, vars.tag, vars.input)),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: toolsKey(sessionId, 'file', [vars.path, '']) });
      void qc.invalidateQueries({ queryKey: toolsKey(sessionId, 'dir') });
    },
  });
}

export function useRunBash(sessionId: string) {
  return useMutation<P2aBashResult, Error, { command: string } & RunBashOptions>({
    mutationFn: (vars) => {
      const { command, ...options } = vars;
      return unwrap(runBash(sessionId, command, options));
    },
  });
}

export function useRunCell(sessionId: string) {
  return useMutation<
    P2aCellResult,
    Error,
    { language: P2aCellLanguage; code: string } & RunCellOptions
  >({
    mutationFn: (vars) => {
      const { language, code, ...options } = vars;
      return unwrap(runCell(sessionId, language, code, options));
    },
  });
}

export function useResetKernel(sessionId: string) {
  return useMutation<{ ok: boolean }, Error, P2aCellLanguage>({
    mutationFn: (language) => unwrap(resetKernel(sessionId, language)),
  });
}

export function useTodos(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId ? toolsKey(sessionId, 'todos') : ['session-tools', 'todos', 'none'],
    queryFn: () => unwrap(getTodos(sessionId ?? '')),
    enabled: !!sessionId,
  });
}

export function useApplyTodoOp(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<P2aTodoPhase[], Error, { op: string; payload?: unknown }>({
    mutationFn: (vars) => unwrap(applyTodoOp(sessionId, vars.op, vars.payload)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: toolsKey(sessionId, 'todos') });
    },
  });
}

export function useArtifacts(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId ? toolsKey(sessionId, 'artifacts') : ['session-tools', 'artifacts', 'none'],
    queryFn: () => unwrap(listArtifacts(sessionId ?? '')),
    enabled: !!sessionId,
  });
}

export function useArtifactContent(sessionId: string, id: string, range?: string) {
  return useQuery({
    queryKey: toolsKey(sessionId, 'artifact', [id, range ?? '']),
    queryFn: () => unwrap(readArtifact(sessionId, id, range)),
    enabled: id.trim().length > 0,
  });
}

// ---------------------------------------------------------------------------
// P2b LSP + debug (single-dispatch POST routes).
// ---------------------------------------------------------------------------

export function useLsp(sessionId: string) {
  return useMutation<unknown, Error, LspInput>({
    mutationFn: (input) => unwrap(lsp(sessionId, input)),
  });
}

export function useDebug(sessionId: string) {
  return useMutation<unknown, Error, DebugInput>({
    mutationFn: (input) => unwrap(debugDebug(sessionId, input)),
  });
}

export type {
  HubAgent,
  HubJob,
  HubReviveResult,
  P2aArtifactContent,
  P2aArtifactRef,
  P2aBashResult,
  P2aCellLanguage,
  P2aCellResult,
  P2aDirEntry,
  P2aEditResult,
  P2aFileContent,
  P2aTodoPhase,
  P2aWriteResult,
  P2bDebugStackFrame,
  P2bDebugThread,
  P2bLspDiagnostic,
  P2bLspLocation,
  P2bLspStatus,
  P2bLspSymbol,
  SpawnInput,
};

// ---------------------------------------------------------------------------
// P3 Agent Hub: roster / steer / revive / kill + jobs + spawn.
// ---------------------------------------------------------------------------

function invalidateHubAgents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['hub', 'agents'] });
}

/** Roster of manageable agents. Polls by default; pass 0/false to disable. */
export function useHubAgents(refetchInterval: number | false = 5000) {
  return useQuery({
    queryKey: ['hub', 'agents'],
    queryFn: () => unwrap(listHubAgents()),
    refetchInterval,
  });
}

/** Steer uses the same prompt path as a session prompt. */
export function useSteerHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { id: string; text: string }>({
    mutationFn: (vars) => unwrap(steerHubAgent(vars.id, vars.text)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

export function useReviveHubAgent() {
  const qc = useQueryClient();
  return useMutation<HubReviveResult, Error, string>({
    mutationFn: (id) => unwrap(reviveHubAgent(id)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

export function useKillHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ killed: boolean }, Error, string>({
    mutationFn: (id) => unwrap(killHubAgent(id)),
    onSuccess: () => invalidateHubAgents(qc),
  });
}

/** Async jobs. Auto-refreshes every 5s by default. */
/** Read-only transcript rows for one agent (loaded on demand). */
export function useHubTranscript(id: string | undefined) {
  return useQuery({
    queryKey: ['hub', 'transcript', id],
    enabled: Boolean(id),
    queryFn: () => unwrap(getHubTranscript(id as string)),
  });
}

/** Mailbox of one agent; poll only while the panel is open. */
export function useHubInbox(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hub', 'inbox', id],
    enabled: Boolean(id) && enabled,
    queryFn: () => unwrap(getHubInbox(id as string, true)),
  });
}

export function useSendHubMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string; text: string }) =>
      unwrap(sendHubMessage(input)),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['hub', 'inbox', variables.to] });
      void qc.invalidateQueries({ queryKey: ['hub', 'agents'] });
    },
  });
}

export function useHubJobs(refetchInterval: number | false = 5000) {
  return useQuery({
    queryKey: ['hub', 'jobs'],
    queryFn: () => unwrap(listHubJobs()),
    refetchInterval,
  });
}

export function useCancelHubJobs() {
  const qc = useQueryClient();
  return useMutation<{ cancelled: string[] }, Error, { ids?: string[] }>({
    mutationFn: (vars) => unwrap(cancelHubJobs(vars.ids)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hub', 'jobs'] });
    },
  });
}

export function useSpawnHubAgent() {
  const qc = useQueryClient();
  return useMutation<{ agentId: string }, Error, SpawnInput>({
    mutationFn: (input) => unwrap(spawnHubAgent(input)),
    onSuccess: () => {
      invalidateHubAgents(qc);
      void qc.invalidateQueries({ queryKey: ['hub', 'jobs'] });
    },
  });
}
// ---------------------------------------------------------------------------
// P4 Settings plane: settings / themes / models / providers / mcp / skills /
// memory. Mirrors the contract paths in ./rest (local runtime guards until
// @ai-gui/protocol gains P4 schemas — read-only here, do not edit protocol).
// ---------------------------------------------------------------------------

export type {
  McpActionResult,
  McpServerInfo,
  MemoryState,
  ModelInfo,
  ProviderAuth,
  ProviderInfo,
  SettingResetResult,
  SettingsEntry,
  SettingValue,
  SkillContent,
  ThemeInfo,
  ThemesState,
} from './rest';

export function useSettings() {
  return useQuery({
    queryKey: ['settings', 'entries'],
    queryFn: () => unwrap(listSettings()),
  });
}

export function useSetting(key: string | undefined) {
  return useQuery({
    queryKey: ['settings', 'entry', key],
    queryFn: () => unwrap(getSetting(key as string)),
    enabled: typeof key === 'string' && key.length > 0,
  });
}

export function usePutSetting() {
  const qc = useQueryClient();
  return useMutation<SettingValue, Error, { key: string; value: unknown }>({
    mutationFn: (vars) => unwrap(putSetting(vars.key, vars.value)),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings', 'entries'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'entry', data.key] });
    },
  });
}

export function useResetSetting() {
  const qc = useQueryClient();
  return useMutation<SettingResetResult, Error, string>({
    mutationFn: (key) => unwrap(resetSetting(key)),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['settings', 'entries'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'entry', data.key] });
    },
  });
}

export function useThemes() {
  return useQuery({
    queryKey: ['settings', 'themes'],
    queryFn: () => unwrap(listThemes()),
  });
}

export function useApplyTheme() {
  const qc = useQueryClient();
  return useMutation<{ current: string }, Error, { name: string; slot: 'dark' | 'light' }>({
    mutationFn: ({ name, slot }) => unwrap(applyTheme(name, slot)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'themes'] });
      void qc.invalidateQueries({ queryKey: ['themes'] });
    },
  });
}

/** Model roles (`@role` routing) with their current assignments. */
export function useModelRoles() {
  return useQuery<ModelRoleEntryDto[]>({
    queryKey: ['model-roles'],
    queryFn: () => unwrap(listModelRoles()),
  });
}

export function useSetModelRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ role, model }: { role: string; model: string }) =>
      unwrap(setModelRole(role, model)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['model-roles'] });
    },
  });
}

export function useModels() {
  return useQuery({
    queryKey: ['settings', 'models'],
    queryFn: () => unwrap(listModels()),
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ['settings', 'providers'],
    queryFn: () => unwrap(listProviders()),
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: ['settings', 'mcp'],
    queryFn: () => unwrap(listMcpServers()),
  });
}

function useMcpAction(action: 'test' | 'reconnect' | 'reload') {
  const qc = useQueryClient();
  return useMutation<McpActionResult, Error, string>({
    mutationFn: (name) =>
      unwrap(
        action === 'test'
          ? testMcpServer(name)
          : action === 'reconnect'
            ? reconnectMcpServer(name)
            : reloadMcpServer(name),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'mcp'] });
    },
  });
}

export function useTestMcpServer() {
  return useMcpAction('test');
}

export function useReconnectMcpServer() {
  return useMcpAction('reconnect');
}

export function useReloadMcpServer() {
  return useMcpAction('reload');
}

/**
 * Answer a plan proposal. `execute` exits plan mode and dispatches the
 * execution turn; `keep` exits without running the plan.
 */
export function useDecidePlan(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'execute' | 'keep') => unwrap(decidePlan(sessionId, action)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['modes', sessionId] });
      void qc.invalidateQueries({ queryKey: ['messages', sessionId] });
    },
  });
}

/** Workspace roots of the live session: the primary cwd plus `/add-dir` roots. */
export function useWorkspace(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'workspace'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getWorkspace(sessionId as string)),
  });
}

export function useAddWorkspaceDir(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => unwrap(addWorkspaceDir(sessionId, path)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'workspace'] });
    },
  });
}

export function useRemoveWorkspaceDir(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => unwrap(removeWorkspaceDir(sessionId, path)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'workspace'] });
    },
  });
}

/** Skills of the live session (the inventory the agent can actually invoke). */
export function useSessionSkills(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'skills'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(listSessionSkills(sessionId as string)),
  });
}

export function useSessionSkillContent(sessionId: string, name: string | undefined, path?: string) {
  return useQuery({
    queryKey: ['session', sessionId, 'skill', name, path],
    queryFn: () => unwrap(readSessionSkill(sessionId, name as string, path)),
    enabled: typeof name === 'string' && name.length > 0,
  });
}

/** Tools exposed by connected MCP servers (optionally filtered by server). */
export function useMcpTools(server?: string) {
  return useQuery<McpToolEntryDto[]>({
    queryKey: ['mcp', 'tools', server ?? '*'],
    queryFn: () => unwrap(listMcpTools(server)),
  });
}

export function useDiscoverMcpTools() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (server?: string) => unwrap(listMcpTools(server, true)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mcp'] });
    },
  });
}

/**
 * Background jobs of the session. Polls fast while something runs, then backs
 * off, so a long build's tail stays live without hammering the server.
 */
export function useJobs(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'jobs'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(listJobs(sessionId as string)),
    refetchInterval: (query) =>
      (query.state.data?.jobs ?? []).some((job) => job.status === 'running') ? 1500 : 10_000,
  });
}

export function useCancelJob(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<JobCancelResponseDto, Error, string>({
    mutationFn: (id) => unwrap(cancelJob(sessionId, id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'jobs'] });
    },
  });
}

/** Workspace file paths for a glob pattern (composer mentions, explorer). */
export function useGlobFiles(sessionId: string, pattern: string | null) {
  return useQuery({
    queryKey: ['session', sessionId, 'glob', pattern ?? ''],
    enabled: pattern !== null && pattern !== '',
    queryFn: () => unwrap(globFiles(sessionId, pattern as string, 40)),
    staleTime: 15_000,
  });
}

/** Loop mode state (TUI `/loop`): prompt, limit, pause. */
export function useLoop(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['loop', sessionId ?? ''],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getLoop(sessionId as string)),
    staleTime: 5_000,
  });
}

export function useStartLoop(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<LoopStateDto, Error, { prompt: string; limit?: string }>({
    mutationFn: ({ prompt, limit }) => unwrap(startLoop(sessionId, prompt, limit)),
    onSuccess: (state) => {
      qc.setQueryData(['loop', sessionId], state);
    },
  });
}

export function useStopLoop(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<LoopStateDto, Error, void>({
    mutationFn: () => unwrap(stopLoop(sessionId)),
    onSuccess: (state) => {
      qc.setQueryData(['loop', sessionId], state);
    },
  });
}

export function usePauseLoop(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<LoopStateDto, Error, boolean>({
    mutationFn: (paused) => unwrap(pauseLoop(sessionId, paused)),
    onSuccess: (state) => {
      qc.setQueryData(['loop', sessionId], state);
    },
  });
}

/** Session-scoped memory state: backend id + live status payload. */
export function useMemory(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'memory'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getMemory(sessionId as string)),
  });
}

/** `/memory <op>` — status/view/stats/diagnose/queue/clear/enqueue/search. */
export function useMemoryOp(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<
    MemoryOpResultDto,
    Error,
    { op: MemoryOpDto['op']; query?: string; limit?: number }
  >({
    mutationFn: (input) => unwrap(runMemoryOp(sessionId, input.op, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'memory'] });
    },
  });
}

/** Switch the live session's backend and re-initialise it in place. */
export function useSetMemoryBackend(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<MemoryStateDto, Error, MemoryBackendDto['backend']>({
    mutationFn: (backend) => unwrap(setMemoryBackend(sessionId, backend)),
    onSuccess: (state) => {
      qc.setQueryData(['session', sessionId, 'memory'], state);
    },
  });
}

export function useCommands(cwd?: string) {
  return useQuery({
    queryKey: ['settings', 'commands', cwd ?? ''],
    queryFn: () => unwrap(listCommands(cwd)),
    staleTime: 60_000,
  });
}

/** Conflict regions the read tool registered; refetched after each resolve. */
export function useConflicts(sessionId: string | undefined) {
  return useQuery<ConflictEntryDto[]>({
    queryKey: ['conflicts', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(listConflicts(sessionId as string)),
  });
}

export function useResolveConflicts(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ResolveConflictsDto) => unwrap(resolveConflicts(sessionId, input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conflicts', sessionId] });
      void qc.invalidateQueries({ queryKey: ['file', sessionId] });
    },
  });
}

export function useSessionStats(sessionId: string | undefined) {
  return useQuery<SessionStatsDto>({
    queryKey: ['stats', sessionId],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getSessionStats(sessionId as string)),
    // Tokens/cost move during a turn; refetch while the tab is visible.
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

export function useSessionModels(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['model', sessionId],
    queryFn: () => unwrap(getSessionModels(sessionId ?? '')),
    enabled: Boolean(sessionId),
  });
}

export function useSetSessionModel(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, modelId }: { provider: string; modelId: string }) =>
      unwrap(setSessionModel(sessionId, provider, modelId)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['model', sessionId] });
      void qc.invalidateQueries({ queryKey: ['messages', sessionId] });
    },
  });
}

export function useSetSessionThinking(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (level: string) => unwrap(setSessionThinking(sessionId, level)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['model', sessionId] });
    },
  });
}
