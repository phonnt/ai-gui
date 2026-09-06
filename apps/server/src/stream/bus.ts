import type { AgentEvent, AgentRuntime } from '@ai-gui/agent-runtime';

export interface StreamBus {
  add(sessionId: string, socket: unknown): void;
  remove(socket: unknown): void;
  size(sessionId: string): number;
  dispose(): void;
}

const HEARTBEAT_MS = 30_000;
const MAX_BUFFERED_BYTES = 1024 * 1024;

interface SocketLike {
  readyState?: number;
  bufferedAmount?: number;
  send?: (data: string) => void;
  ping?: () => void;
}

/**
 * Fan-out of runtime AgentEvents to per-session WebSocket sets. Sockets that
 * fall behind (bufferedAmount > 1MiB) skip the frame; a 30s heartbeat ping
 * keeps idle intermediaries from closing the connection.
 */
export function createStreamBus(runtime: AgentRuntime): StreamBus {
  const bySession = new Map<string, Set<SocketLike>>();
  const all = new Set<SocketLike>();
  const timers = globalThis as {
    setInterval?: (fn: () => void, ms: number) => unknown;
    clearInterval?: (id: unknown) => void;
  };

  const unsubscribe = runtime.onEvent((event: AgentEvent) => {
    const sockets = bySession.get(event.sessionId);
    if (!sockets || sockets.size === 0) return;
    const payload = JSON.stringify({ v: 'event', event });
    for (const socket of sockets) {
      try {
        if (
          typeof socket.bufferedAmount === 'number' &&
          socket.bufferedAmount > MAX_BUFFERED_BYTES
        ) {
          continue;
        }
        socket.send?.(payload);
      } catch {
        /* drop broken sockets on next close */
      }
    }
  });

  const heartbeat = timers.setInterval
    ? timers.setInterval(() => {
        for (const socket of all) {
          try {
            socket.ping?.();
          } catch {
            /* ignore */
          }
        }
      }, HEARTBEAT_MS)
    : undefined;

  return {
    add(sessionId: string, socket: unknown): void {
      const like = socket as SocketLike;
      all.add(like);
      let set = bySession.get(sessionId);
      if (!set) {
        set = new Set();
        bySession.set(sessionId, set);
      }
      set.add(like);
    },
    remove(socket: unknown): void {
      const like = socket as SocketLike;
      all.delete(like);
      for (const [sessionId, set] of bySession) {
        set.delete(like);
        if (set.size === 0) bySession.delete(sessionId);
      }
    },
    size(sessionId: string): number {
      return bySession.get(sessionId)?.size ?? 0;
    },
    dispose(): void {
      if (heartbeat !== undefined) timers.clearInterval?.(heartbeat);
      unsubscribe();
      bySession.clear();
      all.clear();
    },
  };
}
