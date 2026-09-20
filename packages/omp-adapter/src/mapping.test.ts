import { describe, expect, test } from 'bun:test';
import {
  OperationNotSupportedError,
  SessionBusyError,
  SessionNotFoundError,
} from '@grove/agent-runtime';
import {
  assertRpcOk,
  flattenSessionTree,
  mapSessionEventToAgentEvent,
  sessionFileTextToMessages,
  sessionFileTextToTree,
  textOfContent,
  toChatMessage,
  toTreeNode,
} from './mapping';

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

  test('extracts todo phases, edit diff, and resolved path from details', () => {
    const todo = toChatMessage(
      {
        role: 'toolResult',
        toolName: 'todo',
        content: 'x',
        details: {
          phases: [
            {
              name: 'P',
              tasks: [
                { content: 'a', status: 'completed' },
                { content: 'b', status: 'in_progress' },
                { content: 'c', status: 'pending' },
                { content: 'd', status: 'blocked' },
                { content: '', status: 'pending' },
              ],
            },
          ],
        },
      },
      0,
    );
    expect(todo.tool?.todos).toEqual([
      { phase: 'P', label: 'a', status: 'done' },
      { phase: 'P', label: 'b', status: 'active' },
      { phase: 'P', label: 'c', status: 'todo' },
      { phase: 'P', label: 'd', status: 'todo' },
    ]);
    const edit = toChatMessage(
      {
        role: 'toolResult',
        toolName: 'edit',
        content: 'x',
        details: {
          resolvedPath: '/tmp/f.ts',
          diff: '-12|old\n+12|new\n 13|ctx\nnot a diff line',
        },
      },
      1,
    );
    expect(edit.tool?.path).toBe('/tmp/f.ts');
    expect(edit.tool?.diff).toEqual([
      { type: 'del', n: 12, text: 'old' },
      { type: 'add', n: 12, text: 'new' },
      { type: 'ctx', n: 13, text: 'ctx' },
      { type: 'ctx', text: 'not a diff line' },
    ]);
  });

  test('prefers details timing over the text trailer', () => {
    const bash = toChatMessage(
      {
        role: 'toolResult',
        toolName: 'bash',
        content: 'out\n\nWall time: 9.04 seconds',
        details: { timeoutSeconds: 300, wallTimeMs: 58.83 },
      },
      0,
    );
    expect(bash.text).toBe('out');
    expect(bash.tool?.wallTimeMs).toBe(59);
    expect(bash.tool?.timeoutMs).toBe(300000);
    expect(bash.tool?.error).toBeUndefined();
    const failed = toChatMessage(
      { role: 'toolResult', toolName: 'bash', content: 'denied', isError: true },
      1,
    );
    expect(failed.tool?.error).toBe(true);
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

  test('routes reasoning deltas to their own channel', () => {
    expect(
      mapSessionEventToAgentEvent('s', {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'weigh options' },
      }),
    ).toEqual({ sessionId: 's', kind: 'thinking-delta', text: 'weigh options' });

    expect(
      mapSessionEventToAgentEvent('s', {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'the answer' },
      }),
    ).toEqual({ sessionId: 's', kind: 'message-delta', text: 'the answer' });
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

describe('toTreeNode', () => {
  test('maps message roles and previews, truncates long text', () => {
    const node = toTreeNode({
      id: 'e1',
      parentId: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'message',
      message: { role: 'user', content: 'hello' },
    });
    expect(node).toEqual({
      id: 'e1',
      parentId: null,
      role: 'user',
      preview: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(
      toTreeNode({
        id: 'e2',
        parentId: 'e1',
        type: 'message',
        message: { role: 'toolResult', content: 'out' },
      }).role,
    ).toBe('tool');
    const long = toTreeNode({
      id: 'e3',
      parentId: null,
      type: 'message',
      message: { role: 'assistant', content: 'x'.repeat(200) },
    });
    expect(long.preview.length).toBe(120);
  });

  test('maps branch summaries to branch role, compaction to system-event', () => {
    expect(
      toTreeNode({ id: 'b', parentId: 'a', type: 'branch_summary', summary: 'went left' }).role,
    ).toBe('branch');
    const compaction = toTreeNode({
      id: 'c',
      parentId: 'a',
      type: 'compaction',
      summary: 'summarized',
    });
    expect(compaction.role).toBe('system-event');
    expect(compaction.preview).toBe('summarized');
  });
});

describe('flattenSessionTree', () => {
  test('flattens depth-first preserving parent-before-child order', () => {
    const nodes = flattenSessionTree([
      {
        entry: {
          id: 'root',
          parentId: null,
          type: 'message',
          message: { role: 'user', content: 'hi' },
        },
        children: [
          {
            entry: { id: 'leaf-a', parentId: 'root', type: 'compaction', summary: 's' },
            children: [],
          },
        ],
      },
      {
        entry: { id: 'orphan', parentId: 'missing', type: 'label', label: 'keep' },
        children: [],
      },
    ]);
    expect(nodes.map((node) => node.id)).toEqual(['root', 'leaf-a', 'orphan']);
    expect(nodes[1]?.role).toBe('system-event');
  });
});

describe('sessionFileTextToTree', () => {
  test('skips the header and malformed lines, leaf is the last entry', () => {
    const text = [
      JSON.stringify({ type: 'session', id: 's', timestamp: 't', cwd: '/tmp' }),
      JSON.stringify({
        type: 'message',
        id: 'e1',
        parentId: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'hi' },
      }),
      'not json',
      JSON.stringify({ type: 'x', parentId: null }),
      JSON.stringify({
        type: 'message',
        id: 'e2',
        parentId: 'e1',
        timestamp: '2026-01-01T00:01:00.000Z',
        message: { role: 'assistant', content: 'yo' },
      }),
      '',
    ].join('\n');
    const tree = sessionFileTextToTree(text);
    expect(tree.nodes.map((node) => node.id)).toEqual(['e1', 'e2']);
    expect(tree.leafId).toBe('e2');
    expect(sessionFileTextToTree('')).toEqual({ nodes: [], leafId: null });
  });
});

describe('OperationNotSupportedError', () => {
  test('carries the operation-not-supported code and op name', () => {
    const err = new OperationNotSupportedError('clear');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('operation-not-supported');
    expect(err.message).toContain('clear');
    expect(new OperationNotSupportedError().message).toBe('operation not supported');
  });
});
describe('sessionFileTextToMessages', () => {
  test('keeps full-text messages with journal ids, drops blanks and non-messages', () => {
    const text = [
      JSON.stringify({ type: 'session', id: 's' }),
      JSON.stringify({
        type: 'message',
        id: 'e1',
        parentId: null,
        message: { role: 'user', content: 'hello world' },
      }),
      JSON.stringify({ type: 'thinking_level_change', id: 'e2', parentId: 'e1' }),
      JSON.stringify({
        type: 'message',
        id: 'e3',
        parentId: 'e1',
        message: { role: 'assistant', content: '' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'e4',
        parentId: 'e1',
        message: { role: 'assistant', content: 'hi back' },
      }),
    ].join('\n');
    const items = sessionFileTextToMessages(text);
    expect(items.map((item) => [item.id, item.role, item.text])).toEqual([
      ['e1', 'user', 'hello world'],
      ['e4', 'assistant', 'hi back'],
    ]);
  });
});
describe('sessionFileTextToMessages hidden entries', () => {
  test('drops display:false custom messages like the TUI', () => {
    const text = [
      JSON.stringify({
        type: 'message',
        id: 'e1',
        message: { role: 'user', content: 'do it' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'e2',
        message: {
          role: 'custom',
          customType: 'goal-continuation',
          content: 'keep going',
          display: false,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'e3',
        message: { role: 'assistant', content: 'done' },
      }),
    ].join('\n');
    expect(sessionFileTextToMessages(text).map((item) => item.id)).toEqual(['e1', 'e3']);
  });
});
describe('sessionFileTextToMessages boundaries', () => {
  test('drops entries at or before reset_boundary', () => {
    const text = [
      JSON.stringify({
        type: 'message',
        id: 'old',
        parentId: null,
        message: { role: 'user', content: 'before clear' },
      }),
      JSON.stringify({ type: 'reset_boundary', id: 'rb', parentId: 'old' }),
      JSON.stringify({
        type: 'message',
        id: 'new',
        parentId: 'rb',
        message: { role: 'user', content: 'after clear' },
      }),
    ].join('\n');
    expect(sessionFileTextToMessages(text).map((item) => item.id)).toEqual(['new']);
  });
});
