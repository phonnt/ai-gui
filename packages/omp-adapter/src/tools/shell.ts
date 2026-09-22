import {
  type BackgroundJob,
  type BashResult,
  type CellResult,
  ToolExecutionError,
  type TruncationInfo,
} from '@grove/agent-runtime';
import type { Tool } from '@oh-my-pi/pi-coding-agent/tools';
import { stripRawOutputArtifactNotice } from '@oh-my-pi/pi-coding-agent/tools/output-meta';
import { toolShellEnv } from '../tool-helpers.js';
import { sharedJobs } from '../tools-session.js';

import {
  builtTools,
  checkToolApproval,
  ensureEntry,
  entrySession,
  jobTails,
  runTool,
  type SessionEntry,
} from './core';
/**
 * SDK-direct SessionTools: every method executes a real `BUILTIN_TOOLS`
 * factory outside any agent turn.
 *
 * Tool → factory mapping (all from `BUILTIN_TOOLS.<name>(toolSession)`):
 * - readFile/listDir → `read` (ReadTool). listDir resolves + type-checks the
 *   directory through the read tool, then structures entries via node:fs
 *   (the read tool renders listings as text, which carries no sizes).
 * - writeFile → `write` (WriteTool).
 * - editFile → `edit` (EditTool, hashline mode pinned by settings).
 * - runBash → `bash` (BashTool; `timeoutMs` converted to SDK seconds).
 * - runCell/resetKernel → `eval` (EvalTool; reset via `reset: true`).
 * - getTodos/applyTodoOp → `todo` (TodoTool over in-memory session phases).
 * - listArtifacts/readArtifact → no tool exists: resolved from the session
 *   journal's artifact directory with the SDK naming rule (`<id>.<tool>.log`,
 *   `<id>.` prefix match). Needs a registered session file.
 * - lsp* → `lsp` (LspTool; `timeoutMs` converted to SDK seconds). The tool
 *   renders formatted text, so diagnostics/definition/symbols/status are
 *   parsed back into structures (see `parse*` below); hover passes through.
 * - debug* → `debug` (DebugTool over the process-wide DAP singleton; the
 *   tool serializes requests, so no per-session locking here). Structured
 *   state (threads/frames/scopes/variables/sessions/snapshots) comes from
 *   result `details`; `remove_breakpoint` needs file+line or function, so
 *   breakpoint targets are tracked per web session (see `breakpointRegs`).
 *
 * Settings keys consumed (see `session-tool-settings.ts`): `bash.enabled`,
 * `todo.enabled`, `eval.js`, `eval.py`, `lsp.enabled`, `debug.enabled`,
 * `tools.xdev`, `edit.mode`.
 */

export const JOB_TAIL_LIMIT = 32_000;

/** Accumulate a chunk for a job, keeping the last {@link JOB_TAIL_LIMIT} chars. */

export function appendJobTail(jobId: string, text: string): void {
  if (!text) return;
  const next = `${jobTails.get(jobId) ?? ''}${text}`;
  jobTails.set(jobId, next.length > JOB_TAIL_LIMIT ? next.slice(-JOB_TAIL_LIMIT) : next);
}

/**
 * Workspace glob via the SDK `find` tool outside any turn. Display paths are
 * made cwd-relative so the UI can paste them straight into a prompt.
 */

export const ASYNC_JOB_TAIL_LIMIT = 8_000;

/** Background jobs (running + recent) with whatever output we hold for them. */

export async function listJobsImpl(sessionId: string): Promise<BackgroundJob[]> {
  // Jobs are process-wide, so this used to answer 200 {"jobs":[]} for a session
  // that does not exist: a client could not tell "no jobs" from "no session".
  await ensureEntry(sessionId);
  const seen = new Map<string, BackgroundJob>();
  const toJob = (job: {
    id: string;
    type: unknown;
    status: string;
    label: string;
    startTime: number;
    agentId?: string | undefined;
    resultText?: string | undefined;
    errorText?: string | undefined;
  }): BackgroundJob => {
    const tail = jobTails.get(job.id);
    const settled = typeof job.resultText === 'string' ? job.resultText : undefined;
    const output = tail ?? settled;
    return {
      id: job.id,
      type: String(job.type),
      status: job.status as BackgroundJob['status'],
      label: job.label,
      startedAt: new Date(job.startTime).toISOString(),
      durationMs: Math.max(0, Date.now() - job.startTime),
      ...(job.agentId !== undefined ? { agentId: job.agentId } : {}),
      ...(output !== undefined
        ? {
            output:
              output.length > ASYNC_JOB_TAIL_LIMIT ? output.slice(-ASYNC_JOB_TAIL_LIMIT) : output,
          }
        : {}),
      ...(typeof job.errorText === 'string' ? { errorText: job.errorText } : {}),
    };
  };
  for (const job of sharedJobs.getRunningJobs()) seen.set(job.id, toJob(job));
  for (const job of sharedJobs.getRecentJobs()) if (!seen.has(job.id)) seen.set(job.id, toJob(job));
  return [...seen.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

export async function cancelJobImpl(
  sessionId: string,
  id: string,
): Promise<{ cancelled: boolean }> {
  await ensureEntry(sessionId);
  const cancelled = sharedJobs.cancel(id);
  return { cancelled };
}

/**
 * Detached bash owned by the adapter.
 *
 * The SDK's async bash path suppresses progress forwarding once a run is
 * backgrounded (`forwardUpdates: !startBackgrounded`), so a tool-level tail is
 * impossible for detached commands — the TUI only shows them in the job list.
 * Spawning here keeps the exact job↔output pairing: the run is registered in
 * the same process-wide job manager (so the jobs list and cancel still see it)
 * while every chunk is kept in {@link jobTails} for a live tail.
 *
 * Divergence from the tool path, by design: no output artifact file, no PTY
 * (detached PTY stays unsupported), and no auto-background of foreground runs.
 */

export async function runDetachedBash(input: {
  entry: SessionEntry;
  tool: Tool;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<BashResult> {
  const { entry, tool } = input;
  const session = entrySession(entry);
  const params: Record<string, unknown> = {
    command: input.command,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.timeoutMs !== undefined
      ? { timeout: Math.max(1, Math.ceil(input.timeoutMs / 1000)) }
      : {}),
    ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
    async: true,
  };
  // Same gate as a foreground run: a denied command never spawns.
  await checkToolApproval(tool, entry, params, 'bash');

  const label = input.command.length > 120 ? `${input.command.slice(0, 117)}...` : input.command;
  const cwd = input.cwd ?? session.cwd;
  const jobId = sharedJobs.register(
    'bash',
    label,
    async ({ jobId: id, signal, reportProgress }) => {
      const child = Bun.spawn(['bash', '-lc', input.command], {
        cwd,
        env: toolShellEnv(process.env, input.env),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const onAbort = (): void => {
        child.kill('SIGTERM');
      };
      signal.addEventListener('abort', onAbort, { once: true });

      let tail = '';
      const collect = (chunk: string): void => {
        tail =
          tail.length + chunk.length > JOB_TAIL_LIMIT
            ? (tail + chunk).slice(-JOB_TAIL_LIMIT)
            : tail + chunk;
        appendJobTail(id, chunk);
        void reportProgress(tail, { async: { state: 'running', jobId: id, type: 'bash' } });
      };
      const pump = async (stream: ReadableStream<Uint8Array> | null | undefined): Promise<void> => {
        if (!stream) return;
        const decoder = new TextDecoder();
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) collect(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
        }
      };

      let timedOut = false;
      const timer =
        input.timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGTERM');
            }, input.timeoutMs)
          : undefined;
      try {
        await Promise.all([pump(child.stdout), pump(child.stderr)]);
        const exitCode = await child.exited;
        if (timedOut)
          throw new ToolExecutionError('bash', `command timed out after ${input.timeoutMs}ms`);
        if (signal.aborted) return tail;
        if (exitCode !== 0) {
          // Mirror the tool: a non-zero exit is a failed job carrying its text.
          throw new ToolExecutionError('bash', tail.trim() || `exit ${exitCode}`);
        }
        return tail;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
    { ownerId: session.getAgentId?.() ?? undefined },
  );

  return {
    output: '',
    exitCode: 0,
    timedOut: false,
    truncated: false,
    jobId,
  };
}

export async function runBashImpl(
  sessionId: string,
  command: string,
  cwd?: string,
  timeoutMs?: number,
  env?: Record<string, string>,
  pty?: boolean,
  detach?: boolean,
): Promise<BashResult> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  if (detach) {
    return runDetachedBash({
      entry,
      tool: tools.bash,
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(env !== undefined ? { env } : {}),
    });
  }
  // Bash surfaces timeouts and non-zero exits as error *results* (not
  // throws), so read output + details unconditionally and only throw when the
  // tool itself throws.
  const { text, details } = await runTool(
    tools.bash,
    entry,
    {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {}),
      // Bun gives children spawned without an explicit env the launcher's
      // *original* environment, so scrubbing `process.env` at boot is not enough
      // for the SDK's own bash tool. Pin the gateway secret empty here, after the
      // caller's env, so nothing can put it back.
      env: { ...(env ?? {}), GROVE_TOKEN: '' },
      ...(pty ? { pty: true } : {}),
    },
    'bash',
    { throwOnError: false },
  );
  const info = (details ?? {}) as {
    exitCode?: unknown;
    timedOut?: unknown;
    meta?: { truncation?: unknown };
    async?: { jobId?: unknown };
  };
  // Bash reports its spill artifact in a trailing footer rather than the meta
  // block; lift it out so callers get a real artifact:// link.
  const { text: output, artifactId } = stripRawOutputArtifactNotice(text);
  const base = toTruncationInfo(info.meta?.truncation);
  const truncation =
    base === undefined && artifactId === undefined
      ? undefined
      : {
          ...(base ?? {
            direction: 'tail' as const,
            truncatedBy: 'lines' as const,
            totalLines: 0,
            totalBytes: 0,
          }),
          ...(artifactId ? { artifactId } : {}),
        };
  return {
    output,
    exitCode: typeof info.exitCode === 'number' ? info.exitCode : 0,
    timedOut: info.timedOut === true,
    truncated: truncation !== undefined,
    ...(truncation ? { truncation } : {}),
    ...(typeof info.async?.jobId === 'string' ? { jobId: info.async.jobId } : {}),
  };
}

/**
 * Map the SDK's `TruncationMeta` to the contract's TruncationInfo. Returns
 * undefined when the tool did not truncate, so callers can spread it.
 */

export function toTruncationInfo(raw: unknown): TruncationInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const meta = raw as Record<string, unknown>;
  const direction = meta.direction;
  const truncatedBy = meta.truncatedBy;
  if (direction !== 'head' && direction !== 'tail' && direction !== 'middle') return undefined;
  if (truncatedBy !== 'lines' && truncatedBy !== 'bytes' && truncatedBy !== 'middle') {
    return undefined;
  }
  const range = (value: unknown): { start: number; end: number } | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const r = value as { start?: unknown; end?: unknown };
    return typeof r.start === 'number' && typeof r.end === 'number'
      ? { start: r.start, end: r.end }
      : undefined;
  };
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const info: TruncationInfo = {
    direction,
    truncatedBy,
    totalLines: num(meta.totalLines) ?? 0,
    totalBytes: num(meta.totalBytes) ?? 0,
  };
  const shown = range(meta.shownRange);
  if (shown) info.shownRange = shown;
  const head = range(meta.headRange);
  if (head) info.headRange = head;
  const tail = range(meta.tailRange);
  if (tail) info.tailRange = tail;
  const elided = num(meta.elidedLines);
  if (elided !== undefined) info.elidedLines = elided;
  const next = num(meta.nextOffset);
  if (next !== undefined) info.nextOffset = next;
  if (typeof meta.artifactId === 'string' && meta.artifactId) info.artifactId = meta.artifactId;
  return info;
}

export function isEvalImage(image: unknown): image is { mimeType: string; data: string } {
  return (
    !!image &&
    typeof image === 'object' &&
    'mimeType' in image &&
    typeof image.mimeType === 'string' &&
    'data' in image &&
    typeof image.data === 'string'
  );
}

export async function runCellImpl(
  sessionId: string,
  language: 'py' | 'js',
  code: string,
  title?: string,
  timeoutMs?: number,
  reset?: boolean,
): Promise<CellResult> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  // Like bash, cell failures arrive as error results carrying the traceback
  // as text; only a thrown ToolError (no backend) becomes a 500.
  const { text, details } = await runTool(
    tools.eval,
    entry,
    {
      language,
      code,
      ...(title !== undefined ? { title } : {}),
      ...(timeoutMs !== undefined ? { timeout: Math.max(1, Math.ceil(timeoutMs / 1000)) } : {}),
      ...(reset ? { reset: true } : {}),
    },
    'eval',
    { throwOnError: false },
  );
  const images = (details as { images?: unknown } | undefined)?.images;
  const rendered = Array.isArray(images)
    ? images.flatMap((image) =>
        isEvalImage(image) ? [`data:${image.mimeType};base64,${image.data}`] : [],
      )
    : [];
  return { output: text, ...(rendered.length > 0 ? { images: rendered } : {}) };
}

export async function resetKernelImpl(
  sessionId: string,
  language: 'py' | 'js',
): Promise<{ ok: boolean }> {
  const entry = await ensureEntry(sessionId);
  const tools = await builtTools(entry, sessionId);
  const noop = language === 'py' ? 'pass' : 'void 0;';
  await runTool(tools.eval, entry, { language, code: noop, reset: true }, 'eval');
  return { ok: true };
}
