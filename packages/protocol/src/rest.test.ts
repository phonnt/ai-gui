import { describe, expect, test } from 'bun:test';
import { WsFrameSchema } from './events';
import { CreateSessionSchema, MessagesQuerySchema, PromptSchema } from './rest';
import { isCompatible, PROTOCOL_VERSION } from './version';

describe('protocol version', () => {
  test('accepts its own version only', () => {
    expect(isCompatible(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatible('9.9.9')).toBe(false);
  });
});

describe('PromptSchema', () => {
  test('accepts non-empty text', () => {
    expect(PromptSchema.safeParse({ text: 'hi' }).success).toBe(true);
  });

  test('rejects empty text and missing text', () => {
    expect(PromptSchema.safeParse({ text: '' }).success).toBe(false);
    expect(PromptSchema.safeParse({}).success).toBe(false);
  });
});

describe('MessagesQuerySchema', () => {
  test('defaults limit to 100', () => {
    expect(MessagesQuerySchema.parse({})).toEqual({ limit: 100 });
  });

  test('coerces string limit and enforces 1..256', () => {
    expect(MessagesQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(MessagesQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(MessagesQuerySchema.safeParse({ limit: 300 }).success).toBe(false);
  });
});

describe('CreateSessionSchema', () => {
  test('cwd is optional but not blank', () => {
    expect(CreateSessionSchema.safeParse({}).success).toBe(true);
    expect(CreateSessionSchema.safeParse({ cwd: '/tmp/x' }).success).toBe(true);
    expect(CreateSessionSchema.safeParse({ cwd: '' }).success).toBe(false);
  });
});

describe('WsFrameSchema', () => {
  test('accepts agent-end event frames, rejects unknown kinds', () => {
    const ok = WsFrameSchema.safeParse({
      v: 'event',
      event: { sessionId: 's1', kind: 'agent-end' },
    });
    expect(ok.success).toBe(true);
    const bad = WsFrameSchema.safeParse({
      v: 'event',
      event: { sessionId: 's1', kind: 'teleport' },
    });
    expect(bad.success).toBe(false);
  });
});
