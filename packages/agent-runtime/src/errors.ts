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
