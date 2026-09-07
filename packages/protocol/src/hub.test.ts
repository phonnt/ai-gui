import { describe, expect, test } from 'bun:test';
import { HubAgentSchema, HubJobsCancelSchema, HubSpawnSchema, HubSteerSchema } from './rest';

const agent = {
  id: 'a1',
  displayName: 'scout',
  kind: 'sub',
  status: 'running',
  sessionFile: null,
  createdAt: '2026-09-07T00:00:00.000Z',
  lastActivity: '2026-09-07T00:00:01.000Z',
};

describe('HubAgentSchema', () => {
  test('accepts full and minimal agents, rejects bad status', () => {
    expect(HubAgentSchema.safeParse(agent).success).toBe(true);
    expect(
      HubAgentSchema.safeParse({ ...agent, parentId: 'p', activity: 'x', model: 'm' }).success,
    ).toBe(true);
    expect(HubAgentSchema.safeParse({ ...agent, status: 'teleport' }).success).toBe(false);
    expect(HubAgentSchema.safeParse({ ...agent, id: '' }).success).toBe(false);
  });
});

describe('HubSteerSchema', () => {
  test('requires non-empty text', () => {
    expect(HubSteerSchema.safeParse({ text: 'go' }).success).toBe(true);
    expect(HubSteerSchema.safeParse({ text: '' }).success).toBe(false);
    expect(HubSteerSchema.safeParse({}).success).toBe(false);
  });
});

describe('HubSpawnSchema', () => {
  test('requires sessionId and task, allows optionals', () => {
    expect(HubSpawnSchema.safeParse({ sessionId: 's', task: 'do it' }).success).toBe(true);
    expect(
      HubSpawnSchema.safeParse({ sessionId: 's', task: 'do it', agent: 'scout' }).success,
    ).toBe(true);
    expect(HubSpawnSchema.safeParse({ task: 'do it' }).success).toBe(false);
    expect(HubSpawnSchema.safeParse({ sessionId: 's' }).success).toBe(false);
  });
});

describe('HubJobsCancelSchema', () => {
  test('ids optional', () => {
    expect(HubJobsCancelSchema.safeParse({}).success).toBe(true);
    expect(HubJobsCancelSchema.safeParse({ ids: ['a'] }).success).toBe(true);
    expect(HubJobsCancelSchema.safeParse({ ids: [''] }).success).toBe(false);
  });
});
