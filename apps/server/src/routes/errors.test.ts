import { describe, expect, test } from 'bun:test';
import {
  AgentNotFoundError,
  ArtifactNotFoundError,
  InvalidRequestError,
  ModeConflictError,
  OperationNotSupportedError,
  PathNotFoundError,
  ReviveFailedError,
  SessionBusyError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@grove/agent-runtime';
import { errorToStatus, HttpError } from './errors';

describe('errorToStatus', () => {
  test('keeps an explicit HttpError status', () => {
    expect(errorToStatus(new HttpError(418, 'teapot'))).toBe(418);
  });

  test('maps missing resources to 404', () => {
    expect(errorToStatus(new SessionNotFoundError('s1'))).toBe(404);
    expect(errorToStatus(new ArtifactNotFoundError('a1'))).toBe(404);
    expect(errorToStatus(new AgentNotFoundError('nope'))).toBe(404);
    expect(errorToStatus(new PathNotFoundError('read: Path /x not found'))).toBe(404);
  });

  test('maps caller conditions to 400, never 500', () => {
    expect(errorToStatus(new InvalidRequestError('branch requires a user message'))).toBe(400);
    expect(errorToStatus(new InvalidRequestError('Nothing to compact (session too small)'))).toBe(
      400,
    );
  });

  test('maps state conflicts to 409', () => {
    expect(errorToStatus(new SessionBusyError('s1'))).toBe(409);
    expect(errorToStatus(new StreamingActiveError('s1'))).toBe(409);
    expect(errorToStatus(new ModeConflictError('exit plan mode first'))).toBe(409);
    expect(errorToStatus(new ReviveFailedError('s1'))).toBe(409);
  });

  test('maps unsupported operations to 501 and unknown failures to 500', () => {
    expect(errorToStatus(new OperationNotSupportedError('fork'))).toBe(501);
    expect(errorToStatus(new Error('connect ENOENT broker.sock'))).toBe(500);
    expect(errorToStatus('not an error')).toBe(500);
  });

  test('SessionNotFoundError message is not doubled', () => {
    expect(new SessionNotFoundError('abc').message).toBe('session not found: abc');
  });
});
