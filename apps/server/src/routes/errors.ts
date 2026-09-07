import {
  AgentNotFoundError,
  ArtifactNotFoundError,
  OperationNotSupportedError,
  ReviveFailedError,
  SessionBusyError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@ai-gui/agent-runtime';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Map typed runtime errors (plus HttpError) to HTTP status codes. */
export function errorToStatus(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err instanceof SessionNotFoundError || err instanceof ArtifactNotFoundError) return 404;
  if (err instanceof AgentNotFoundError) return 404;
  if (err instanceof SessionBusyError || err instanceof StreamingActiveError) return 409;
  if (err instanceof ReviveFailedError) return 409;
  if (err instanceof OperationNotSupportedError) return 501;
  return 500;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'internal error';
}
