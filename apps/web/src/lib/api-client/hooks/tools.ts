import type {
  JobCancelResponseDto,
  PreludeResultDto,
  ProcessResultDto,
  SecurityScanResponseDto,
} from '@grove/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DebugInput,
  LspInput,
  P2aBashResult,
  P2aCellLanguage,
  P2aCellResult,
  P2aEditResult,
  P2aTodoPhase,
  P2aWriteResult,
  RunBashOptions,
  RunCellOptions,
} from '../rest';
import {
  applyTodoOp,
  browseDir,
  browserAction,
  cancelJob,
  computerAction,
  debugDebug,
  editFile,
  getGitDiff,
  getGitStatus,
  getSessionTools,
  getTodos,
  globFiles,
  grepFiles,
  listArtifacts,
  listDir,
  listJobs,
  lsp,
  processAction,
  readArtifact,
  readFile,
  resetKernel,
  runBash,
  runCell,
  securityScan,
  writeFile,
} from '../rest';
import { unwrap } from './core';
export function toolsKey(
  sessionId: string,
  scope: string,
  extra?: unknown[],
): (string | unknown)[] {
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

export function useBrowserAction(sessionId: string) {
  return useMutation<PreludeResultDto, Error, Record<string, unknown>>({
    mutationFn: (params) => unwrap(browserAction(sessionId, params)),
  });
}

/** `computer` prelude passthrough (TUI `/computer`). */

export function useComputerAction(sessionId: string) {
  return useMutation<PreludeResultDto, Error, Record<string, unknown>>({
    mutationFn: (params) => unwrap(computerAction(sessionId, params)),
  });
}

/**
 * Supervised processes of this project (TUI: `hub ps`). The broker is shared
 * with the running OMP harness, so this lists every managed daemon.
 */

export function useProcesses(sessionId: string) {
  return useQuery({
    queryKey: ['session', sessionId, 'processes'],
    queryFn: () => unwrap(processAction(sessionId, { op: 'ps' })),
    enabled: sessionId !== '',
  });
}

/** One supervised-process call: start/logs/stop/restart/describe/send/wait. */

export function useProcessAction(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProcessResultDto, Error, Record<string, unknown>>({
    mutationFn: (params) => unwrap(processAction(sessionId, params)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', sessionId, 'processes'] });
    },
  });
}

/** `security_scan` passthrough (TUI `/security`), action-keyed. */

export function useSecurityScan(sessionId: string) {
  return useMutation<SecurityScanResponseDto, Error, Record<string, unknown>>({
    mutationFn: (params) => unwrap(securityScan(sessionId, params)),
  });
}

/** Tools registered on the live session, with their active flag (TUI `/tools`). */

export function useSessionTools(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['session', sessionId, 'tools'],
    enabled: Boolean(sessionId),
    queryFn: () => unwrap(getSessionTools(sessionId as string)),
    staleTime: 15_000,
  });
}

/** Latest plan draft for review (TUI `/plan-review`); only fetched on demand. */

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

/** Content search in the session workspace (explorer search box). */

export function useGrep(
  sessionId: string,
  pattern: string | null,
  path?: string,
  caseSensitive?: boolean,
) {
  return useQuery({
    queryKey: ['session', sessionId, 'grep', pattern ?? '', path ?? '', caseSensitive ? '1' : '0'],
    enabled: pattern !== null && pattern.trim() !== '',
    queryFn: () =>
      unwrap(
        grepFiles(sessionId, pattern as string, {
          ...(path ? { path } : {}),
          ...(caseSensitive ? { caseSensitive } : {}),
        }),
      ),
    staleTime: 10_000,
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

export function useGitStatus(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['git-status', sessionId],
    queryFn: () => unwrap(getGitStatus(sessionId as string)),
    enabled: Boolean(sessionId),
    refetchOnWindowFocus: true,
  });
}

export function useGitDiff(sessionId: string, path: string | null) {
  return useQuery({
    queryKey: ['git-diff', sessionId, path],
    queryFn: () => unwrap(getGitDiff(sessionId, path as string)),
    enabled: Boolean(sessionId && path),
  });
}
