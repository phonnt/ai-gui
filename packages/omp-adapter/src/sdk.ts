import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
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
  ExtensionEntry,
  GoalState,
  GoalStatus,
  LabelInput,
  LoopState,
  MemoryOpInput,
  MemoryOpResult,
  MemoryState,
  ModelRef,
  MoveInput,
  NavigateInput,
  PlanDecisionInput,
  PlanDraft,
  PluginEntry,
  PromptInput,
  RenameInput,
  ResolveConflictsInput,
  SessionModelState,
  SessionModes,
  SessionSkill,
  SessionStats,
  SessionToolInfo,
  SessionTree,
  SessionWorkspace,
  SetFlagInput,
  SetGoalBudgetInput,
  SetGoalInput,
  SetModelInput,
  SetQueueModesInput,
  SetThinkingInput,
  ShareResult,
  StartLoopInput,
  WorkspaceDirInput,
} from '@ai-gui/agent-runtime';
import {
  ModeConflictError,
  OperationNotSupportedError,
  SessionBusyError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@ai-gui/agent-runtime';
import type { ChatMessage, Page, SessionInfo } from '@ai-gui/core';
import {
  AgentRegistry,
  type AgentSession,
  createAgentSession,
  getAgentDir,
  SessionManager,
} from '@oh-my-pi/pi-coding-agent';
import { formatModelString } from '@oh-my-pi/pi-coding-agent/config/model-resolver';
import { listOmpExtensionRoots } from '@oh-my-pi/pi-coding-agent/discovery/omp-extension-roots';
import { shareSession as uploadSharedSession } from '@oh-my-pi/pi-coding-agent/export/share';
import type {
  ExtensionUIContext,
  ExtensionUISelectItem,
} from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types';
import { listPlugins as listInstalledPlugins } from '@oh-my-pi/pi-coding-agent/extensibility/plugins/installer';
import { summarizeMentalModel } from '@oh-my-pi/pi-coding-agent/hindsight/mental-models';
import { resolveMemoryBackend } from '@oh-my-pi/pi-coding-agent/memory-backend/resolve';
import {
  consumeLoopLimitIteration,
  createLoopLimitRuntime,
  type LoopLimitRuntime,
  parseLoopLimitArgs,
} from '@oh-my-pi/pi-coding-agent/modes/loop-limit';
import { resolvePlanTitle } from '@oh-my-pi/pi-coding-agent/plan-mode/approved-plan';
import { listPlanFiles, readPlanFile } from '@oh-my-pi/pi-coding-agent/plan-mode/plan-files';
import { registerPersistedSubagents } from '@oh-my-pi/pi-coding-agent/registry/persisted-agents';
import {
  createSessionWorktree,
  defaultSessionWorktreeBranch,
} from '@oh-my-pi/pi-coding-agent/session/session-worktree';
import {
  type VibeOwnerScope,
  type VibeParentSession,
  VibeSessionRegistry,
} from '@oh-my-pi/pi-coding-agent/vibe/runtime';
import {
  collectToolCalls,
  flattenSessionTree,
  mapSessionEventToAgentEvent,
  sdkSessionInfoToCore,
  sessionFileTextToMessages,
  textOfContent,
  toChatMessage,
} from './mapping.js';
import { settingsSnapshot } from './settings.js';
import {
  listConflictsImpl,
  resolveConflictsImpl,
  setApprovalBridge,
  setSessionCwd,
  setSessionFile,
  setSessionFileResolver,
} from './tools.js';
import { registerLiveModel, registerLiveSettings } from './tools-session.js';

interface SessionEntry {
  session: AgentSession;
  unsubscribe: () => void;
}

type AgentEventListener = (event: AgentEvent) => void;

/**
 * Synthetic turn dispatched after a plan is approved. The plan body rides the
 * SDK's plan-reference message, so this only states the execution contract
 * (same wording as the TUI's approved-plan prompt).
 */
const PLAN_EXECUTION_DIRECTIVE =
  'Plan approved. Execute the plan step-by-step with full tool access; verify each step before starting the next.';

/**
 * Fallback plan URL used when the session has not armed a plan reference yet.
 * Assembled from parts: writing the literal scheme in source lets path
 * resolution rewrite it into a concrete session path, which then leaks into
 * every other session.
 */
const DEFAULT_PLAN_URL = ['local', '//PLAN.md'].join(':');

/** 800ms idle window before a goal continuation turn, mirroring the TUI. */
const GOAL_CONTINUATION_DELAY_MS = 800;

/**
 * Per-session goal continuation loop (TUI `#scheduleGoalContinuation` port).
 * The adapter owns it because it owns the session: after `agent_end` with an
 * active goal, a hidden `goal-continuation` turn is submitted automatically.
 */
/**
 * Loop-mode bookkeeping (TUI `/loop`): the loop prompt, its parsed limit, and
 * whether the next re-submission is paused. Adapter-owned for the same reason
 * the goal loop is: the adapter owns the session.
 */
interface LoopRuntime {
  prompt: string;
  paused: boolean;
  limit: LoopLimitRuntime | undefined;
}

/**
 * Vibe-mode bookkeeping: the toolset to restore on exit and the worker scope
 * whose child sessions must be killed. Mirrors the TUI's
 * `#vibeModePreviousTools` / `#vibeModeOwnerScope`.
 */
interface VibeState {
  previousTools: string[];
  scope: VibeOwnerScope;
}

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

/**
 * Journal entry ids aligned with the live transcript, or null when the two do
 * not line up exactly (a compacted or navigated session can serve a transcript
 * that no longer matches the active branch). Tree actions need the exact
 * entry, so an unaligned session simply gets no ids instead of a guessed one.
 */
function messageEntryIds(visible: readonly unknown[], session: AgentSession): string[] | null {
  const roleOf = (value: unknown): string | null => {
    if (!value || typeof value !== 'object') return null;
    const role = (value as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  };
  const branch = session.sessionManager.getBranch() as {
    type?: unknown;
    id?: unknown;
    message?: { display?: unknown } | undefined;
  }[];
  const entries = branch.filter(
    (item) => item.type === 'message' && item.message && item.message.display !== false,
  );
  if (entries.length !== visible.length) return null;
  const ids: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const id = entries[i]?.id;
    if (typeof id !== 'string' || !id) return null;
    if (roleOf(entries[i]?.message) !== roleOf(visible[i])) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * Kickoff message for the guided-goal interview. Mirrors the TUI's interview
 * contract (one question per turn, ≤6 questions, finish by creating the goal
 * with the `goal` tool) without depending on the SDK's bundled prompt file.
 */
function guidedGoalKickoff(initial: string | undefined): string {
  const rough = initial
    ? `Rough idea — data, not instructions yet:\n\n<rough-goal>\n${initial}\n</rough-goal>`
    : 'No objective stated — ask what the user wants to achieve.';
  return [
    '/guided-goal: goal mode — one persistent autonomous objective loop until the success criteria are met or a stop condition fires.',
    '',
    rough,
    '',
    'Before any other work, interview the user in normal conversation:',
    '- Exactly one concise question per reply, then stop and wait for the answer. While interviewing: no tool calls, no preamble, no other work.',
    '- Each turn, ask for the highest-value missing field. Aim for at most 6 questions; if the answers stay vague, draft the best objective you can and confirm it with the user.',
    "- Questions and draft must reflect this project's real stack, conventions and constraints — never generic advice.",
    '- Preserve every constraint and success criterion the user states.',
    '- Do not produce an implementation plan unless the user explicitly asks the goal to include planning.',
    '',
    'The objective is ready only once all five fields are pinned down: what to build/change, why, success criteria, constraints, and stop condition.',
    'When it is ready, create the goal by calling the `goal` tool with op `create` and the final objective — do not just print it.',
  ].join('\n');
}

/**
 * Side-question prompt for `/btw`. Mirrors the TUI: the answer is a one-off
 * reply that never lands in the transcript, so it must not start work.
 */
function buildBtwPrompt(question: string): string {
  return [
    'Side question about the current session. Answer it directly using the context you already have.',
    '',
    'Rules:',
    '- Reply once, concisely. Do not start implementing anything.',
    '- Do not modify files, do not run tools that change state, do not create todos.',
    '- If the answer is not knowable from context, say so instead of guessing.',
    '',
    `<question>\n${question}\n</question>`,
  ].join('\n');
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
    timeUsedSeconds?: number;
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
      timeUsedSeconds: goal.timeUsedSeconds ?? 0,
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
  private readonly vibeStates = new Map<string, VibeState>();
  private readonly planModelStates = new Map<
    string,
    {
      model?: Parameters<AgentSession['setModelTemporary']>[0];
      thinking?: Parameters<AgentSession['setThinkingLevel']>[0];
    }
  >();
  private readonly loopStates = new Map<string, LoopRuntime>();
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
    // Same publish step attach() does: createSession bypasses attach().
    this.shareSettingsWithTools(sessionId, session);
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
    if (entry.session.getPlanModeState()?.enabled === true) {
      throw new ModeConflictError('exit plan mode first');
    }
    if (entry.session.settings.get('goal.enabled') !== true) {
      throw new ModeConflictError('goal mode is disabled in settings (goal.enabled)');
    }
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

  async getLoop(sessionId: string): Promise<LoopState> {
    const entry = await this.ensureSession(sessionId);
    return this.readLoop(sessionId, entry.session);
  }

  async startLoop(input: StartLoopInput): Promise<LoopState> {
    const entry = await this.ensureSession(input.sessionId);
    const parsed = parseLoopLimitArgs(input.limit ?? '');
    if (typeof parsed === 'string') throw new Error(parsed);
    const prompt = input.prompt.trim() || parsed.prompt?.trim() || '';
    if (!prompt) throw new Error('loop needs a prompt');
    this.loopStates.set(input.sessionId, {
      prompt,
      paused: false,
      limit: createLoopLimitRuntime(parsed.limit, Date.now()),
    });
    const state = this.readLoop(input.sessionId, entry.session);
    // The loop prompt runs now (TUI: the next prompt is re-submitted after
    // every yield); a running turn receives it as a steer.
    void entry.session.prompt(prompt, {
      streamingBehavior: entry.session.isStreaming ? 'steer' : undefined,
    });
    return state;
  }

  async stopLoop(sessionId: string): Promise<LoopState> {
    const entry = await this.ensureSession(sessionId);
    this.loopStates.delete(sessionId);
    return this.readLoop(sessionId, entry.session);
  }

  async pauseLoop(input: { sessionId: string; paused: boolean }): Promise<LoopState> {
    const entry = await this.ensureSession(input.sessionId);
    const loop = this.loopStates.get(input.sessionId);
    if (loop) loop.paused = input.paused;
    return this.readLoop(input.sessionId, entry.session);
  }

  private readLoop(sessionId: string, session: AgentSession): LoopState {
    const mode = session.settings.get('loop.mode');
    const resolvedMode: LoopState['mode'] =
      mode === 'compact' || mode === 'reset' ? mode : 'prompt';
    const loop = this.loopStates.get(sessionId);
    if (!loop) {
      return { active: false, paused: false, prompt: null, limit: null, mode: resolvedMode };
    }
    return {
      active: true,
      paused: loop.paused,
      prompt: loop.prompt,
      limit: loop.limit
        ? {
            kind: loop.limit.kind,
            ...(loop.limit.kind === 'iterations'
              ? { initial: loop.limit.initial, remaining: loop.limit.remaining }
              : { durationMs: loop.limit.durationMs, deadlineMs: loop.limit.deadlineMs }),
          }
        : null,
      mode: resolvedMode,
    };
  }

  /** Re-submit the loop prompt after a yielded turn (TUI `#runLoopIteration`). */
  private async runLoopIteration(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    const loop = this.loopStates.get(sessionId);
    if (!entry || !loop || loop.paused) return;
    const session = entry.session;
    if (session.isStreaming || session.isCompacting || session.hasPostPromptWork) return;
    const mode = session.settings.get('loop.mode');
    const action = mode === 'compact' || mode === 'reset' ? mode : 'prompt';
    if (action === 'reset' && session.getVibeModeState()?.enabled === true) {
      this.loopStates.delete(sessionId);
      return;
    }
    if (!consumeLoopLimitIteration(loop.limit, Date.now())) {
      this.loopStates.delete(sessionId);
      return;
    }
    try {
      if (action === 'compact') await session.compact();
      if (action === 'reset') await session.resetSessionContext();
    } catch {
      /* iteration context prep is best-effort; the prompt still re-runs */
    }
    await session.prompt(loop.prompt, { streamingBehavior: 'followUp' });
  }

  async startGuidedGoal(input: {
    sessionId: string;
    initial?: string;
  }): Promise<{ started: boolean }> {
    const entry = await this.ensureSession(input.sessionId);
    const session = entry.session;
    if (session.getPlanModeState()?.enabled === true) {
      throw new ModeConflictError('exit plan mode first');
    }
    if (session.getVibeModeState()?.enabled === true) {
      throw new ModeConflictError('exit vibe mode first');
    }
    if (session.settings.get('goal.enabled') !== true) {
      throw new ModeConflictError('goal mode is disabled in settings (goal.enabled)');
    }
    if (session.getGoalModeState()?.enabled === true) {
      throw new ModeConflictError('goal mode is already active');
    }
    // The interview ends with the agent calling `goal create`, so the goal
    // tool must be callable even though no goal exists yet.
    const enabled = session.getEnabledToolNames();
    if (!enabled.includes('goal')) {
      await session.setActiveToolsByName([...enabled, 'goal']);
    }
    const kickoff = guidedGoalKickoff(input.initial?.trim());
    if (session.isStreaming) {
      await session.followUp(kickoff, undefined, { synthetic: true });
    } else {
      await session.prompt(kickoff, { synthetic: true });
    }
    return { started: true };
  }

  async setGoalBudget(input: SetGoalBudgetInput): Promise<GoalState> {
    const entry = await this.ensureSession(input.sessionId);
    if (
      input.tokenBudget !== undefined &&
      (!Number.isInteger(input.tokenBudget) || input.tokenBudget <= 0)
    ) {
      throw new Error('goal budget must be a positive integer');
    }
    const state = await entry.session.goalRuntime.onBudgetMutated(input.tokenBudget);
    // Mirrors the TUI: a raised budget can reactivate the goal, so the
    // continuation loop is re-armed immediately.
    this.goalLoopFor(input.sessionId).suppressNext = false;
    this.scheduleGoalContinuation(input.sessionId);
    return toGoalState(state ?? entry.session.getGoalModeState());
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
    if (this.loopStates.has(sessionId)) {
      await this.runLoopIteration(sessionId);
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
    if (input.enabled) {
      const goal = entry.session.getGoalModeState();
      if (goal?.enabled === true) throw new ModeConflictError('exit goal mode first');
      if (entry.session.getVibeModeState()?.enabled === true) {
        throw new ModeConflictError('exit vibe mode first');
      }
      if (entry.session.settings.get('plan.enabled') !== true) {
        throw new ModeConflictError('plan mode is disabled in settings (plan.enabled)');
      }
      // The literal is assembled so nothing can resolve the scheme at write time.
      const planFilePath = entry.session.getPlanReferencePath() || DEFAULT_PLAN_URL;
      await this.applyPlanRoleModel(input.sessionId, entry.session);
      entry.session.setPlanModeState({
        enabled: true,
        planFilePath,
        workflow: 'parallel',
      });
      // Without a handler `write xd://propose` throws, so the agent could
      // never submit a plan and plan mode could never end. The handler mirrors
      // the TUI: resolve review details, then publish them to the client.
      entry.session.setPlanProposalHandler?.((title) =>
        this.publishPlanProposal(input.sessionId, title),
      );
      entry.session.sessionManager.appendModeChange('plan', { planFilePath });
    } else {
      entry.session.setPlanProposalHandler?.(null);
      entry.session.setPlanModeState(undefined);
      await this.restorePlanRoleModel(input.sessionId, entry.session);
      entry.session.sessionManager.appendModeChange('none');
    }
    return readSessionModes(entry.session);
  }

  /**
   * Resolve the proposed plan and hand it to the client for review. The
   * proposal itself is not a blocking confirmation in OMP (the TUI opens a
   * review overlay), so the handler returns immediately after emitting.
   */
  private async publishPlanProposal(
    sessionId: string,
    title: string,
  ): ReturnType<AgentSession['preparePlanForReview']> {
    const entry = await this.ensureSession(sessionId);
    const result = await entry.session.preparePlanForReview(title);
    const details = result.details as
      | { title?: string; planFilePath?: string; planExists?: boolean }
      | undefined;
    if (details?.planFilePath && details.title) {
      this.emit({
        sessionId,
        kind: 'plan-proposal',
        plan: {
          title: details.title,
          planFilePath: details.planFilePath,
          planExists: details.planExists === true,
        },
      });
    }
    return result;
  }

  async listPlugins(): Promise<PluginEntry[]> {
    // npm plugins carry version + enable state; extension roots cover the
    // marketplace/configured packages that are actually loaded.
    const installed = await listInstalledPlugins().catch(() => []);
    const entries: PluginEntry[] = installed.map((plugin) => ({
      name: plugin.name,
      ...(typeof plugin.version === 'string' ? { version: plugin.version } : {}),
      source: 'npm',
      enabled: plugin.enabled !== false,
    }));
    for (const root of await this.extensionRoots()) {
      if (entries.some((entry) => entry.name === root.name)) continue;
      entries.push({ name: root.name, source: `omp:${root.level}`, enabled: true });
    }
    return entries;
  }

  async listExtensions(): Promise<ExtensionEntry[]> {
    const roots = await this.extensionRoots();
    return roots.map((root) => ({ name: root.name, path: root.path, source: `omp:${root.level}` }));
  }

  /** Extension roots the SDK would load for this process (best-effort). */
  private async extensionRoots(): Promise<{ path: string; name: string; level: string }[]> {
    try {
      const roots = await listOmpExtensionRoots({
        cwd: this.defaultCwd ?? process.cwd(),
        home: homedir(),
        repoRoot: null,
      } as never);
      return roots.map((root) => ({ path: root.path, name: root.name, level: root.level }));
    } catch {
      return [];
    }
  }

  async askEphemeral(input: { sessionId: string; question: string }): Promise<{ reply: string }> {
    const entry = await this.ensureSession(input.sessionId);
    const question = input.question.trim();
    if (!question) throw new Error('Usage: /btw <question>');
    if (!entry.session.model) throw new Error('no active model available for /btw');
    const { replyText } = await entry.session.runEphemeralTurn({
      promptText: buildBtwPrompt(question),
    });
    return { reply: replyText };
  }

  async getSessionTools(sessionId: string): Promise<SessionToolInfo[]> {
    const entry = await this.ensureSession(sessionId);
    const active = new Set(entry.session.getActiveToolNames());
    return entry.session
      .getAllToolInfos()
      .map((info) => ({
        name: info.name,
        description: info.description,
        active: active.has(info.name),
        source:
          typeof (info.sourceInfo as { source?: unknown } | undefined)?.source === 'string'
            ? String((info.sourceInfo as { source: string }).source)
            : 'builtin',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getPlanDraft(sessionId: string): Promise<PlanDraft> {
    const entry = await this.ensureSession(sessionId);
    const session = entry.session;
    const localProtocolOptions = {
      getArtifactsDir: () => session.sessionManager.getArtifactsDir(),
      getSessionId: () => session.sessionManager.getSessionId(),
    };
    const armed = session.getPlanReferencePath();
    let planFilePath = armed && armed !== DEFAULT_PLAN_URL ? armed : undefined;
    if (!planFilePath) {
      // The agent names the file from its own title, so the newest local plan
      // is the fallback when nothing is armed yet.
      const [newest] = await listPlanFiles({ localProtocolOptions });
      planFilePath = newest;
    }
    if (!planFilePath) {
      return { planFilePath: '', title: '', content: '', exists: false };
    }
    const content = await readPlanFile(planFilePath, {
      localProtocolOptions,
      cwd: session.sessionManager.getCwd(),
    });
    const title = resolvePlanTitle({
      planContent: content ?? '',
      planFilePath,
    }).title;
    return {
      planFilePath,
      title,
      content: content ?? '',
      exists: content !== null,
    };
  }

  async decidePlan(input: PlanDecisionInput): Promise<{ executed: boolean }> {
    const entry = await this.ensureSession(input.sessionId);
    const session = entry.session;
    const planFilePath = session.getPlanReferencePath();
    session.setPlanProposalHandler?.(null);
    session.setPlanModeState(undefined);
    await this.restorePlanRoleModel(input.sessionId, session);
    session.sessionManager.appendModeChange('none');
    if (input.action === 'keep') return { executed: false };
    // The SDK injects the plan content itself on the next prompt while the
    // reference path is armed and unspent, so the directive stays short.
    if (planFilePath) session.setPlanReferencePath(planFilePath);
    await session.prompt(PLAN_EXECUTION_DIRECTIVE, { synthetic: true });
    return { executed: true };
  }

  async setVibeMode(input: SetFlagInput): Promise<SessionModes> {
    const entry = await this.ensureSession(input.sessionId);
    const session = entry.session;
    if (input.enabled) {
      if (session.getPlanModeState()?.enabled === true) {
        throw new ModeConflictError('exit plan mode first');
      }
      if (session.getGoalModeState()?.enabled === true) {
        throw new ModeConflictError('exit goal mode first');
      }
      const registry = VibeSessionRegistry.global();
      const scope = registry.ownerScope(this.vibeParentSession(session));
      registry.activateScope(scope);
      const previousTools = session.getEnabledToolNames();
      // The director drives workers through the ephemeral vibe_* tools and
      // reads their output; it must not edit the workspace itself.
      const baseTools = ['read'];
      if (session.hasBuiltInTool('todo')) baseTools.push('todo');
      await session.activateVibeTools(baseTools);
      this.vibeStates.set(input.sessionId, { previousTools, scope });
      session.setVibeModeState({ enabled: true });
      if (session.isStreaming) await session.sendVibeModeContext({ deliverAs: 'steer' });
      session.sessionManager.appendModeChange('vibe', { previousTools });
      return readSessionModes(session);
    }

    const state = this.vibeStates.get(input.sessionId);
    // Teardown with the queued-message drain suppressed, so an abort cannot
    // restart a turn on tools that are about to be uninstalled.
    await session.runModeExitTeardown(async () => {
      if (session.isStreaming) await session.abort();
      if (state) {
        await VibeSessionRegistry.global().killAll(this.vibeParentSession(session), state.scope);
      }
      await session.deactivateVibeTools(state?.previousTools ?? []);
      session.setVibeModeState(undefined);
    });
    this.vibeStates.delete(input.sessionId);
    session.sessionManager.appendModeChange('none');
    return readSessionModes(session);
  }

  /** Move the session onto the `plan` role model, remembering what to restore. */
  private async applyPlanRoleModel(sessionId: string, session: AgentSession): Promise<void> {
    const resolved = session.resolveRoleModelWithThinking('plan');
    if (!resolved.model) return;
    const current = session.model;
    this.planModelStates.set(sessionId, {
      ...(current ? { model: current } : {}),
      thinking: session.configuredThinkingLevel(),
    });
    const sameModel =
      current !== undefined &&
      current.provider === resolved.model.provider &&
      current.id === resolved.model.id;
    if (sameModel) {
      session.setThinkingLevel(resolved.thinkingLevel);
      return;
    }
    await session.setModelTemporary(resolved.model, resolved.thinkingLevel);
  }

  /** Restore the pre-plan model when plan mode ends. */
  private async restorePlanRoleModel(sessionId: string, session: AgentSession): Promise<void> {
    const previous = this.planModelStates.get(sessionId);
    this.planModelStates.delete(sessionId);
    if (!previous?.model) return;
    const current = session.model;
    if (
      current &&
      current.provider === previous.model.provider &&
      current.id === previous.model.id
    ) {
      session.setThinkingLevel(previous.thinking);
      return;
    }
    await session.setModelTemporary(previous.model, previous.thinking);
  }

  /**
   * Publish the session's effective settings to the out-of-turn tool session.
   * Called on attach and after any settings-affecting operation, because the
   * tools read the snapshot at build time.
   */
  private shareSettingsWithTools(sessionId: string, session: AgentSession): void {
    try {
      registerLiveSettings(sessionId, settingsSnapshot(session.settings), session.modelRegistry);
      // Read lazily: the model can change after attach (plan role, /model).
      registerLiveModel(sessionId, () => session.model);
    } catch {
      /* tool settings are a convenience: never break session attach */
    }
  }

  /** Structural adapter for the vibe registry (same shape the TUI assembles). */
  private vibeParentSession(session: AgentSession): VibeParentSession {
    return {
      getAgentId: () => session.getAgentId() ?? null,
      getSessionId: () => session.sessionManager.getSessionId(),
      getSessionFile: () => session.sessionManager.getSessionFile() ?? null,
      sessionManager: session.sessionManager,
      ...(session.asyncJobManager ? { asyncJobManager: session.asyncJobManager } : {}),
      settings: session.settings,
      getActiveModelString: () => (session.model ? formatModelString(session.model) : undefined),
      getModelString: () => (session.model ? formatModelString(session.model) : undefined),
    };
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

  async moveToWorktree(input: {
    sessionId: string;
    branch?: string;
  }): Promise<{ path: string; branch: string }> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    const manager = entry.session.sessionManager;
    const sourceCwd = manager.getCwd();
    const branch = input.branch?.trim() || defaultSessionWorktreeBranch();
    const worktree = await createSessionWorktree(sourceCwd, entry.session.settings, branch);
    // The session follows the checkout: the worktree becomes the new cwd, and
    // the source checkout is left untouched (no cleanup of the source tree).
    manager.setCwdWithoutRelocation(worktree.path);
    // Out-of-turn tools hold their own cwd; without this they keep reading and
    // writing the checkout the session just left.
    setSessionCwd(input.sessionId, worktree.path);
    this.shareSettingsWithTools(input.sessionId, entry.session);
    return { path: worktree.path, branch: worktree.branch };
  }

  async moveSession(input: MoveInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) throw new SessionBusyError(input.sessionId);
    mkdirSync(input.cwd, { recursive: true });
    entry.session.sessionManager.setCwdWithoutRelocation(input.cwd);
    setSessionCwd(input.sessionId, input.cwd);
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

  async getMemory(sessionId: string): Promise<MemoryState> {
    const entry = await this.ensureSession(sessionId);
    return this.readMemory(entry.session);
  }

  /**
   * `/memory` surface. Every call runs against the live session's own settings
   * and passes the session through, because backends (mnemopi, hindsight) key
   * their state off it and report "not initialised" without one.
   */
  async runMemoryOp(input: MemoryOpInput): Promise<MemoryOpResult> {
    const entry = await this.ensureSession(input.sessionId);
    const session = entry.session;
    const settings = session.settings;
    const backend = await resolveMemoryBackend(settings);
    const agentDir = getAgentDir();
    const cwd = session.sessionManager.getCwd();
    const context = { agentDir, cwd, session };
    switch (input.op) {
      case 'status':
        return { backend: backend.id, result: (await backend.status?.(context)) ?? null };
      case 'view':
        return {
          backend: backend.id,
          result: (await backend.buildDeveloperInstructions(agentDir, settings, session)) ?? null,
        };
      case 'stats':
        return {
          backend: backend.id,
          result: (await backend.stats?.(agentDir, cwd, session)) ?? null,
        };
      case 'diagnose':
        return {
          backend: backend.id,
          result: (await backend.diagnose?.(agentDir, cwd, session)) ?? null,
        };
      case 'queue':
        return { backend: backend.id, result: (await backend.queuePreview?.(context)) ?? null };
      case 'clear':
        await backend.clear(agentDir, cwd, session);
        // The injected memory block is part of the system prompt.
        await session.refreshBaseSystemPrompt();
        return { backend: backend.id, result: 'cleared' };
      case 'enqueue':
        await backend.enqueue(agentDir, cwd, session);
        return { backend: backend.id, result: 'enqueued' };
      case 'mm-list':
      case 'mm-show':
      case 'mm-history':
      case 'mm-refresh':
      case 'mm-delete': {
        const hindsight = session.getHindsightSessionState();
        const primary = hindsight && !hindsight.aliasOf ? hindsight : undefined;
        if (!primary) throw new Error('hindsight backend is not active for this session');
        const client = primary.client;
        const bankId = primary.bankId;
        const id = input.query?.trim();
        switch (input.op) {
          case 'mm-list': {
            const response = await client.listMentalModels(bankId, { detail: 'metadata' });
            const items = (response.items ?? []).map((model) => ({
              id: model.id,
              summary: summarizeMentalModel(model),
            }));
            return { backend: backend.id, result: { bankId, items } };
          }
          case 'mm-show': {
            if (!id) throw new Error('Usage: /memory mm show <id>');
            const model = await client.getMentalModel(bankId, id, { detail: 'content' });
            if (!model) throw new Error(`mental model not found: ${id}`);
            return { backend: backend.id, result: model };
          }
          case 'mm-history': {
            if (!id) throw new Error('Usage: /memory mm history <id>');
            return { backend: backend.id, result: await client.getMentalModelHistory(bankId, id) };
          }
          case 'mm-refresh': {
            if (!id) throw new Error('Usage: /memory mm refresh <id>');
            return { backend: backend.id, result: await client.refreshMentalModel(bankId, id) };
          }
          default: {
            if (!id) throw new Error('Usage: /memory mm delete <id>');
            return {
              backend: backend.id,
              result: { deleted: await client.deleteMentalModel(bankId, id) },
            };
          }
        }
      }
      case 'search': {
        if (!input.query?.trim()) throw new Error('query is required for memory search');
        if (!backend.search)
          throw new Error(`memory backend ${backend.id} does not support search`);
        const options = input.limit !== undefined ? { limit: input.limit } : undefined;
        return { backend: backend.id, result: await backend.search(context, input.query, options) };
      }
      default:
        throw new Error(`unsupported memory op: ${String(input.op)}`);
    }
  }

  async setMemoryBackend(input: { sessionId: string; backend: string }): Promise<MemoryState> {
    const entry = await this.ensureSession(input.sessionId);
    // Session-scoped write: the live session must be re-initialised, which the
    // generic settings plane cannot do (it only persists the key).
    entry.session.settings.set('memory.backend', input.backend as never);
    await entry.session.applyMemoryBackend();
    this.shareSettingsWithTools(input.sessionId, entry.session);
    return this.readMemory(entry.session);
  }

  private async readMemory(session: AgentSession): Promise<MemoryState> {
    const backend = await resolveMemoryBackend(session.settings);
    const status = await backend.status?.({
      agentDir: getAgentDir(),
      cwd: session.sessionManager.getCwd(),
      session,
    });
    return { backend: backend.id, status: status ?? null };
  }

  async getWorkspace(sessionId: string): Promise<SessionWorkspace> {
    const entry = await this.ensureSession(sessionId);
    return {
      cwd: entry.session.sessionManager.getCwd(),
      directories: entry.session.sessionManager.getAdditionalDirectories(),
    };
  }

  async addWorkspaceDirectory(
    input: WorkspaceDirInput,
  ): Promise<{ added: string | null; workspace: SessionWorkspace }> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) {
      throw new StreamingActiveError('cannot change the workspace while streaming');
    }
    // Throws for the primary root; the SDK validates and normalizes the path.
    const added = await entry.session.sessionManager.addWorkspaceDirectory(input.path);
    if (added !== null) await entry.session.refreshBaseSystemPrompt();
    return { added, workspace: await this.getWorkspace(input.sessionId) };
  }

  async removeWorkspaceDirectory(
    input: WorkspaceDirInput,
  ): Promise<{ removed: string | null; workspace: SessionWorkspace }> {
    const entry = await this.ensureSession(input.sessionId);
    if (entry.session.isStreaming) {
      throw new StreamingActiveError('cannot change the workspace while streaming');
    }
    const removed = await entry.session.sessionManager.removeWorkspaceDirectory(input.path);
    if (removed !== null) await entry.session.refreshBaseSystemPrompt();
    return { removed, workspace: await this.getWorkspace(input.sessionId) };
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
    this.shareSettingsWithTools(sessionId, session);
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
