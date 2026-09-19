import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentEvent,
  AgentRuntime,
  ApprovalDecisionInput,
  BranchInput,
  BranchResult,
  CompactInput,
  ConflictEntry,
  CreateSessionInput,
  GoalState,
  GoalStatus,
  LabelInput,
  ModelRef,
  MoveInput,
  NavigateInput,
  PromptInput,
  RenameInput,
  ResolveConflictsInput,
  SessionModelState,
  SessionModes,
  SessionSkill,
  SessionStats,
  SessionTree,
  SetFlagInput,
  SetGoalInput,
  SetModelInput,
  SetQueueModesInput,
  SetThinkingInput,
  ShareResult,
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
import type {
  ExtensionUIContext,
  ExtensionUISelectItem,
} from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types';
import { registerPersistedSubagents } from '@oh-my-pi/pi-coding-agent/registry/persisted-agents';
import {
  collectToolCalls,
  flattenSessionTree,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  sessionFileTextToMessages,
  textOfContent,
  toChatMessage,
} from './mapping.js';
import {
  listConflictsImpl,
  resolveConflictsImpl,
  setApprovalBridge,
  setSessionFile,
  setSessionFileResolver,
} from './tools.js';

interface SessionEntry {
  session: AgentSession;
  unsubscribe: () => void;
}

type AgentEventListener = (event: AgentEvent) => void;

/** 800ms idle window before a goal continuation turn, mirroring the TUI. */
const GOAL_CONTINUATION_DELAY_MS = 800;

/**
 * Per-session goal continuation loop (TUI `#scheduleGoalContinuation` port).
 * The adapter owns it because it owns the session: after `agent_end` with an
 * active goal, a hidden `goal-continuation` turn is submitted automatically.
 */
interface GoalLoopState {
  timer: Timer | undefined;
  suppressNext: boolean;
  continuationInFlight: boolean;
  hadToolCalls: boolean;
}

/** Web round-trip timeout for one approval dialog (expiry denies, like a dismissed TUI dialog). */
const APPROVAL_TIMEOUT_MS = 120_000;

/** Skill preview cap (same order as the knowledge pane's). */
const SKILL_PREVIEW_LIMIT = 32_000;

interface PendingApproval {
  sessionId: string;
  options: ExtensionUISelectItem[];
  resolve: (choice: string | undefined) => void;
  timer: Timer;
}

/** Map a boolean decision onto the dialog labels (the approval gate uses Approve/Deny). */
function pickApprovalChoice(
  options: ExtensionUISelectItem[],
  approved: boolean,
): string | undefined {
  const labels = options.map((option) => (typeof option === 'string' ? option : option.label));
  const direct = labels.find((label) => label.toLowerCase() === (approved ? 'approve' : 'deny'));
  if (direct !== undefined) return direct;
  return approved ? labels[0] : labels[labels.length - 1];
}
/** Read toggleable agent modes off a live SDK session. */
function readSessionModes(session: AgentSession): SessionModes {
  return {
    plan: session.getPlanModeState()?.enabled === true,
    vibe: session.getVibeModeState()?.enabled === true,
    advisor: session.isAdvisorEnabled(),
    fast: session.isFastModeEnabled(),
    fastActive: session.isFastModeActive(),
    steering: session.steeringMode,
    followUp: session.followUpMode,
    interrupt: session.interruptMode,
    prewalkArmed: session.getPrewalkState() != null,
  };
}

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
  private readonly goalLoops = new Map<string, GoalLoopState>();
  private readonly approvals = new Map<string, PendingApproval>();
  private approvalSeq = 0;
  constructor(private readonly defaultCwd?: string) {
    // Out-of-turn tools (write/edit/bash/eval routes) bypass the SDK's
    // ExtensionToolWrapper; they resolve approval through tools.ts, which
    // suspends here for the same web decision the in-turn gate uses.
    setApprovalBridge({
      requestApproval: (sessionId, toolName, prompt) =>
        this.requestApprovalBoolean(sessionId, toolName, prompt),
    });
    // Journalled path is assigned lazily by the SDK; the tool layer re-reads it
    // so artifact links keep working for truncated output.
    setSessionFileResolver((id) => this.sessions.get(id)?.session.sessionFile ?? null);
  }

  async createSession(input: CreateSessionInput): Promise<SessionInfo> {
    const cwd = input.cwd ?? this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session, setToolUIContext } = await createAgentSession({
      ...(cwd ? { cwd } : {}),
      agentRegistry: this.registry,
    });
    const sessionId = session.sessionId;
    this.installApprovalUI(sessionId, setToolUIContext);
    const unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(sessionId, event as Record<string, unknown>);
    });
    this.sessions.set(sessionId, { session, unsubscribe });
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
    return infos.map((info) =>
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
      const items = slice.map((message, i) => toChatMessage(message, start + i, toolCalls));
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
    await entry.session.prompt(input.text, {
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
    const { session, setToolUIContext } = await createAgentSession({
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
    this.installApprovalUI(newId, setToolUIContext);
    const info = await this.infoOf(session, newId);
    // TUI fork moves the live ref to the new id: retire the source so only
    // one live session serves the transcript (its journal stays on disk).
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
    await entry.session.compact(input.instructions);
  }

  async retryTurn(sessionId: string): Promise<boolean> {
    const entry = await this.ensureSession(sessionId);
    return entry.session.retry();
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
    this.goalLoopFor(input.sessionId).suppressNext = false;
    // Replacing mid-turn steers the fresh context into the running turn,
    // mirroring the TUI streaming branch.
    if (entry.session.isStreaming) {
      await entry.session.sendGoalModeContext({ deliverAs: 'steer' });
    }
    return toGoalState(state);
  }

  async pauseGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    const state = toGoalState(await entry.session.goalRuntime.pauseGoal());
    this.cancelGoalContinuation(sessionId);
    return state;
  }

  async resumeGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    const state = toGoalState(await entry.session.goalRuntime.resumeGoal());
    this.goalLoopFor(sessionId).suppressNext = false;
    this.scheduleGoalContinuation(sessionId);
    return state;
  }

  async dropGoal(sessionId: string): Promise<GoalState> {
    const entry = await this.ensureSession(sessionId);
    await entry.session.goalRuntime.dropGoal();
    this.cancelGoalContinuation(sessionId);
    this.goalLoops.delete(sessionId);
    return toGoalState(entry.session.getGoalModeState());
  }

  /**
   * Interactive approval bridge: hands the SDK tool gate a web-backed
   * `select` dialog, mirroring the TUI approval prompt. All other UI
   * surfaces stay inert (the web client only answers approval selects).
   */
  private installApprovalUI(
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

  private requestApprovalDecision(
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
  private async requestApprovalBoolean(
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
  private denySessionApprovals(sessionId: string): void {
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
  private handleSessionEvent(sessionId: string, event: Record<string, unknown>): void {
    const mapped = mapSessionEventToAgentEvent(sessionId, event);
    if (mapped) this.emit(mapped);
    try {
      this.handleGoalLoopEvent(sessionId, event);
    } catch {
      /* goal loop must never break event delivery */
    }
  }

  private goalLoopFor(sessionId: string): GoalLoopState {
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

  private cancelGoalContinuation(sessionId: string): void {
    const loop = this.goalLoops.get(sessionId);
    if (loop?.timer !== undefined) {
      clearTimeout(loop.timer);
      loop.timer = undefined;
    }
  }
  private handleGoalLoopEvent(sessionId: string, event: Record<string, unknown>): void {
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
        const state = event.state as
          | { enabled?: unknown; goal?: { status?: unknown } | null }
          | undefined;
        if (state && state.enabled !== true) this.cancelGoalContinuation(sessionId);
        if (state?.goal?.status === 'complete') void this.exitGoalCompleted(sessionId);
        return;
      }
      case 'agent_end':
        void this.handleGoalTurnEnd(sessionId);
        return;
      default:
        return;
    }
  }

  private async handleGoalTurnEnd(sessionId: string): Promise<void> {
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
    this.scheduleGoalContinuation(sessionId);
  }

  /** Mirror of the TUI `#exitGoalMode(completed)`: clear mode state + journal the completion. */
  private async exitGoalCompleted(sessionId: string): Promise<void> {
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
  private scheduleGoalContinuation(sessionId: string): void {
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

  private async fireGoalContinuation(sessionId: string, text: string): Promise<void> {
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

  async getSessionModes(sessionId: string): Promise<SessionModes> {
    const entry = await this.ensureSession(sessionId);
    return readSessionModes(entry.session);
  }

  async setPlanMode(input: SetFlagInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.setPlanModeState(
      input.enabled
        ? {
            enabled: true,
            planFilePath: entry.session.getPlanReferencePath() || 'local://PLAN.md',
            workflow: 'parallel',
          }
        : undefined,
    );
    return readSessionModes(entry.session);
  }

  async setVibeMode(input: SetFlagInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.setVibeModeState(input.enabled ? { enabled: true } : undefined);
    return readSessionModes(entry.session);
  }

  async setAdvisorMode(input: SetFlagInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.setAdvisorEnabled(input.enabled);
    return readSessionModes(entry.session);
  }

  async setFastMode(input: SetFlagInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.setFastMode(input.enabled);
    return readSessionModes(entry.session);
  }

  async setQueueModes(input: SetQueueModesInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    if (input.steering !== undefined) entry.session.setSteeringMode(input.steering);
    if (input.followUp !== undefined) entry.session.setFollowUpMode(input.followUp);
    if (input.interrupt !== undefined) entry.session.setInterruptMode(input.interrupt);
    return readSessionModes(entry.session);
  }
  async dropSession(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return this.dropOrphanedJournal(sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(sessionId);
    this.sessions.delete(sessionId);
    this.cancelGoalContinuation(sessionId);
    this.goalLoops.delete(sessionId);
    this.denySessionApprovals(sessionId);
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
    const nodes = flattenSessionTree(manager.getTree()).map((node) => ({
      ...node,
      label: manager.getLabel(node.id),
    }));
    return { nodes, leafId: manager.getLeafId() };
  }

  async navigateTree(input: NavigateInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    if (!entry.session.sessionManager.getEntry(input.leafId)) {
      throw new Error(`tree node not found: ${input.leafId}`);
    }
    await entry.session.navigateTree(input.leafId);
  }
  async branchSession(input: BranchInput): Promise<BranchResult> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    const manager = entry.session.sessionManager;
    const leafId = input.parentId ?? manager.getLeafId();
    if (!leafId) throw new OperationNotSupportedError('branch');
    const parent = manager.getEntry(leafId);
    if (!parent) throw new Error(`tree node not found: ${leafId}`);
    // TUI only branches user messages; the branch-point text becomes the new draft.
    const parentMessage =
      parent && typeof parent === 'object' && 'message' in parent ? parent.message : undefined;
    if (parentMessage?.role !== 'user') {
      throw new Error('branch requires a user message');
    }
    const draft = textOfContent(parentMessage.content);
    // New session file containing only the root→leaf path; served from a new
    // child session so the original session keeps running.
    const newFile = manager.createBranchedSession(leafId);
    if (!newFile) throw new OperationNotSupportedError('branch');
    const branchCwd = manager.getCwd();
    const { session, setToolUIContext } = await createAgentSession({
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
    this.installApprovalUI(newId, setToolUIContext);
    const info = await this.infoOf(session, newId);
    return { session: info, draft: draft ? draft : null };
  }

  async labelTreeEntry(input: LabelInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.sessionManager.appendLabelChange(input.entryId, input.label || undefined);
  }
  async exportHtml(sessionId: string, userThemes?: boolean): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    const path = await entry.session.exportToHtml(undefined, userThemes === true);
    return readFile(path, 'utf8');
  }

  async moveSession(input: MoveInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    mkdirSync(input.cwd, { recursive: true });
    entry.session.sessionManager.setCwdWithoutRelocation(input.cwd);
  }

  async dumpSession(sessionId: string): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    // True /dump path: system prompt, model/tool inventory, full transcript.
    return entry.session.formatSessionAsText();
  }

  async shareSession(sessionId: string): Promise<ShareResult> {
    const entry = await this.ensureSession(sessionId);
    // True /share path: seal (redacted when secrets are configured) and upload.
    const result = await uploadSharedSession(entry.session.sessionManager, {
      state: entry.session.state,
      ...(entry.session.obfuscator ? { obfuscator: entry.session.obfuscator } : {}),
    });
    return {
      url: result.url,
      gistUrl: result.gistUrl ?? null,
      truncated: result.truncated,
    };
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

  async listConflicts(sessionId: string): Promise<ConflictEntry[]> {
    return listConflictsImpl(sessionId);
  }

  async resolveConflicts(input: ResolveConflictsInput): Promise<number> {
    return resolveConflictsImpl(input.sessionId, input.ids, input.side);
  }

  async getSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    const entry = await this.ensureSession(sessionId);
    return entry.session.skills.map((skill) => ({
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      source: skill.source,
    }));
  }

  async getSessionSkillContent(input: {
    sessionId: string;
    name: string;
    path?: string;
  }): Promise<{ content: string }> {
    const entry = await this.ensureSession(input.sessionId);
    const skill = entry.session.skills.find((candidate) => candidate.name === input.name);
    if (!skill) throw new Error(`unknown skill: ${input.name}`);
    const file = input.path
      ? join(skill.baseDir, input.path)
      : (skill.filePath ?? join(skill.baseDir, 'SKILL.md'));
    if (!file.startsWith(skill.baseDir)) {
      throw new Error(`path escapes skill directory: ${input.path}`);
    }
    const text = await readFile(file, 'utf8');
    return text.length <= SKILL_PREVIEW_LIMIT
      ? { content: text }
      : {
          content: `${text.slice(0, SKILL_PREVIEW_LIMIT)}\n\n…[truncated ${text.length - SKILL_PREVIEW_LIMIT} chars]`,
        };
  }

  async getSessionStats(sessionId: string): Promise<SessionStats> {
    const entry = await this.ensureSession(sessionId);
    const stats = entry.session.getSessionStats();
    const breakdown = entry.session.getContextBreakdown?.();
    return {
      sessionFile: stats.sessionFile ?? entry.session.sessionFile ?? null,
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        reasoning: stats.tokens.reasoning,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total,
      },
      cost: typeof stats.cost === 'number' ? stats.cost : 0,
      premiumRequests: stats.premiumRequests ?? 0,
      ...(stats.credits ? { credits: stats.credits } : {}),
      ...(stats.routedModels ? { routedModels: stats.routedModels } : {}),
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      totalMessages: stats.totalMessages,
      context: stats.contextUsage
        ? {
            tokens: stats.contextUsage.tokens,
            contextWindow: stats.contextUsage.contextWindow,
            percent: stats.contextUsage.percent,
          }
        : null,
      contextBreakdown: breakdown
        ? {
            contextWindow: breakdown.contextWindow,
            usedTokens: breakdown.usedTokens,
            anchored: breakdown.anchored,
            systemPromptTokens: breakdown.systemPromptTokens,
            systemToolsTokens: breakdown.systemToolsTokens,
            systemContextTokens: breakdown.systemContextTokens,
            skillsTokens: breakdown.skillsTokens,
            messagesTokens: breakdown.messagesTokens,
          }
        : null,
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
    for (const [id] of this.goalLoops) this.cancelGoalContinuation(id);
    this.goalLoops.clear();
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
    }
    this.approvals.clear();
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
  /**
   * Rebuild the parked-agent roster for a session from its journal, so the Hub
   * still lists (and can revive) subagents after a server restart.
   */
  private async restorePersistedAgents(session: AgentSession): Promise<void> {
    try {
      await registerPersistedSubagents(this.registry, session.sessionFile ?? null);
    } catch {
      /* the roster is best-effort: a corrupt journal must not block the session */
    }
  }

  private async ensureSession(sessionId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const infos = await SessionManager.listAll();
    const info = infos.find((candidate) => candidate.id === sessionId);
    if (!info) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    const cwd = info.cwd || this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session, setToolUIContext } = await createAgentSession({
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
    this.installApprovalUI(attachedId, setToolUIContext);
    await this.restorePersistedAgents(session);
    const entry = this.sessions.get(attachedId);
    if (!entry) throw new SessionNotFoundError(`session not found: ${sessionId}`);
    return entry;
  }

  /** Subscribe events and register a live child session; returns its session id. */
  private attach(session: AgentSession): string {
    const sessionId = session.sessionId;
    // Publish the journal path (lazily assigned by the SDK) to the tool layer:
    // it anchors the artifact directory, so truncated output keeps its link.
    setSessionFile(sessionId, session.sessionFile ?? null);
    const unsubscribe = session.subscribe((event) => {
      this.handleSessionEvent(sessionId, event as Record<string, unknown>);
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
      messageCount: session.messages.length,
      sizeBytes: 0,
      status: 'unknown',
      createdAt: now,
      updatedAt: now,
    };
  }
}
