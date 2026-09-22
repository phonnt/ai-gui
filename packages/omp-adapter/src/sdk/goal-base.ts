import type {
  GoalState,
  LoopState,
  SetGoalBudgetInput,
  SetGoalInput,
  StartLoopInput,
} from '@grove/agent-runtime';
import { ModeConflictError } from '@grove/agent-runtime';
import type { AgentSession } from '@oh-my-pi/pi-coding-agent';
import {
  consumeLoopLimitIteration,
  createLoopLimitRuntime,
  parseLoopLimitArgs,
} from '@oh-my-pi/pi-coding-agent/modes/loop-limit';
import { SdkCoreBase } from './core-base';
import { guidedGoalKickoff, toGoalState } from './helpers';

export abstract class SdkGoalBase extends SdkCoreBase {
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

  protected readLoop(sessionId: string, session: AgentSession): LoopState {
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
  protected async runLoopIteration(sessionId: string): Promise<void> {
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
}
