import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  AgentEvent,
  AgentRuntime,
  BranchInput,
  CreateSessionInput,
  NavigateInput,
  PromptInput,
  RenameInput,
  SessionTree,
} from '@ai-gui/agent-runtime';
import {
  OperationNotSupportedError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@ai-gui/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';
import { SessionManager } from '@oh-my-pi/pi-coding-agent';
import {
  assertRpcOk,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  sessionFileTextToMessages,
  sessionFileTextToTree,
  toChatMessage,
} from './mapping.js';
import { RpcChild } from './rpc-child.js';

interface ChildEntry {
  child: RpcChild;
  sessionId: string;
  cwd: string;
  unsub: () => void;
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
      const unsub = child.onNotification((frame) => {
        const event = mapSessionEventToAgentEvent(sessionId, frame);
        if (event) this.emit(event);
      });
      this.children.set(sessionId, { child, sessionId, cwd, unsub });
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
    let busyWaits = 0;
    for (let page = 0; page < 100; page += 1) {
      const res = await entry.child.request({
        type: 'get_messages_page',
        ...(next ? { cursor: next } : {}),
        ...(typeof limit === 'number' ? { limit } : {}),
      });
      if (!res.success && res.code === 'session_busy' && busyWaits < 8) {
        // Turn in flight: wait briefly and retry instead of failing the
        // transcript read; the caller still gets 409 past ~8s of streaming.
        busyWaits += 1;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1000);
        await promise;
        continue;
      }
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
    if (items.length === 0) {
      // Live child holds nothing (e.g. just branched onto a new file):
      // serve durable journal history so the transcript is not blank.
      try {
        const state = await this.childState(entry);
        if (state.sessionFile) {
          const text = await readFile(state.sessionFile, 'utf8');
          return { items: sessionFileTextToMessages(text) };
        }
      } catch {
        /* fall through with empty items */
      }
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
    const entry = this.requireChild(sessionId);
    const res = await entry.child.request({ type: 'abort' });
    assertRpcOk(res, sessionId);
  }

  async forkSession(sessionId: string): Promise<SessionInfo> {
    const entry = this.requireChild(sessionId);
    const state = await this.childState(entry);
    if (!state.sessionFile) throw new OperationNotSupportedError('fork');
    const forked = await SessionManager.forkFrom(state.sessionFile, entry.cwd);
    const newFile = forked.getSessionFile();
    try {
      await forked.flush();
    } catch {
      /* best-effort: the forked journal is already durable */
    }
    try {
      await forked.close();
    } catch {
      /* best-effort release of the fork helper's writer */
    }
    if (!newFile) throw new OperationNotSupportedError('fork');
    const child = await RpcChild.spawn({ cwd: entry.cwd || undefined });
    try {
      const switched = await child.request({ type: 'switch_session', sessionPath: newFile });
      assertRpcOk(switched, sessionId);
      if ((switched.data as { cancelled?: boolean } | undefined)?.cancelled) {
        throw new StreamingActiveError('agent is streaming; cannot fork the session now');
      }
      const fresh = await child.request({ type: 'get_state' });
      assertRpcOk(fresh, sessionId);
      const data = fresh.data as { sessionId?: unknown; sessionName?: unknown } | undefined;
      if (!data || typeof data.sessionId !== 'string' || !data.sessionId) {
        throw new Error('omp rpc get_state returned no sessionId');
      }
      const newId = data.sessionId;
      const unsub = child.onNotification((frame) => {
        const event = mapSessionEventToAgentEvent(newId, frame);
        if (event) this.emit(event);
      });
      this.children.set(newId, { child, sessionId: newId, cwd: entry.cwd, unsub });
      const now = new Date().toISOString();
      return {
        id: newId,
        cwd: entry.cwd,
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

  async clearSession(sessionId: string): Promise<void> {
    this.requireChild(sessionId);
    // No RPC command resets the conversation in place: the RPC prompt path
    // calls AgentSession.prompt directly without builtin slash expansion, so
    // sending "/clear" would reach the model as literal text instead of
    // executing the true /clear command path.
    throw new OperationNotSupportedError('clear');
  }

  async freshSession(sessionId: string): Promise<void> {
    this.requireChild(sessionId);
    // Same as clearSession: no RPC command rotates provider stream state, and
    // "/fresh" over RPC prompt would not execute the builtin /fresh handler.
    throw new OperationNotSupportedError('fresh');
  }

  async dropSession(sessionId: string): Promise<boolean> {
    const entry = this.children.get(sessionId);
    if (!entry) return false;
    this.children.delete(sessionId);
    let sessionFile: string | undefined;
    try {
      const state = await entry.child.request({ type: 'get_state' }, 5000);
      if (state.success) {
        const file = (state.data as { sessionFile?: unknown } | undefined)?.sessionFile;
        if (typeof file === 'string' && file) sessionFile = file;
      }
    } catch {
      /* child may already be gone; fall through to close */
    }
    try {
      entry.unsub();
    } catch {
      /* ignore */
    }
    entry.child.close();
    if (sessionFile) {
      try {
        await unlink(sessionFile);
      } catch {
        /* best-effort journal delete */
      }
    }
    return true;
  }

  async getTree(sessionId: string): Promise<SessionTree> {
    const entry = this.requireChild(sessionId);
    const state = await this.childState(entry);
    if (!state.sessionFile) return { nodes: [], leafId: null };
    let text: string;
    try {
      text = await readFile(state.sessionFile, 'utf8');
    } catch {
      return { nodes: [], leafId: null };
    }
    // The RPC surface exposes no tree command; read the durable JSONL journal
    // the child itself persists (leaf = last physical entry, matching the
    // session loader's own reconstruction rule).
    return sessionFileTextToTree(text);
  }

  async navigateTree(input: NavigateInput): Promise<void> {
    this.requireChild(input.sessionId);
    // No RPC command moves the leaf pointer within the same session file.
    throw new OperationNotSupportedError('navigateTree');
  }

  async branchSession(input: BranchInput): Promise<SessionInfo> {
    const entry = this.requireChild(input.sessionId);
    let entryId = input.parentId;
    if (!entryId) {
      // SDK branch() only accepts user-message entries: walk back from the
      // leaf to the nearest user message instead of branching the leaf.
      const tree = await this.getTree(input.sessionId);
      const byId = new Map(tree.nodes.map((node) => [node.id, node]));
      let cursor = tree.leafId === null ? undefined : byId.get(tree.leafId);
      while (cursor) {
        if (cursor.role === 'user') {
          entryId = cursor.id;
          break;
        }
        cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
      }
    }
    if (!entryId) throw new OperationNotSupportedError('branch');
    const res = await entry.child.request({ type: 'branch', entryId });
    assertRpcOk(res, input.sessionId);
    if ((res.data as { cancelled?: boolean } | undefined)?.cancelled) {
      throw new StreamingActiveError('agent is streaming; cannot branch the session now');
    }
    // Branch moves the child onto the new session file (interactive /branch
    // semantics): re-key the child under the new session id and rebind its
    // event mapping so later events carry the new id.
    const state = await this.childState(entry);
    const newId = state.sessionId;
    try {
      entry.unsub();
    } catch {
      /* ignore */
    }
    const unsub = entry.child.onNotification((frame) => {
      const event = mapSessionEventToAgentEvent(newId, frame);
      if (event) this.emit(event);
    });
    this.children.delete(input.sessionId);
    this.children.set(newId, { child: entry.child, sessionId: newId, cwd: entry.cwd, unsub });
    const now = new Date().toISOString();
    return {
      id: newId,
      cwd: entry.cwd,
      title: state.sessionName ?? 'New session',
      createdAt: now,
      updatedAt: now,
    };
  }

  async exportHtml(sessionId: string): Promise<string> {
    const entry = this.requireChild(sessionId);
    const res = await entry.child.request({ type: 'export_html' });
    assertRpcOk(res, sessionId);
    const rawPath = (res.data as { path?: unknown } | undefined)?.path;
    if (typeof rawPath !== 'string' || !rawPath) {
      throw new Error('omp rpc export_html returned no path');
    }
    // export_html reports paths relative to the child session cwd.
    const path = isAbsolute(rawPath) ? rawPath : resolve(entry.cwd, rawPath);
    return readFile(path, 'utf8');
  }

  async dumpSession(sessionId: string): Promise<string> {
    this.requireChild(sessionId);
    // No RPC command renders the /dump plain-text transcript (system prompt,
    // tools, full transcript live in child memory); reconstructing it
    // client-side would synthesize rather than call the real dump path.
    throw new OperationNotSupportedError('dump');
  }

  async shareSession(sessionId: string): Promise<string> {
    this.requireChild(sessionId);
    // No RPC command seals/uploads a share snapshot of the live session.
    throw new OperationNotSupportedError('share');
  }

  async renameSession(input: RenameInput): Promise<SessionInfo> {
    const entry = this.requireChild(input.sessionId);
    const res = await entry.child.request({ type: 'set_session_name', name: input.title });
    assertRpcOk(res, input.sessionId);
    const state = await this.childState(entry);
    const now = new Date().toISOString();
    return {
      id: state.sessionId,
      cwd: entry.cwd,
      title: state.sessionName ?? input.title,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getSessionFile(sessionId: string): Promise<string | null> {
    const entry = this.requireChild(sessionId);
    const state = await this.childState(entry);
    return state.sessionFile ?? null;
  }

  onEvent(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
    for (const [, entry] of this.children) {
      try {
        entry.unsub();
      } catch {
        /* ignore */
      }
      entry.child.close();
    }
    this.children.clear();
  }

  private requireChild(sessionId: string): ChildEntry {
    const entry = this.children.get(sessionId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    return entry;
  }

  private async childState(entry: ChildEntry): Promise<{
    sessionId: string;
    sessionName?: string;
    sessionFile?: string;
  }> {
    const res = await entry.child.request({ type: 'get_state' });
    assertRpcOk(res, entry.sessionId);
    const data = (res.data ?? {}) as {
      sessionId?: unknown;
      sessionName?: unknown;
      sessionFile?: unknown;
    };
    if (typeof data.sessionId !== 'string' || !data.sessionId) {
      throw new Error('omp rpc get_state returned no sessionId');
    }
    return {
      sessionId: data.sessionId,
      ...(typeof data.sessionName === 'string' && data.sessionName
        ? { sessionName: data.sessionName }
        : {}),
      ...(typeof data.sessionFile === 'string' && data.sessionFile
        ? { sessionFile: data.sessionFile }
        : {}),
    };
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
