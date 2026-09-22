import { describe, expect, test } from 'bun:test';
import type { ChatMessage } from '@grove/core';
import {
  formatLongDuration,
  lastUserMessageId,
  formatTurnStatus,
  groupTurns,
  summarizeTurn,
  turnDurationMs,
} from './turns';

function msg(id: string, role: ChatMessage['role'], text = id): ChatMessage {
  return { id, role, text, createdAt: '2026-09-14T00:00:00Z' };
}

describe('groupTurns', () => {
  test('starts a new turn per user message', () => {
    const turns = groupTurns([
      msg('u1', 'user'),
      msg('a1', 'assistant'),
      msg('u2', 'user'),
      msg('t1', 'tool'),
    ]);
    expect(turns.length).toBe(2);
    expect(turns[0]?.user?.id).toBe('u1');
    expect(turns[0]?.items.map((m) => m.id)).toEqual(['a1']);
    expect(turns[1]?.items.map((m) => m.id)).toEqual(['t1']);
  });

  test('keeps preamble before the first user message', () => {
    const turns = groupTurns([msg('s1', 'system'), msg('u1', 'user')]);
    expect(turns.length).toBe(2);
    expect(turns[0]?.user).toBeNull();
    expect(turns[0]?.items.map((m) => m.id)).toEqual(['s1']);
  });
});

describe('summarizeTurn', () => {
  test('counts tools, files, errors and wall time', () => {
    const turns = groupTurns([
      msg('u1', 'user'),
      { ...msg('t1', 'tool'), tool: { name: 'read', path: '/a.ts', wallTimeMs: 1200 } },
      { ...msg('t2', 'tool'), tool: { name: 'bash', error: true, wallTimeMs: 300 } },
    ]);
    const first = turns[0];
    expect(first).toBeDefined();
    if (!first) return;
    const summary = summarizeTurn(first);
    expect(summary.toolCount).toBe(2);
    expect(summary.fileCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.totalWallMs).toBe(1500);
  });
});

describe('formatTurnStatus', () => {
  test('matches the TUI collapse label', () => {
    expect(formatTurnStatus('done', 4, 403_000)).toBe('Completed 4 steps in 6m 43s');
    expect(formatTurnStatus('done', 1, 43_000)).toBe('Completed 1 step in 43s');
    expect(formatTurnStatus('done', 2, null)).toBe('Completed 2 steps');
    expect(formatTurnStatus('failed', 3, 12_000)).toBe('Failed after 3 steps in 12s');
    expect(formatTurnStatus('working', 2, null)).toBe('Working · 2 steps');
  });

  test('formats long durations like the TUI', () => {
    expect(formatLongDuration(400)).toBe('0s');
    expect(formatLongDuration(43_000)).toBe('43s');
    expect(formatLongDuration(403_000)).toBe('6m 43s');
    expect(formatLongDuration(3_720_000)).toBe('1h 2m');
  });

  test('measures wall-clock duration from transcript timestamps', () => {
    const turns = groupTurns([
      { ...msg('u1', 'user'), createdAt: '2026-09-14T00:00:00Z' },
      { ...msg('a1', 'assistant'), createdAt: '2026-09-14T00:06:43Z' },
    ]);
    const first = turns[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(turnDurationMs(first)).toBe(403_000);
    expect(turnDurationMs({ id: 'empty', user: null, items: [] })).toBeNull();
  });
});

describe('lastUserMessageId', () => {
  test('answers the newest user message, skipping assistant and tool rows', () => {
    const messages = [
      msg('u1', 'user', 'first'),
      msg('a1', 'assistant', 'answer'),
      msg('u2', 'user', 'second'),
      msg('a2', 'assistant', 'answer again'),
    ];

    expect(lastUserMessageId(messages)).toBe('u2');
  });

  test('answers null when the transcript has no user message yet', () => {
    expect(lastUserMessageId([msg('a1', 'assistant')])).toBeNull();
  });
});
