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
