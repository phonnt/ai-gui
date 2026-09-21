import { describe, expect, test } from 'bun:test';
import { InvalidRequestError, PathNotFoundError } from '@grove/agent-runtime';
import { toInvalidRequestError, toPathNotFoundError } from './client-errors';

describe('toInvalidRequestError', () => {
  // Every message below was observed in the 2026-09-21 functional audit and
  // used to reach the client as a 500, which reads as a Grove outage.
  test('classifies observed SDK caller conditions', () => {
    const messages = [
      'edit: Edit rejected for hello.txt: hash #0000 is not from this session',
      'branch requires a user message',
      'tree node not found: abc',
      'Nothing to compact (session too small)',
      'lsp: No language server found for this action',
      'hindsight backend is not active for this session',
      'Unknown daemon nope. Available: probe',
      'debug: No active debug session. Launch or attach first.',
    ];
    for (const message of messages) {
      const classified = toInvalidRequestError(new Error(message));
      expect(classified).toBeInstanceOf(InvalidRequestError);
      expect(classified?.message).toBe(message);
    }
  });

  test('accepts a bare message string', () => {
    expect(toInvalidRequestError('Nothing to compact (session too small)')).toBeInstanceOf(
      InvalidRequestError,
    );
  });

  test('leaves real faults alone', () => {
    const faults = [
      new Error('Failed to start daemon broker: connect ENOENT /x/broker.sock'),
      new Error('session switch was cancelled: abc'),
      new Error('boom'),
      'boom',
    ];
    for (const fault of faults) expect(toInvalidRequestError(fault)).toBe(null);
  });
});

describe('toPathNotFoundError', () => {
  test('classifies missing files instead of 500', () => {
    // Raw SDK messages: the tool-name prefix is added *after* classification.
    expect(toPathNotFoundError(new Error("Path '/tmp/x/a.txt' not found"))).toBeInstanceOf(
      PathNotFoundError,
    );
    expect(
      toPathNotFoundError(
        new Error('File not found: a.txt. Use the write tool to create new files.'),
      ),
    ).toBeInstanceOf(PathNotFoundError);
  });

  test('does not swallow other tool failures', () => {
    expect(toPathNotFoundError(new Error('No language server found for this action'))).toBe(null);
    expect(toPathNotFoundError(new Error('bash: command failed'))).toBe(null);
  });
});
