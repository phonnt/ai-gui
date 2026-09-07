export interface FileContent {
  path: string;
  tag?: string;
  text: string;
  truncated: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
}

export interface BashResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
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

export interface ArtifactRef {
  id: string;
  kind: string;
  size: number;
  path: string;
}

/**
 * Out-of-turn session surfaces (files/explorer+editor, terminal, eval
 * notebook, todos, artifacts) served SDK-direct, outside any agent turn.
 */
export interface SessionTools {
  readFile(input: { sessionId: string; path: string; range?: string }): Promise<FileContent>;
  listDir(input: { sessionId: string; path?: string }): Promise<DirEntry[]>;
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
  }): Promise<BashResult>;
  runCell(input: {
    sessionId: string;
    language: 'py' | 'js';
    code: string;
    title?: string;
  }): Promise<CellResult>;
  resetKernel(input: { sessionId: string; language: 'py' | 'js' }): Promise<{ ok: boolean }>;
  getTodos(input: { sessionId: string }): Promise<TodoPhase[]>;
  applyTodoOp(input: { sessionId: string; op: string; payload?: unknown }): Promise<TodoPhase[]>;
  listArtifacts(input: { sessionId: string }): Promise<ArtifactRef[]>;
  readArtifact(input: {
    sessionId: string;
    id: string;
    range?: string;
  }): Promise<{ content: string; truncated: boolean }>;
}
