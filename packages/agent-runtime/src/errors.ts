export class SessionNotFoundError extends Error {
  readonly code = 'SESSION_NOT_FOUND';

  constructor(sessionId?: string) {
    super(sessionId ? `session not found: ${sessionId}` : 'session not found');
    this.name = 'SessionNotFoundError';
  }
}

export class SessionBusyError extends Error {
  readonly code = 'SESSION_BUSY';

  constructor(sessionId?: string) {
    super(sessionId ? `session is busy: ${sessionId}` : 'session is busy');
    this.name = 'SessionBusyError';
  }
}

export class StreamingActiveError extends Error {
  readonly code = 'STREAMING_ACTIVE';

  constructor(sessionId?: string) {
    super(sessionId ? `stream is active: ${sessionId}` : 'stream is active');
    this.name = 'StreamingActiveError';
  }
}

/**
 * The requested mode contradicts another active mode. OMP keeps plan, vibe and
 * goal mutually exclusive (a plan turn cannot also be an autonomous goal), so
 * the toggle is refused with the reason the TUI shows.
 */
export class ModeConflictError extends Error {
  readonly code = 'MODE_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'ModeConflictError';
  }
}

export class RuntimeUnavailableError extends Error {
  readonly code = 'RUNTIME_UNAVAILABLE';

  constructor(message?: string) {
    super(message ?? 'agent runtime is unavailable');
    this.name = 'RuntimeUnavailableError';
  }
}

export class OperationNotSupportedError extends Error {
  readonly code = 'operation-not-supported';

  constructor(op?: string) {
    super(op ? `operation not supported: ${op}` : 'operation not supported');
    this.name = 'OperationNotSupportedError';
  }
}

/**
 * The runtime refused a request because of caller input or a precondition the
 * caller can fix (stale edit tag, no user message to branch from, no language
 * server resolved, backend mismatch). Distinct from a runtime fault: the HTTP
 * boundary answers 4xx so a client bug never reads as a server outage.
 */
export class InvalidRequestError extends Error {
  readonly code = 'INVALID_REQUEST';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

/**
 * A path the caller named does not exist (or is not visible inside the session
 * jail). `read`/`edit` on a missing file is a caller mistake, so the HTTP
 * boundary answers 404 instead of a 500 that reads as a server fault.
 */
export class PathNotFoundError extends Error {
  readonly code = 'PATH_NOT_FOUND';

  constructor(message: string) {
    super(message);
    this.name = 'PathNotFoundError';
  }
}

export class ToolExecutionError extends Error {
  readonly code = 'TOOL_EXECUTION';

  constructor(
    readonly toolName: string,
    message?: string,
  ) {
    super(message ? `${toolName}: ${message}` : `${toolName} failed`);
    this.name = 'ToolExecutionError';
  }
}

export class ArtifactNotFoundError extends Error {
  readonly code = 'ARTIFACT_NOT_FOUND';

  constructor(id?: string) {
    super(id ? `artifact not found: ${id}` : 'artifact not found');
    this.name = 'ArtifactNotFoundError';
  }
}
