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
} from './rest';
import {
  abortSession,
  applyTodoOp,
  branchSession,
  clearSession,
  createSession,
  dropSession,
  dumpSession,
  editFile,
  exportHtml,
  forkSession,
  freshSession,
  getMessages,
  getTodos,
  getTree,
  listArtifacts,
  listDir,
  listSessions,
  navigateTree,
  promptSession,
  readArtifact,
  readFile,
  renameSession,
  resetKernel,
  runBash,
  runCell,
  shareSession,
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

export type {
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
};
