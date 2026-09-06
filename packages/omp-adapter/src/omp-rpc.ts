import { mkdirSync } from 'node:fs';
import type {
  AgentEvent,
  AgentRuntime,
  CreateSessionInput,
  PromptInput,
} from '@ai-gui/agent-runtime';
import { SessionNotFoundError, StreamingActiveError } from '@ai-gui/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';
import { SessionManager } from '@oh-my-pi/pi-coding-agent';
import {
  assertRpcOk,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  toChatMessage,
} from './mapping.js';
import { RpcChild } from './rpc-child.js';

interface ChildEntry {
  child: RpcChild;
  sessionId: string;
  cwd: string;
}

type AgentEventListener = (event: AgentEvent) => void;

const processGlobal = (globalThis as { process?: { cwd?: () => string } }).process;

/**
 * AgentRuntime over `omp --mode rpc` child processes. One child is spawned per
 * web session; session listing is served read-only from the on-disk session
 * store via the SDK SessionManager (shared with SdkAdapter).
 */
export class OmpRpcAdapter implements AgentRuntime {
  readonly kind = 'omp-rpc' as const;
  private readonly children = new Map<string, ChildEntry>();
  private readonly listeners = new Set<AgentEventListener>();

  constructor(private readonly defaultCwd?: string) {}

  /** Quick probe: spawn a child, wait for ready, then tear it down. */
  static async probe(cwd?: string): Promise<void> {
    const child = await RpcChild.spawn({ cwd });
    try {
      await child.request({ type: 'get_state' }, 10_000);
    } finally {
      child.close();
    }
  }

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const cwd = input.cwd ?? this.defaultCwd ?? processGlobal?.cwd?.() ?? '';
    if (cwd) mkdirSync(cwd, { recursive: true });
    const child = await RpcChild.spawn({ cwd: cwd || undefined });
    try {
      const fresh = await child.request({ type: 'new_session' });
      assertRpcOk(fresh, 'pending');
      if ((fresh.data as { cancelled?: boolean } | undefined)?.cancelled) {
        throw new StreamingActiveError('agent is streaming; cannot start a new session now');
      }
      const state = await child.request({ type: 'get_state' });
      assertRpcOk(state, 'pending');
      const data = state.data as { sessionId?: unknown; sessionName?: unknown } | undefined;
      if (!data || typeof data.sessionId !== 'string' || !data.sessionId) {
        throw new Error('omp rpc get_state returned no sessionId');
      }
      const sessionId = data.sessionId;
      child.onNotification((frame) => {
        const event = mapSessionEventToAgentEvent(sessionId, frame);
        if (event) this.emit(event);
      });
      this.children.set(sessionId, { child, sessionId, cwd });
      const now = new Date().toISOString();
      return {
        id: sessionId,
        cwd,
        title:
          typeof data.sessionName === 'string' && data.sessionName
            ? data.sessionName
            : 'New session',
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      child.close();
      throw err;
    }
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
    const entry = this.children.get(sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    const items: ChatMessage[] = [];
    let next: string | undefined = cursor;
    let staleRetried = false;
    for (let page = 0; page < 100; page += 1) {
      const res = await entry.child.request({
        type: 'get_messages_page',
        ...(next ? { cursor: next } : {}),
        ...(typeof limit === 'number' ? { limit } : {}),
      });
      if (!res.success && res.code === 'stale_cursor' && !staleRetried) {
        staleRetried = true;
        next = undefined;
        continue;
      }
      assertRpcOk(res, sessionId);
      const data = (res.data ?? {}) as { messages?: unknown[]; nextCursor?: unknown };
      const messages = Array.isArray(data.messages) ? data.messages : [];
      for (const message of messages) items.push(toChatMessage(message, items.length));
      next = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : undefined;
      if (!next) break;
    }
    return { items };
  }

  async prompt(input: PromptInput): Promise<void> {
    const entry = this.children.get(input.sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${input.sessionId}`);
    const res = await entry.child.request({
      type: 'prompt',
      message: input.text,
      streamingBehavior: 'steer',
    });
    assertRpcOk(res, input.sessionId);
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.children.get(sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    const res = await entry.child.request({ type: 'abort' });
    assertRpcOk(res, sessionId);
  }

  onEvent(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    for (const [, entry] of this.children) entry.child.close();
    this.children.clear();
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
