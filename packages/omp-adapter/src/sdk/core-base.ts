import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type {
  AgentEvent,
  ApprovalDecisionInput,
  CompactInput,
  CreateSessionInput,
  PromptInput,
  SessionModes,
  SetFlagInput,
} from '@grove/agent-runtime';
import { OperationNotSupportedError, SessionBusyError } from '@grove/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@grove/core';
import {
  AgentRegistry,
  type AgentSession,
  createAgentSession,
  SessionManager,
} from '@oh-my-pi/pi-coding-agent';
import type {
  ExtensionUIContext,
  ExtensionUISelectItem,
} from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types';
import { toInvalidRequestError } from '../client-errors.js';
import {
  collectToolCalls,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  sessionFileTextToMessages,
  toChatMessage,
} from '../mapping.js';
import { settingsGet } from '../settings.js';
import {
  createSessionTools,
  setApprovalBridge,
  setSessionCwd,
  setSessionFileResolver,
} from '../tools.js';

import {
  type AgentEventListener,
  APPROVAL_TIMEOUT_MS,
  GOAL_CONTINUATION_DELAY_MS,
  type GoalLoopState,
  type LoopRuntime,
  messageEntryIds,
  type OmpGoalState,
  type PendingApproval,
  pickApprovalChoice,
  runExclusive,
  type SessionEntry,
  toGoalState,
  type VibeState,
} from './helpers';

export abstract class SdkCoreBase {
  /** Implemented later in the chain (see `sdk.ts`). */
  protected abstract attach(session: AgentSession): string;
  protected abstract emit(event: AgentEvent): void;
  protected abstract ensureSession(sessionId: string): Promise<SessionEntry>;
  protected abstract infoOf(session: AgentSession, sessionId: string): Promise<SessionInfo>;
  protected abstract shareSettingsWithTools(sessionId: string, session: AgentSession): void;
  protected abstract runLoopIteration(sessionId: string): Promise<void>;
  /** Implemented in `sdk/modes-base.ts`. */
  protected abstract setPlanMode(input: SetFlagInput): Promise<SessionModes>;
  readonly kind = 'sdk' as const;
  protected readonly registry = new AgentRegistry();
  protected readonly sessions = new Map<string, SessionEntry>();
  protected readonly listeners = new Set<AgentEventListener>();
  protected readonly goalLoops = new Map<string, GoalLoopState>();
  protected readonly vibeStates = new Map<string, VibeState>();
  protected readonly planModelStates = new Map<
    string,
    {
      model?: Parameters<AgentSession['setModelTemporary']>[0];
      thinking?: Parameters<AgentSession['setThinkingLevel']>[0];
    }
  >();
  protected readonly loopStates = new Map<string, LoopRuntime>();
  protected readonly approvals = new Map<string, PendingApproval>();
  protected approvalSeq = 0;
  constructor(protected readonly defaultCwd?: string) {
    // Out-of-turn tools (write/edit/bash/eval routes) bypass the SDK's
    // ExtensionToolWrapper; they resolve approval through tools.ts, which
    // suspends here for the same web decision the in-turn gate uses.
    setApprovalBridge({
      requestApproval: (sessionId, toolName, prompt) =>
        this.requestApprovalBoolean(sessionId, toolName, prompt),
    });
    // The tools layer builds its table through a late-bound factory (tools/core);
    // `createSessionTools()` registers it. The server calls this at boot, but an
    // embedder that only drives the adapter would otherwise hit "tool table
    // factory not registered" on its first bash/file call.
    createSessionTools();
    // Journalled path is assigned lazily by the SDK; the tool layer re-reads it
    // so artifact links keep working for truncated output.
    setSessionFileResolver((id) => this.sessions.get(id)?.session.sessionFile ?? null);
  }

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const cwd = input.cwd ?? this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session, setToolUIContext } = await runExclusive(() =>
      createAgentSession({
        ...(cwd ? { cwd } : {}),
        agentRegistry: this.registry,
      }),
    );
    const sessionId = session.sessionId;
    this.installApprovalUI(sessionId, setToolUIContext);
    const unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(sessionId, event as Record<string, unknown>);
    });
    this.sessions.set(sessionId, { session, unsubscribe });
    // The tools layer resolves a session by its registered cwd (or its journal,
    // which a fresh session does not have yet), so register it here too — the
    // server does the same on its create path.
    if (cwd) setSessionCwd(sessionId, cwd);
    // Same publish step attach() does: createSession bypasses attach().
    this.shareSettingsWithTools(sessionId, session);
    // The TUI opens fresh interactive sessions in plan mode when
    // `plan.defaultOnStartup` is on (`src/modes/interactive-mode.ts`); this
    // process runs the SDK with no mode layer, so the adapter applies it.
    const planDefault = await settingsGet('plan.defaultOnStartup');
    if (planDefault.value === true && session.messages.length === 0) {
      await this.setPlanMode({ sessionId, enabled: true });
    }
    const now = new Date().toISOString();
    return {
      id: sessionId,
      cwd: cwd ?? '',
      title: 'New session',
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      sizeBytes: 0,
      status: 'pending',
    };
  }

  async listSessions(): Promise<SessionInfo[]> {
    // listAll (not cwd-scoped list): keep cross-workspace sessions visible.
    const infos = await SessionManager.listAll();
    const listed = infos.map((info) =>
      sdkSessionInfoToCore({
        id: info.id,
        cwd: info.cwd,
        title: info.title,
        firstMessage: info.firstMessage,
        created: info.created,
        modified: info.modified,
        messageCount: info.messageCount,
        size: info.size,
        status: info.status,
      }),
    );
    // `listAll` is a directory scan and a session keeps no journal until its
    // first message, so a session created a moment ago — or one forked from an
    // empty session — is missing from disk. Merge the live ones, or the caller
    // cannot see the session it just created (and reads of the fork source 404).
    const seen = new Set(listed.map((info) => info.id));
    for (const [sessionId, entry] of this.sessions) {
      if (seen.has(sessionId)) continue;
      listed.push(await this.infoOf(entry.session, sessionId));
    }
    return listed;
  }

  async getMessages(
    sessionId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Page<ChatMessage>> {
    const entry = await this.ensureSession(sessionId);
    const live = entry.session.messages;
    // Reattached sessions hold nothing live: serve the durable journal like
    // the RPC adapter does, or old transcripts render blank after a restart.
    // Indices stay global (start + i) so message ids are stable across pages.
    let start = 0;
    if (cursor !== undefined && cursor !== '') {
      const parsed = Number(cursor);
      start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    const pageLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 100;
    if (live.length > 0) {
      const visible = live.filter((message) => {
        if (!message || typeof message !== 'object') return true;
        return !('display' in message && message.display === false);
      });
      const toolCalls = collectToolCalls(visible);
      const slice = visible.slice(start, start + pageLimit);
      const entryIds = messageEntryIds(visible, entry.session);
      const items = slice.map((message, i) => {
        const chat = toChatMessage(message, start + i, toolCalls);
        const entryId = entryIds?.[start + i];
        return entryId ? { ...chat, entryId } : chat;
      });
      const end = start + slice.length;
      return end < visible.length ? { items, nextCursor: String(end) } : { items };
    }
    const file = entry.session.sessionFile;
    if (!file) return { items: [] };
    let all: ChatMessage[];
    try {
      all = sessionFileTextToMessages(await readFile(file, 'utf8'));
    } catch {
      return { items: [] };
    }
    const items = all.slice(start, start + pageLimit);
    const end = start + items.length;
    return end < all.length ? { items, nextCursor: String(end) } : { items };
  }

  async prompt(input: PromptInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    // Operator input takes over: drop a pending continuation and re-arm.
    this.cancelGoalContinuation(input.sessionId);
    this.goalLoopFor(input.sessionId).suppressNext = false;
    // TUI parity: Enter steers the live turn, Ctrl+Enter queues a follow-up.
    const turnPromise = entry.session.prompt(input.text, {
      streamingBehavior: input.behavior ?? 'steer',
      ...(input.images?.length
        ? {
            images: input.images.map((image) => ({
              type: 'image' as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          }
        : {}),
    });
    await turnPromise;
  }

  async abort(sessionId: string): Promise<void> {
    const entry = await this.ensureSession(sessionId);
    this.denySessionApprovals(sessionId);
    await entry.session.abort();
  }
  async forkSession(sessionId: string): Promise<SessionInfo> {
    const entry = await this.ensureSession(sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(sessionId);
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
    const { session, setToolUIContext } = await runExclusive(() =>
      createAgentSession({
        ...(cwd ? { cwd } : {}),
        agentRegistry: this.registry,
      }),
    );
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
    this.installApprovalUI(newId, setToolUIContext);
    const info = await this.infoOf(session, newId);
    // TUI fork moves the live ref to the new id: retire the source so only one
    // live session serves the transcript. That holds only while the source
    // journal is on disk — a session that never received a message has no file
    // yet, so retiring it would drop the session for good (404 + not listed).
    if (existsSync(sourceFile)) {
      this.sessions.delete(sessionId);
      this.cancelGoalContinuation(sessionId);
      this.goalLoops.delete(sessionId);
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
    return info;
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

  async compactSession(input: CompactInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    try {
      await entry.session.compact(input.instructions);
    } catch (err) {
      // "Nothing to compact (session too small)" is a caller precondition, not a fault.
      throw toInvalidRequestError(err) ?? err;
    }
  }

  async retryTurn(sessionId: string): Promise<boolean> {
    const entry = await this.ensureSession(sessionId);
    return entry.session.retry();
  }

  protected installApprovalUI(
    sessionId: string,
    setToolUIContext: ((ui: ExtensionUIContext, hasUI: boolean) => void) | undefined,
  ): void {
    if (!setToolUIContext) return;
    const ui: ExtensionUIContext = {
      select: (title, options) => this.requestApprovalDecision(sessionId, title, options),
      confirm: async () => false,
      input: async () => undefined,
      notify: () => {},
      onTerminalInput: () => () => {},
      setStatus: () => {},
      setWorkingMessage: () => {},
      setWidget: () => {},
      setTitle: () => {},
      custom: async () => undefined as never,
      setEditorText: () => {},
      pasteToEditor: () => {},
      getEditorText: () => '',
      editor: async () => undefined,
      addAutocompleteProvider: () => {},
      get theme() {
        return undefined as never;
      },
      getAllThemes: () => Promise.resolve([]),
      getTheme: () => Promise.resolve(undefined),
      setTheme: () => Promise.resolve({ success: false, error: 'UI not available' }),
      setFooter: () => {},
      setHeader: () => {},
      setEditorComponent: () => {},
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
    setToolUIContext(ui, true);
  }

  protected requestApprovalDecision(
    sessionId: string,
    title: string,
    options: ExtensionUISelectItem[],
  ): Promise<string | undefined> {
    const { promise, resolve } = Promise.withResolvers<string | undefined>();
    const approvalId = `appr-${Date.now().toString(36)}-${(this.approvalSeq++).toString(36)}`;
    const timer = setTimeout(() => {
      this.approvals.delete(approvalId);
      resolve(undefined);
    }, APPROVAL_TIMEOUT_MS);
    this.approvals.set(approvalId, { sessionId, options, resolve, timer });
    this.emit({ sessionId, kind: 'approval-request', approvalId, prompt: title });
    return promise;
  }

  /** Out-of-turn entry point: a deny/approve boolean for tools.ts. */
  protected async requestApprovalBoolean(
    sessionId: string,
    toolName: string,
    prompt: string,
  ): Promise<boolean> {
    const choice = await this.requestApprovalDecision(sessionId, `${toolName}\n\n${prompt}`, [
      'Approve',
      'Deny',
    ]);
    return choice === 'Approve';
  }

  async decideApproval(input: ApprovalDecisionInput): Promise<boolean> {
    const pending = this.approvals.get(input.approvalId);
    if (!pending || pending.sessionId !== input.sessionId) return false;
    this.approvals.delete(input.approvalId);
    clearTimeout(pending.timer);
    pending.resolve(pickApprovalChoice(pending.options, input.approved));
    return true;
  }

  /** Settle pending approvals as denied (abort/drop/dispose must not hang turns). */
  protected denySessionApprovals(sessionId: string): void {
    for (const [id, pending] of this.approvals) {
      if (pending.sessionId !== sessionId) continue;
      this.approvals.delete(id);
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
  }

  /**
   * Fan-out for raw SDK session events: mapped events go to WS listeners,
   * goal-loop bookkeeping stays in the adapter (it owns the session).
   */
  protected handleSessionEvent(sessionId: string, event: Record<string, unknown>): void {
    const mapped = mapSessionEventToAgentEvent(sessionId, event);
    if (mapped) this.emit(mapped);
    try {
      this.handleGoalLoopEvent(sessionId, event);
    } catch {
      /* goal loop must never break event delivery */
    }
  }

  protected goalLoopFor(sessionId: string): GoalLoopState {
    const existing = this.goalLoops.get(sessionId);
    if (existing) return existing;
    const fresh: GoalLoopState = {
      timer: undefined,
      suppressNext: false,
      continuationInFlight: false,
      hadToolCalls: false,
    };
    this.goalLoops.set(sessionId, fresh);
    return fresh;
  }

  protected cancelGoalContinuation(sessionId: string): void {
    const loop = this.goalLoops.get(sessionId);
    if (loop?.timer !== undefined) {
      clearTimeout(loop.timer);
      loop.timer = undefined;
    }
  }
  protected handleGoalLoopEvent(sessionId: string, event: Record<string, unknown>): void {
    const loop = this.goalLoopFor(sessionId);
    switch (event.type) {
      case 'agent_start':
        this.cancelGoalContinuation(sessionId);
        loop.hadToolCalls = false;
        return;
      case 'tool_execution_start':
        loop.hadToolCalls = true;
        if (!loop.continuationInFlight) loop.suppressNext = false;
        return;
      case 'message_start': {
        const message = event.message as { role?: unknown; synthetic?: unknown } | undefined;
        if (message?.role === 'user' && message.synthetic !== true) loop.suppressNext = false;
        return;
      }
      case 'goal_updated': {
        const state = event.state as OmpGoalState | undefined;
        if (state && state.enabled !== true) this.cancelGoalContinuation(sessionId);
        if (state?.goal?.status === 'complete') void this.exitGoalCompleted(sessionId);
        // Accounting flushes (budget-limited) and interrupt pauses happen
        // mid-turn; push them so the UI never shows a stale status.
        this.emit({
          sessionId,
          kind: 'goal',
          goal: toGoalState(state ?? { goal: (event.goal as OmpGoalState['goal']) ?? null }),
        });
        return;
      }
      case 'agent_end':
        void this.handleGoalTurnEnd(sessionId);
        return;
      default:
        return;
    }
  }

  protected async handleGoalTurnEnd(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const loop = this.goalLoopFor(sessionId);
    if (loop.continuationInFlight) {
      loop.suppressNext = !loop.hadToolCalls;
      loop.continuationInFlight = false;
    }
    const state = entry.session.getGoalModeState() as
      | { mode?: unknown; goal?: { status?: unknown } | null }
      | undefined;
    if (state?.mode === 'exiting' || state?.goal?.status === 'complete') {
      await this.exitGoalCompleted(sessionId);
      return;
    }
    if (this.loopStates.has(sessionId)) {
      await this.runLoopIteration(sessionId);
      return;
    }
    this.scheduleGoalContinuation(sessionId);
  }

  /** Mirror of the TUI `#exitGoalMode(completed)`: clear mode state + journal the completion. */
  protected async exitGoalCompleted(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    try {
      const raw = entry.session.getGoalModeState() as
        | {
            goal?: {
              status?: unknown;
              objective?: unknown;
              tokensUsed?: unknown;
              tokenBudget?: unknown;
            } | null;
            timeUsedSeconds?: unknown;
          }
        | undefined;
      if (raw?.goal?.status !== 'complete') return;
      this.cancelGoalContinuation(sessionId);
      entry.session.setGoalModeState(undefined);
      entry.session.sessionManager.appendModeChange('none');
      entry.session.sessionManager.appendCustomEntry('goal-completed', {
        objective: raw.goal.objective,
        tokensUsed: raw.goal.tokensUsed,
        tokenBudget: raw.goal.tokenBudget,
        timeUsedSeconds: typeof raw.timeUsedSeconds === 'number' ? raw.timeUsedSeconds : 0,
      });
    } catch {
      /* best-effort mirror of the TUI exit flow */
    }
  }

  /** Mirror of the TUI `#scheduleGoalContinuation`: idle 800ms, then a hidden continuation turn. */
  protected scheduleGoalContinuation(sessionId: string): void {
    this.cancelGoalContinuation(sessionId);
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const loop = this.goalLoopFor(sessionId);
    if (loop.suppressNext) return;
    const session = entry.session;
    const state = session.getGoalModeState();
    if (!state?.enabled || state.goal?.status !== 'active') return;
    if (session.getPlanModeState() !== undefined) return;
    const modes = session.settings.get('goal.continuationModes');
    if (!Array.isArray(modes) || !modes.includes('interactive')) return;
    const text = session.goalRuntime.buildContinuationPrompt();
    if (!text) return;
    loop.timer = setTimeout(() => {
      loop.timer = undefined;
      void this.fireGoalContinuation(sessionId, text);
    }, GOAL_CONTINUATION_DELAY_MS);
  }

  protected async fireGoalContinuation(sessionId: string, text: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const loop = this.goalLoopFor(sessionId);
    const session = entry.session;
    if (session.isStreaming || session.isCompacting || session.hasPostPromptWork) return;
    const state = session.getGoalModeState();
    if (!state?.enabled || state.goal?.status !== 'active') return;
    loop.continuationInFlight = true;
    loop.hadToolCalls = false;
    try {
      await session.promptCustomMessage(
        { customType: 'goal-continuation', content: text, display: false, attribution: 'agent' },
        { streamingBehavior: 'followUp' },
      );
    } catch {
      loop.continuationInFlight = false;
    }
  }
}
