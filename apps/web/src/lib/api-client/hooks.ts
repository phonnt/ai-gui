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
import {
  abortSession,
  branchSession,
  clearSession,
  createSession,
  dropSession,
  dumpSession,
  exportHtml,
  forkSession,
  freshSession,
  getMessages,
  getTree,
  listSessions,
  navigateTree,
  promptSession,
  renameSession,
  shareSession,
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
