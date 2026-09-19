import { describe, expect, test } from 'bun:test';
import type { AgentEvent, AgentRuntime } from '@ai-gui/agent-runtime';
import { createStreamBus } from './bus';

/** Socket stub that records raw frames the bus writes. */
function fakeSocket() {
  const frames: string[] = [];
  return {
    frames,
    socket: {
      send: (data: string) => {
        frames.push(data);
      },
      ping: () => {},
    },
  };
}

function fakeRuntime() {
  const listeners = new Set<(event: AgentEvent) => void>();
  const runtime = {
    onEvent(listener: (event: AgentEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as AgentRuntime;
  return {
    runtime,
    emit: (event: AgentEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

describe('stream bus replay', () => {
  test('replays retained state events to a late socket, never deltas', () => {
    const { runtime, emit } = fakeRuntime();
    const bus = createStreamBus(runtime);

    emit({ sessionId: 's1', kind: 'message-delta', text: 'partial' });
    emit({ sessionId: 's1', kind: 'tool-start', toolName: 'bash' });
    emit({ sessionId: 's1', kind: 'agent-end' });
    emit({ sessionId: 's2', kind: 'agent-end' });

    const late = fakeSocket();
    bus.add('s1', late.socket);

    const kinds = late.frames.map((frame) => JSON.parse(frame).event.kind);
    expect(kinds).toEqual(['tool-start', 'agent-end']);
    expect(late.frames.map((frame) => JSON.parse(frame).event.sessionId)).toEqual(['s1', 's1']);

    bus.dispose();
  });

  test('replays to a socket that reconnects after the turn ended', () => {
    const { runtime, emit } = fakeRuntime();
    const bus = createStreamBus(runtime);

    const first = fakeSocket();
    bus.add('s1', first.socket);
    emit({ sessionId: 's1', kind: 'message-end', message: 'hello' });
    expect(first.frames.length).toBe(1);

    bus.remove(first.socket);
    emit({ sessionId: 's1', kind: 'agent-end' });
    expect(first.frames.length).toBe(1);

    const second = fakeSocket();
    bus.add('s1', second.socket);
    const kinds = second.frames.map((frame) => JSON.parse(frame).event.kind);
    expect(kinds).toEqual(['message-end', 'agent-end']);

    bus.dispose();
  });

  test('caps retained history per session', () => {
    const { runtime, emit } = fakeRuntime();
    const bus = createStreamBus(runtime);
    for (let i = 0; i < 100; i++) emit({ sessionId: 's1', kind: 'tool-end', toolName: `t${i}` });

    const socket = fakeSocket();
    bus.add('s1', socket.socket);
    expect(socket.frames.length).toBe(64);
    expect(JSON.parse(socket.frames[0] ?? '{}').event.toolName).toBe('t36');

    bus.dispose();
  });
});
