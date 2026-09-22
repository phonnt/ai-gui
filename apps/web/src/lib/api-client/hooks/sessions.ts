import type { SessionInfo } from '@grove/core';
import type {
  BranchResponseDto,
  ConflictEntryDto,
  CreateSessionDto,
  DumpResponseDto,
  EphemeralAskResponseDto,
  ForeignSessionSourceDto,
  GoalActionDto,
  GoalStateDto,
  GuidedGoalResponseDto,
  LoopStateDto,
  ModeActionDto,
  PromptDto,
  ResolveConflictsDto,
  SessionModesDto,
  SessionStatsDto,
  ShareResponseDto,
  TreeResponseDto,
  WorktreeMoveResponseDto,
} from '@grove/protocol';
import type { QueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  abortSession,
  addWorkspaceDir,
  askEphemeral,
  branchSession,
  clearSession,
  compactSession,
  createSession,
  decideApproval,
  decidePlan,
  dropSession,
  dumpSession,
  forkSession,
  freshSession,
  getGoal,
  getLoop,
  getMessages,
  getModes,
  getPlanDraft,
  getSessionModels,
  getSessionStats,
  getTree,
  getWorkspace,
  goalAction,
  importForeignSession,
  labelTreeEntry,
  listConflicts,
  listForeignSessions,
  listSessionSkills,
  listSessions,
  modeAction,
  moveSession,
  moveToWorktree,
  navigateTree,
  pauseLoop,
  promptSession,
  readSessionSkill,
  removeWorkspaceDir,
  renameSession,
  resolveConflicts,
  retryTurn,
  setSessionModel,
  setSessionThinking,
  shareSession,
  startGuidedGoal,
  startLoop,
  stopLoop,
  switchModel,
} from '../rest';
import { unwrap } from './core';
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

export function invalidateSession(qc: QueryClient, sessionId: string) {
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

export function useForeignSessions(source: ForeignSessionSourceDto, enabled: boolean) {
  return useQuery({
    queryKey: ['foreign-sessions', source],
    enabled,
    queryFn: () => unwrap(listForeignSessions(source)),
    staleTime: 30_000,
  });
}

/** Import one foreign session as a new OMP session. */

export function useImportForeignSession() {
  const qc = useQueryClient();
  return useMutation<
    SessionInfo,
    Error,
    { source: ForeignSessionSourceDto; path: string; fallbackCwd?: string }
  >({
    mutationFn: (input) => unwrap(importForeignSession(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/** Move the session into a fresh git worktree (TUI `/wt`). */

export function useMoveToWorktree(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<WorktreeMoveResponseDto, Error, string | undefined>({
    mutationFn: (branch) => unwrap(moveToWorktree(sessionId, branch)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['session', sessionId, 'workspace'] });
    },
  });
}

/** Installed plugins (npm + configured extension roots). */

export function useEphemeralAsk(sessionId: string) {
  return useMutation<EphemeralAskResponseDto, Error, string>({
    mutationFn: (question) => unwrap(askEphemeral(sessionId, question)),
  });
}

/** Start the guided-goal interview (TUI `/guided-goal`). */

export function useGuidedGoal(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<GuidedGoalResponseDto, Error, string | undefined>({
    mutationFn: (initial) => unwrap(startGuidedGoal(sessionId, initial)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['goal', sessionId] });
      void qc.invalidateQueries({ queryKey: ['messages', sessionId] });
    },
  });
}

/** `browser` prelude passthrough (TUI `/browser`). */

export function usePlanDraft(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['session', sessionId, 'plan-draft'],
    enabled,
    queryFn: () => unwrap(getPlanDraft(sessionId)),
    staleTime: 5_000,
  });
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

/** `/switch <selector>`: the server resolves fuzzy ids, @role and :level. */

export function useSwitchModel(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (selector: string) => unwrap(switchModel(sessionId, selector)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['model', sessionId] });
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
