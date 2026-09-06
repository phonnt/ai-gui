import { describe, expect, test } from 'bun:test';
import { SessionBusyError, SessionNotFoundError } from '@ai-gui/agent-runtime';
import { assertRpcOk, mapSessionEventToAgentEvent, textOfContent, toChatMessage } from './mapping';

describe('textOfContent', () => {
  test('passes strings through, joins text parts, drops non-text', () => {
    expect(textOfContent('hi')).toBe('hi');
    expect(textOfContent([{ type: 'text', text: 'a' }, { type: 'image', url: 'x' }, 'b'])).toBe(
      'ab',
    );
    expect(textOfContent(42)).toBe('');
  });
});

describe('toChatMessage', () => {
  test('maps assistant role and content, falls back to system', () => {
    const msg = toChatMessage({ role: 'assistant', content: 'hello', timestamp: 1700000000000 }, 0);
    expect(msg.role).toBe('assistant');
    expect(msg.text).toBe('hello');
    expect(toChatMessage({ role: 'alien', content: 'x' }, 1).role).toBe('system');
  });
});

describe('mapSessionEventToAgentEvent', () => {
  test('maps agent-end and tool starts, drops unknown frames', () => {
    expect(mapSessionEventToAgentEvent('s', { type: 'agent_end' })).toEqual({
      sessionId: 's',
      kind: 'agent-end',
    });
    expect(
      mapSessionEventToAgentEvent('s', {
        type: 'tool_execution_start',
        toolName: 'bash',
      }),
    ).toEqual({ sessionId: 's', kind: 'tool-start', toolName: 'bash' });
    expect(mapSessionEventToAgentEvent('s', { type: 'bogus' })).toBeNull();
  });
});

describe('assertRpcOk', () => {
  test('throws typed errors for busy and missing sessions', () => {
    expect(() =>
      assertRpcOk({ type: 'response', command: 'prompt', success: true }, 's'),
    ).not.toThrow();
    expect(() =>
      assertRpcOk(
        { type: 'response', command: 'prompt', success: false, code: 'session_busy' },
        's',
      ),
    ).toThrow(SessionBusyError);
    expect(() =>
      assertRpcOk(
        {
          type: 'response',
          command: 'prompt',
          success: false,
          error: 'session not found',
        },
        's',
      ),
    ).toThrow(SessionNotFoundError);
  });
});
