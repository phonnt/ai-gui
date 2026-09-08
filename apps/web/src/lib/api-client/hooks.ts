import type { SessionInfo } from '@ai-gui/core';
import type {
  CreateSessionDto,
  DumpResponseDto,
  ExportResponseDto,
  PromptDto,
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
  SettingResetResult,
  SettingValue,
  SpawnInput,
} from './rest';
import {
  abortSession,
  applyTheme,
  applyTodoOp,
  branchSession,
  browseDir,
  cancelHubJobs,
  clearSession,
  createSession,
  debugDebug,
  dropSession,
  dumpSession,
  editFile,
  enqueueMemory,
  exportHtml,
  forkSession,
  freshSession,
  getMemory,
  getMessages,
  getSessionModels,
  getSetting,
  getTodos,
  getTree,
  killHubAgent,
  listArtifacts,
  listCommands,
  listDir,
  listHubAgents,
  listHubJobs,
  listMcpServers,
  listModels,
  listProviders,
  listSessions,
  listSettings,
  listSkills,
  listThemes,
  lsp,
  navigateTree,
  promptSession,
  putSetting,
  readArtifact,
  readFile,
  readSkill,
  reconnectMcpServer,
  reloadMcpServer,
  renameSession,
  resetKernel,
  resetSetting,
  reviveHubAgent,
  runBash,
  runCell,
  setSessionModel,
  setSessionThinking,
  shareSession,
  spawnHubAgent,
  steerHubAgent,
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
  return useMutation<SessionInfo, Error, string | undefined>({
    mutationFn: (parentId) => unwrap(branchSession({ parentId, sessionId })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['tree', sessionId] });
    },
  });
}

export function useExportHtml(sessionId: string) {
  return useMutation<ExportResponseDto, Error, void>({
    mutationFn: () => unwrap(exportHtml(sessionId)),
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
  return useMutation<P2aBashResult, Error, { command: string; cwd?: string; timeoutMs?: number }>({
    mutationFn: (vars) => unwrap(runBash(sessionId, vars.command, vars.cwd, vars.timeoutMs)),
  });
}

export function useRunCell(sessionId: string) {
  return useMutation<
    P2aCellResult,
    Error,
    { language: P2aCellLanguage; code: string; title?: string }
  >({
    mutationFn: (vars) => unwrap(runCell(sessionId, vars.language, vars.code, vars.title)),
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
    onSuccess: () => invalidateHubAgents(qc),
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
  SkillInfo,
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
  return useMutation<{ current: string }, Error, string>({
    mutationFn: (name) => unwrap(applyTheme(name)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'themes'] });
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

export function useSkills() {
  return useQuery({
    queryKey: ['settings', 'skills'],
    queryFn: () => unwrap(listSkills()),
  });
}

export function useSkillContent(name: string | undefined, path?: string) {
  return useQuery({
    queryKey: ['settings', 'skill', name, path],
    queryFn: () => unwrap(readSkill(name as string, path)),
    enabled: typeof name === 'string' && name.length > 0,
  });
}

export function useMemory() {
  return useQuery({
    queryKey: ['settings', 'memory'],
    queryFn: () => unwrap(getMemory()),
  });
}

export function useEnqueueMemory() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { text?: string } | undefined>({
    mutationFn: (vars) => unwrap(enqueueMemory(vars?.text)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'memory'] });
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
