import { type AgentEventDto, WsFrameSchema } from '@ai-gui/protocol';
import { useEffect, useRef, useState } from 'react';

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10000;

function streamUrl(sessionId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/stream`;
}

export function useSessionEvents(
  sessionId: string | undefined,
  onEvent: (event: AgentEventDto) => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('idle');
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle');
      return;
    }
    let socket: WebSocket | null = null;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      socket = new WebSocket(streamUrl(sessionId));
      socket.onopen = () => {
        attempt = 0;
        if (!disposed) setStatus('open');
      };
      socket.onmessage = (msg) => {
        let json: unknown;
        try {
          json = JSON.parse(String(msg.data));
        } catch {
          return;
        }
        const parsed = WsFrameSchema.safeParse(json);
        if (!parsed.success) return;
        if (parsed.data.v === 'event') handlerRef.current(parsed.data.event);
      };
      const retry = () => {
        if (disposed) return;
        attempt += 1;
        const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
        timer = setTimeout(connect, delay);
      };
      socket.onclose = retry;
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [sessionId]);

  return status;
}
