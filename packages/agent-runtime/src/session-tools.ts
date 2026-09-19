export interface FileContent {
  path: string;
  tag?: string;
  text: string;
  truncated: boolean;
  /** Present when the read was bounded; carries ranges + the full-output artifact. */
  truncation?: TruncationInfo;
}

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

/**
 * Truncation facts for a bounded tool output, mirroring the SDK's
 * `TruncationMeta` so the UI can page and link to the full body.
 */
export interface TruncationInfo {
  direction: 'head' | 'tail' | 'middle';
  truncatedBy: 'lines' | 'bytes' | 'middle';
  totalLines: number;
  totalBytes: number;
  /** Line range shown, when contiguous (absent for middle elision). */
  shownRange?: { start: number; end: number };
  headRange?: { start: number; end: number };
  tailRange?: { start: number; end: number };
  elidedLines?: number;
  /** Continuation offset for head truncation (paging). */
  nextOffset?: number;
  /** Artifact holding the full output (`artifact://` id). */
  artifactId?: string;
}

export interface BashResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  /** Present when output was bounded; carries ranges + the full-output artifact. */
  truncation?: TruncationInfo;
  /** Async (background) execution id; present only when the command was detached. */
  jobId?: string;
}

/** One background (async) job owned by the process-wide job manager. */
export interface BackgroundJob {
  id: string;
  type: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  label: string;
  startedAt: string;
  durationMs: number;
  agentId?: string;
  /**
   * Latest known output: the captured tail for a running job when the web
   * started it, else the settled result text. Absent when never captured.
   */
  output?: string;
  errorText?: string;
}

export interface CellResult {
  output: string;
  /** Renderable image outputs as `data:<mime>;base64,<payload>` URLs. */
  images?: string[];
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

export interface TodoTask {
  content: string;
  status: TodoStatus;
  blocker?: string;
}

export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

export interface LspDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: string;
  message: string;
}

export interface LspLocation {
  file: string;
  line: number;
  column?: number;
}

export interface LspSymbol {
  name: string;
  kind: string;
  line: number;
}

export interface LspStatus {
  servers: { name: string; status: string }[];
  ok: boolean;
}

export interface ArtifactRef {
  id: string;
  kind: string;
  size: number;
  path: string;
}

export interface DebugThread {
  id: number;
  name: string;
}

export interface DebugStackFrame {
  id: number;
  name: string;
  file?: string;
  line?: number;
}

/**
 * Out-of-turn session surfaces (files/explorer+editor, terminal, eval
 * notebook, todos, artifacts) served SDK-direct, outside any agent turn.
 *
 * LSP/debug methods execute `BUILTIN_TOOLS.lsp`/`debug` on the shared
 * per-session ToolSession handle. The DAP side is a process-wide singleton
 * (one live root session): concurrent web sessions share it and the tool
 * serializes requests.
 */
export interface SessionTools {
  readFile(input: { sessionId: string; path: string; range?: string }): Promise<FileContent>;
  listDir(input: { sessionId: string; path?: string }): Promise<DirEntry[]>;
  /**
   * Content search (SDK `grep`): workspace-relative file matches plus the
   * pre-formatted result text the TUI renders.
   */
  grepFiles(input: {
    sessionId: string;
    pattern: string;
    /** File, directory, glob or `file:lines` selector; default workspace root. */
    path?: string;
    caseSensitive?: boolean;
    /** Files to skip before collecting results (pagination). */
    skip?: number;
  }): Promise<{
    files: { path: string; count: number }[];
    text: string;
    matchCount: number;
    truncated: boolean;
  }>;
  /**
   * Workspace file paths matching a glob (`;`-separated patterns allowed).
   * Paths come back relative to the session cwd, the shape the UI pastes.
   */
  globFiles(input: {
    sessionId: string;
    pattern: string;
    /** Cap on returned paths (default 100, max 500). */
    limit?: number;
  }): Promise<{ paths: string[]; truncated: boolean }>;
  writeFile(input: {
    sessionId: string;
    path: string;
    content: string;
  }): Promise<{ bytes: number; tag: string }>;
  editFile(input: {
    sessionId: string;
    path: string;
    tag: string;
    input: string;
  }): Promise<{ tag: string; applied: boolean }>;
  runBash(input: {
    sessionId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
    /** Extra environment variables for this command only. */
    env?: Record<string, string>;
    /** Allocate a PTY (interactive/streaming programs). */
    pty?: boolean;
    /** Detach into the background job manager and return its id. */
    async?: boolean;
  }): Promise<BashResult>;
  runCell(input: {
    sessionId: string;
    language: 'py' | 'js';
    code: string;
    title?: string;
    /** Per-cell timeout in ms; omitted means the kernel default. */
    timeoutMs?: number;
    /** Reset the kernel before this cell runs. */
    reset?: boolean;
  }): Promise<CellResult>;
  resetKernel(input: { sessionId: string; language: 'py' | 'js' }): Promise<{ ok: boolean }>;
  /** Background jobs (running + recently settled) with their latest output. */
  listJobs(input: { sessionId: string }): Promise<BackgroundJob[]>;
  /** Cancel one background job; false when it was unknown or already settled. */
  cancelJob(input: { sessionId: string; id: string }): Promise<{ cancelled: boolean }>;
  getTodos(input: { sessionId: string }): Promise<TodoPhase[]>;
  applyTodoOp(input: { sessionId: string; op: string; payload?: unknown }): Promise<TodoPhase[]>;
  listArtifacts(input: { sessionId: string }): Promise<ArtifactRef[]>;
  readArtifact(input: {
    sessionId: string;
    id: string;
    range?: string;
  }): Promise<{ content: string; truncated: boolean; truncation?: TruncationInfo }>;
  lspDiagnostics(input: {
    sessionId: string;
    file: string;
    timeoutMs?: number;
  }): Promise<LspDiagnostic[]>;
  lspDefinition(input: {
    sessionId: string;
    file: string;
    line: number;
    symbol: string;
  }): Promise<LspLocation[]>;
  lspHover(input: {
    sessionId: string;
    file: string;
    line: number;
    symbol: string;
  }): Promise<string>;
  lspSymbols(input: { sessionId: string; file: string; query?: string }): Promise<LspSymbol[]>;
  lspStatus(input: { sessionId: string }): Promise<LspStatus>;
  /**
   * Raw LSP/debug passthrough: the caller supplies the SDK tool's own
   * parameter object, so every action the tool supports is reachable.
   */
  lspRequest(input: {
    sessionId: string;
    params: Record<string, unknown>;
  }): Promise<{ text: string; details: Record<string, unknown> | undefined }>;
  debugRequest(input: {
    sessionId: string;
    params: Record<string, unknown>;
  }): Promise<{ text: string; details: Record<string, unknown> | undefined }>;
  debugLaunch(input: {
    sessionId: string;
    program: string;
    args?: string[];
    cwd?: string;
    adapter?: string;
  }): Promise<{ session: string }>;
  debugAttach(input: {
    sessionId: string;
    pid?: number;
    port?: number;
    host?: string;
    adapter?: string;
    cwd?: string;
  }): Promise<{ session: string }>;
  debugBreakpoint(input: {
    sessionId: string;
    file?: string;
    line?: number;
    fn?: string;
    condition?: string;
  }): Promise<{ id: number }>;
  debugRemoveBreakpoint(input: { sessionId: string; id: number }): Promise<{ ok: boolean }>;
  debugContinue(input: { sessionId: string }): Promise<{ state: string }>;
  debugStep(input: { sessionId: string; kind: 'over' | 'in' | 'out' }): Promise<{ state: string }>;
  debugPause(input: { sessionId: string }): Promise<{ ok: boolean }>;
  debugEvaluate(input: {
    sessionId: string;
    expression: string;
    frameId?: number;
  }): Promise<{ result: string }>;
  debugThreads(input: { sessionId: string }): Promise<DebugThread[]>;
  debugStack(input: { sessionId: string; levels?: number }): Promise<DebugStackFrame[]>;
  debugScopes(input: {
    sessionId: string;
    frameId?: number;
  }): Promise<{ ref: number; name: string }[]>;
  debugVariables(input: {
    sessionId: string;
    ref: number;
  }): Promise<{ name: string; value: string }[]>;
  debugOutput(input: { sessionId: string }): Promise<{ text: string }>;
  debugTerminate(input: { sessionId: string }): Promise<{ ok: boolean }>;
  debugSessions(input: { sessionId: string }): Promise<{ id: string; state: string }[]>;
}
