import type { CreateSessionDto, PromptDto } from '@ai-gui/protocol';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { abortSession, createSession, getMessages, listSessions, promptSession } from './rest';

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
