import type { AgentEvent, GoalState, GoalStatus, SessionModes } from '@grove/agent-runtime';
import type { AgentSession } from '@oh-my-pi/pi-coding-agent';
import type { ExtensionUISelectItem } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types';
import type { LoopLimitRuntime } from '@oh-my-pi/pi-coding-agent/modes/loop-limit';
import type { VibeOwnerScope } from '@oh-my-pi/pi-coding-agent/vibe/runtime';

export interface SessionEntry {
  session: AgentSession;
  unsubscribe: () => void;
}

/**
 * The SDK registers every top-level session under one shared registry entry
 * (`Main`), so two concurrent initialisations replace each other and the loser
 * throws `Agent "Main" was replaced during session initialization.` Measured
 * before this queue: 5-7 of 8 parallel `POST /api/sessions` failed. Init is a
 * short local operation, so serialising it costs less than the failures.
 */
export let sessionInitQueue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = sessionInitQueue.then(work, work);
  sessionInitQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * Synthetic turn dispatched after a plan is approved. The plan body rides the
 * SDK's plan-reference message, so this only states the execution contract
 * (same wording as the TUI's approved-plan prompt).
 */
export const PLAN_EXECUTION_DIRECTIVE =
  'Plan approved. Execute the plan step-by-step with full tool access; verify each step before starting the next.';

/**
 * Fallback plan URL used when the session has not armed a plan reference yet.
 * Assembled from parts: writing the literal scheme in source lets path
 * resolution rewrite it into a concrete session path, which then leaks into
 * every other session.
 */
export const DEFAULT_PLAN_URL = ['local', '//PLAN.md'].join(':');

/** 800ms idle window before a goal continuation turn, mirroring the TUI. */
export const GOAL_CONTINUATION_DELAY_MS = 800;

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
export interface LoopRuntime {
  prompt: string;
  paused: boolean;
  limit: LoopLimitRuntime | undefined;
}

/**
 * Vibe-mode bookkeeping: the toolset to restore on exit and the worker scope
 * whose child sessions must be killed. Mirrors the TUI's
 * `#vibeModePreviousTools` / `#vibeModeOwnerScope`.
 */
export interface VibeState {
  previousTools: string[];
  scope: VibeOwnerScope;
}

export interface GoalLoopState {
  timer: Timer | undefined;
  suppressNext: boolean;
  continuationInFlight: boolean;
  hadToolCalls: boolean;
}

/** Web round-trip timeout for one approval dialog (expiry denies, like a dismissed TUI dialog). */
export const APPROVAL_TIMEOUT_MS = 120_000;

/** Skill preview cap (same order as the knowledge pane's). */
export const SKILL_PREVIEW_LIMIT = 32_000;

export interface PendingApproval {
  sessionId: string;
  options: ExtensionUISelectItem[];
  resolve: (choice: string | undefined) => void;
  timer: Timer;
}

/** Map a boolean decision onto the dialog labels (the approval gate uses Approve/Deny). */
export function pickApprovalChoice(
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
export function messageEntryIds(
  visible: readonly unknown[],
  session: AgentSession,
): string[] | null {
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
export function guidedGoalKickoff(initial: string | undefined): string {
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
export function buildBtwPrompt(question: string): string {
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
export function readSessionModes(session: AgentSession): SessionModes {
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
export interface OmpGoalState {
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

export function toGoalState(state: OmpGoalState | undefined | null): GoalState {
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
