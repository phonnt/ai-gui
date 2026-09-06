import { mkdirSync } from 'node:fs';
import type {
  AgentEvent,
  AgentRuntime,
  CreateSessionInput,
  PromptInput,
} from '@ai-gui/agent-runtime';
import { SessionNotFoundError } from '@ai-gui/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';
import {
  AgentRegistry,
  type AgentSession,
  createAgentSession,
  SessionManager,
} from '@oh-my-pi/pi-coding-agent';
import { mapSessionEventToAgentEvent, sdkSessionInfoToCore, toChatMessage } from './mapping.js';

interface SessionEntry {
  session: AgentSession;
  unsubscribe: () => void;
}

type AgentEventListener = (event: AgentEvent) => void;

const processGlobal = (globalThis as { process?: { cwd?: () => string } }).process;

/**
 * AgentRuntime over in-process SDK sessions. Holds one AgentSession per web
 * session id in a Map behind a private per-instance AgentRegistry, so server
 * instances never leak IRC identity into the global registry.
 */
export class SdkAdapter implements AgentRuntime {
  readonly kind = 'sdk' as const;
  private readonly registry = new AgentRegistry();
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly listeners = new Set<AgentEventListener>();

  constructor(private readonly defaultCwd?: string) {}

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const cwd = input.cwd ?? this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session } = await createAgentSession({
      ...(cwd ? { cwd } : {}),
      agentRegistry: this.registry,
    });
    const sessionId = session.sessionId;
    const unsubscribe = session.subscribe((event) => {
      const mapped = mapSessionEventToAgentEvent(sessionId, event as Record<string, unknown>);
      if (mapped) this.emit(mapped);
    });
    this.sessions.set(sessionId, { session, unsubscribe });
    const now = new Date().toISOString();
    return { id: sessionId, cwd: cwd ?? '', title: 'New session', createdAt: now, updatedAt: now };
  }

  async listSessions(): Promise<SessionInfo[]> {
    const cwd = this.defaultCwd ?? processGlobal?.cwd?.() ?? '';
    const infos = await SessionManager.list(cwd);
    return infos.map((info) =>
      sdkSessionInfoToCore({
        id: info.id,
        cwd: info.cwd,
        title: info.title,
        firstMessage: info.firstMessage,
        created: info.created,
        modified: info.modified,
      }),
    );
  }

  async getMessages(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Page<ChatMessage>> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    const messages = entry.session.messages;
    let start = 0;
    if (cursor !== undefined && cursor !== '') {
      const parsed = Number(cursor);
      start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    const pageLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 100;
    const slice = messages.slice(start, start + pageLimit);
    const items = slice.map((message, index) => toChatMessage(message, start + index));
    const end = start + slice.length;
    return end < messages.length ? { items, nextCursor: String(end) } : { items };
  }

  async prompt(input: PromptInput): Promise<void> {
    const entry = this.sessions.get(input.sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${input.sessionId}`);
    await entry.session.prompt(input.text, { streamingBehavior: 'steer' });
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    await entry.session.abort();
  }

  onEvent(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    for (const entry of entries) {
      try {
        entry.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        await entry.session.dispose();
      } catch {
        /* best-effort teardown */
      }
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener errors must not break other subscribers */
      }
    }
  }
}
