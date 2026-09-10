import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import type {
  AgentEvent,
  AgentRuntime,
  BranchInput,
  CreateSessionInput,
  GoalState,
  GoalStatus,
  ModelRef,
  NavigateInput,
  PromptInput,
  RenameInput,
  SessionModelState,
  SessionTree,
  SetGoalInput,
  SetModelInput,
  SetThinkingInput,
} from '@ai-gui/agent-runtime';
import {
  OperationNotSupportedError,
  SessionBusyError,
  SessionNotFoundError,
} from '@ai-gui/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';
import {
  AgentRegistry,
  type AgentSession,
  createAgentSession,
  SessionManager,
} from '@oh-my-pi/pi-coding-agent';
import { shareSession as uploadSharedSession } from '@oh-my-pi/pi-coding-agent/export/share';
import {
  collectToolCalls,
  flattenSessionTree,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  toChatMessage,
} from './mapping.js';

interface SessionEntry {
  session: AgentSession;
  unsubscribe: () => void;
}

type AgentEventListener = (event: AgentEvent) => void;

/** OMP GoalModeState shape (structural: only the fields we surface). */
interface OmpGoalState {
  enabled?: boolean;
  goal?: {
    id: string;
    objective: string;
    status: GoalStatus;
    tokenBudget?: number;
    tokensUsed: number;
  } | null;
}

function toGoalState(state: OmpGoalState | undefined | null): GoalState {
  if (!state?.goal) return { enabled: false, goal: null };
  const goal = state.goal;
  return {
    enabled: state.enabled === true,
    goal: {
      id: goal.id,
      objective: goal.objective,
      status: goal.status,
      ...(goal.tokenBudget !== undefined ? { tokenBudget: goal.tokenBudget } : {}),
      tokensUsed: goal.tokensUsed,
    },
  };
}

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
    // listAll (not cwd-scoped list): keep cross-workspace sessions visible.
    const infos = await SessionManager.listAll();
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
    const entry = await this.ensureSession(sessionId);
    const messages = entry.session.messages;
    let start = 0;
    if (cursor !== undefined && cursor !== '') {
      const parsed = Number(cursor);
      start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    const pageLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 100;
    const slice = messages.slice(start, start + pageLimit);
    const toolCalls = collectToolCalls(messages);
    const items = slice.map((message, index) => toChatMessage(message, start + index, toolCalls));
    const end = start + slice.length;
    return end < messages.length ? { items, nextCursor: String(end) } : { items };
  }

  async prompt(input: PromptInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    await entry.session.prompt(input.text, { streamingBehavior: 'steer' });
  }

  async abort(sessionId: string): Promise<void> {
    const entry = await this.ensureSession(sessionId);
    await entry.session.abort();
  }

  async forkSession(sessionId: string): Promise<SessionInfo> {
    const entry = await this.ensureSession(sessionId);
    const sourceFile = entry.session.sessionFile;
    if (!sourceFile) throw new OperationNotSupportedError('fork');
    const cwd = entry.session.sessionManager.getCwd();
    // Copy the journal (plus artifacts) into a fresh session file, then serve
    // it from a new child session; the original session keeps running.
    const forked = await SessionManager.forkFrom(sourceFile, cwd);
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
    const { session } = await createAgentSession({
      ...(cwd ? { cwd } : {}),
      agentRegistry: this.registry,
    });
    try {
      const switched = await session.switchSession(newFile);
      if (!switched) throw new Error('session switch was cancelled');
    } catch (err) {
      try {
        await session.dispose();
      } catch {
        /* best-effort teardown */
      }
      throw err;
    }
    const newId = this.attach(session);
    return this.infoOf(session, newId);
  }

  async clearSession(sessionId: string): Promise<void> {
    const entry = await this.ensureSession(sessionId);
    // True /clear path: drop every message from the model's context in place
    // (session id, title, cwd, and transcript file all survive).
    const result = await entry.session.resetSessionContext();
    if (!result) throw new SessionBusyError(sessionId);
  }

  async freshSession(sessionId: string): Promise<void> {
    const entry = await this.ensureSession(sessionId);
    // True /fresh path: rotate provider stream state, keep the transcript.
    const result = entry.session.freshSession();
    if (!result) throw new SessionBusyError(sessionId);
  }

  async getGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    return toGoalState(entry.session.getGoalModeState());
  }

  async setGoal(input: SetGoalInput): Promise<GoalState> {
    const entry = await this.ensureSession(input.sessionId);
    const runtime = entry.session.goalRuntime;
    const existing = entry.session.getGoalModeState();
    const state = existing?.goal
      ? await runtime.replaceGoal({ objective: input.objective, tokenBudget: input.tokenBudget })
      : await runtime.createGoal({ objective: input.objective, tokenBudget: input.tokenBudget });
    return toGoalState(state);
  }

  async pauseGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    return toGoalState(await entry.session.goalRuntime.pauseGoal());
  }

  async resumeGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    return toGoalState(await entry.session.goalRuntime.resumeGoal());
  }

  async dropGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    await entry.session.goalRuntime.dropGoal();
    return toGoalState(entry.session.getGoalModeState());
  }

  async dropSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return this.dropOrphanedJournal(sessionId);
    this.sessions.delete(sessionId);
    const file = entry.session.sessionFile;
    const manager = entry.session.sessionManager;
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
    if (file) {
      try {
        await manager.dropSession(file);
      } catch {
        try {
          await unlink(file);
        } catch {
          /* best-effort journal delete */
        }
      }
    }
    return true;
  }

  /** Delete the on-disk journal of a session with no live entry (post-restart drop). */
  private async dropOrphanedJournal(sessionId: string): Promise<boolean> {
    try {
      const infos = await SessionManager.listAll();
      const info = infos.find((candidate) => candidate.id === sessionId);
      if (!info) return false;
      await unlink(info.path);
      return true;
    } catch {
      return false;
    }
  }

  async getTree(sessionId: string): Promise<SessionTree> {
    const entry = await this.ensureSession(sessionId);
    const manager = entry.session.sessionManager;
    return { nodes: flattenSessionTree(manager.getTree()), leafId: manager.getLeafId() };
  }

  async navigateTree(input: NavigateInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    if (!entry.session.sessionManager.getEntry(input.leafId)) {
      throw new Error(`tree node not found: ${input.leafId}`);
    }
    await entry.session.navigateTree(input.leafId);
  }

  async branchSession(input: BranchInput): Promise<SessionInfo> {
    const entry = await this.ensureSession(input.sessionId);
    const manager = entry.session.sessionManager;
    const leafId = input.parentId ?? manager.getLeafId();
    if (!leafId) throw new OperationNotSupportedError('branch');
    if (input.parentId && !manager.getEntry(input.parentId)) {
      throw new Error(`tree node not found: ${input.parentId}`);
    }
    // New session file containing only the root→leaf path; served from a new
    // child session so the original session keeps running.
    const newFile = manager.createBranchedSession(leafId);
    if (!newFile) throw new OperationNotSupportedError('branch');
    const branchCwd = manager.getCwd();
    const { session } = await createAgentSession({
      ...(branchCwd ? { cwd: branchCwd } : {}),
      agentRegistry: this.registry,
    });
    try {
      const switched = await session.switchSession(newFile);
      if (!switched) throw new Error('session switch was cancelled');
    } catch (err) {
      try {
        await session.dispose();
      } catch {
        /* best-effort teardown */
      }
      throw err;
    }
    const newId = this.attach(session);
    return this.infoOf(session, newId);
  }

  async exportHtml(sessionId: string): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    const path = await entry.session.exportToHtml();
    return readFile(path, 'utf8');
  }

  async dumpSession(sessionId: string): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    // True /dump path: system prompt, model/tool inventory, full transcript.
    return entry.session.formatSessionAsText();
  }

  async shareSession(sessionId: string): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    // True /share path: seal (redacted when secrets are configured) and upload.
    const result = await uploadSharedSession(entry.session.sessionManager, {
      state: entry.session.state,
      ...(entry.session.obfuscator ? { obfuscator: entry.session.obfuscator } : {}),
    });
    return result.url;
  }

  async renameSession(input: RenameInput): Promise<SessionInfo> {
    const entry = await this.ensureSession(input.sessionId);
    await entry.session.setSessionName(input.title, 'user');
    return this.infoOf(entry.session, input.sessionId);
  }
  async getSessionModels(sessionId: string): Promise<SessionModelState> {
    const entry = await this.ensureSession(sessionId);
    const models: ModelRef[] = entry.session
      .getAvailableModels()
      .flatMap((m: { provider?: unknown; id?: unknown }) =>
        typeof m.provider === 'string' && typeof m.id === 'string'
          ? [{ provider: m.provider, id: m.id }]
          : [],
      );
    const current = entry.session.model as { provider?: unknown; id?: unknown } | undefined;
    return {
      models,
      current:
        current && typeof current.provider === 'string' && typeof current.id === 'string'
          ? { provider: current.provider, id: current.id }
          : null,
      thinking: entry.session.thinkingLevel ?? null,
    };
  }

  async setSessionModel(input: SetModelInput): Promise<ModelRef> {
    const entry = await this.ensureSession(input.sessionId);
    const found = entry.session
      .getAvailableModels()
      .find((m) => m.provider === input.provider && m.id === input.modelId);
    if (!found) throw new Error(`model not available: ${input.provider}/${input.modelId}`);
    await entry.session.setModel(found);
    return { provider: input.provider, id: input.modelId };
  }

  async setThinkingLevel(input: SetThinkingInput): Promise<string> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.setThinkingLevel(
      input.level as Parameters<typeof entry.session.setThinkingLevel>[0],
      false,
    );
    return entry.session.thinkingLevel ?? input.level;
  }

  async getSessionFile(sessionId: string): Promise<string | null> {
    const entry = await this.ensureSession(sessionId);
    return entry.session.sessionFile ?? null;
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

  /**
   * Session for an id, re-attaching transparently after a server restart by
   * opening the on-disk journal in a fresh AgentSession. Truly unknown ids
   * still 404.
   */
  private async ensureSession(sessionId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const infos = await SessionManager.listAll();
    const info = infos.find((candidate) => candidate.id === sessionId);
    if (!info) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    const cwd = info.cwd || this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session } = await createAgentSession({
      ...(cwd ? { cwd } : {}),
      agentRegistry: this.registry,
    });
    try {
      const switched = await session.switchSession(info.path);
      if (!switched) throw new Error(`session switch was cancelled: ${sessionId}`);
    } catch (err) {
      try {
        await session.dispose();
      } catch {
        /* best-effort teardown */
      }
      throw err;
    }
    const attachedId = this.attach(session);
    const entry = this.sessions.get(attachedId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    return entry;
  }

  /** Subscribe events and register a live child session; returns its session id. */
  private attach(session: AgentSession): string {
    const sessionId = session.sessionId;
    const unsubscribe = session.subscribe((event) => {
      const mapped = mapSessionEventToAgentEvent(sessionId, event as Record<string, unknown>);
      if (mapped) this.emit(mapped);
    });
    this.sessions.set(sessionId, { session, unsubscribe });
    return sessionId;
  }

  /** Describe a live child session, preferring on-disk listing timestamps. */
  private async infoOf(session: AgentSession, sessionId: string): Promise<SessionInfo> {
    const cwd = session.sessionManager.getCwd();
    try {
      const infos = await SessionManager.list(cwd);
      const found = infos.find((info) => info.id === sessionId);
      if (found) {
        return sdkSessionInfoToCore({
          id: found.id,
          cwd: found.cwd,
          title: found.title,
          firstMessage: found.firstMessage,
          created: found.created,
          modified: found.modified,
        });
      }
    } catch {
      /* fall through to synthesized info */
    }
    const now = new Date().toISOString();
    return {
      id: sessionId,
      cwd,
      title: session.sessionManager.getSessionName() ?? 'New session',
      createdAt: now,
      updatedAt: now,
    };
  }
}
