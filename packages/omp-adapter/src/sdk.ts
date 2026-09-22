import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentEvent,
  AgentRuntime,
  ConflictEntry,
  MemoryOpInput,
  MemoryOpResult,
  MemoryState,
  ModelRef,
  RenameInput,
  ResolveConflictsInput,
  SessionModelState,
  SessionSkill,
  SessionStats,
  SessionWorkspace,
  SetModelInput,
  SetThinkingInput,
  SwitchModelInput,
  WorkspaceDirInput,
} from '@grove/agent-runtime';
import {
  InvalidRequestError,
  SessionNotFoundError,
  StreamingActiveError,
} from '@grove/agent-runtime';
import type { SessionInfo } from '@grove/core';
import {
  type AgentSession,
  createAgentSession,
  getAgentDir,
  SessionManager,
} from '@oh-my-pi/pi-coding-agent';
import {
  getModelMatchPreferences,
  resolveCliModel,
} from '@oh-my-pi/pi-coding-agent/config/model-resolver';
import { summarizeMentalModel } from '@oh-my-pi/pi-coding-agent/hindsight/mental-models';
import { resolveMemoryBackend } from '@oh-my-pi/pi-coding-agent/memory-backend/resolve';
import { registerPersistedSubagents } from '@oh-my-pi/pi-coding-agent/registry/persisted-agents';
import {
  CLI_THINKING_LEVELS,
  parseConfiguredThinkingLevel,
} from '@oh-my-pi/pi-coding-agent/thinking';
import { sdkSessionInfoToCore } from './mapping.js';
import {
  type AgentEventListener,
  runExclusive,
  type SessionEntry,
  SKILL_PREVIEW_LIMIT,
} from './sdk/helpers';
import { SdkModesBase } from './sdk/modes-base';
import { listConflictsImpl, resolveConflictsImpl, setSessionFile } from './tools.js';

export class SdkAdapter extends SdkModesBase implements AgentRuntime {
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
      // The configured selector (includes `auto`); `thinkingLevel` is the level
      // the running turn resolved and stays undefined until one starts, so a
      // client could not read back what it had just set.
      thinking: entry.session.configuredThinkingLevel() ?? entry.session.thinkingLevel ?? null,
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
        if (!primary)
          throw new InvalidRequestError('hindsight backend is not active for this session');
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

  protected async readMemory(session: AgentSession): Promise<MemoryState> {
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

  async switchSessionModel(input: SwitchModelInput): Promise<ModelRef> {
    const entry = await this.ensureSession(input.sessionId);
    const session = entry.session;
    const selector = input.selector.trim();
    if (!selector) throw new Error('Usage: /switch <model|provider/id|@role>[:level]');
    const scoped = session.scopedModels.map((item) => item.model);
    const resolved = resolveCliModel({
      cliModel: selector,
      modelRegistry: session.modelRegistry,
      ...(scoped.length > 0 ? { availableModels: scoped } : {}),
      settings: session.settings,
      preferences: getModelMatchPreferences(session.settings),
    });
    if (!resolved.model) {
      throw new Error(resolved.warning ?? `no model matches "${selector}"`);
    }
    const model = resolved.model;
    const current = session.model;
    if (current && current.provider === model.provider && current.id === model.id) {
      if (resolved.thinkingLevel) session.setThinkingLevel(resolved.thinkingLevel);
      return { provider: model.provider, id: model.id };
    }
    await session.setModelTemporary(model, resolved.thinkingLevel);
    return { provider: model.provider, id: model.id };
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

  async getThinkingLevel(input: { sessionId: string }): Promise<string> {
    const entry = await this.ensureSession(input.sessionId);
    return entry.session.configuredThinkingLevel() ?? entry.session.thinkingLevel ?? 'auto';
  }

  async setThinkingLevel(input: SetThinkingInput): Promise<string> {
    const entry = await this.ensureSession(input.sessionId);
    // The SDK owns the selector vocabulary (`auto` included, and unambiguous
    // abbreviations are accepted); reject anything it cannot parse.
    const level = parseConfiguredThinkingLevel(input.level);
    if (!level) {
      throw new InvalidRequestError(
        `unknown thinking level: ${input.level} (expected ${CLI_THINKING_LEVELS.join(' | ')})`,
      );
    }
    entry.session.setThinkingLevel(level, false);
    // The level is clamped to what the current model supports, and the SDK
    // reports nothing back when it cannot apply it — answering 200 with the
    // requested level would claim a change that never happened.
    const effective = entry.session.configuredThinkingLevel() ?? entry.session.thinkingLevel;
    if (!effective) {
      const model = entry.session.model;
      const label = model ? `${model.provider}/${model.id}` : 'the current model';
      const available = entry.session.getAvailableThinkingLevels();
      throw new InvalidRequestError(
        `thinking level ${level} is not available for ${label} (supported: ${['off', 'auto', ...available].join(' | ')})`,
      );
    }
    return effective;
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

  protected emit(event: AgentEvent): void {
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
  protected async restorePersistedAgents(session: AgentSession): Promise<void> {
    try {
      await registerPersistedSubagents(this.registry, session.sessionFile ?? null);
    } catch {
      /* the roster is best-effort: a corrupt journal must not block the session */
    }
  }

  protected async ensureSession(sessionId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const infos = await SessionManager.listAll();
    const info = infos.find((candidate) => candidate.id === sessionId);
    if (!info) throw new SessionNotFoundError(sessionId);
    const cwd = info.cwd || this.defaultCwd;
    if (cwd) mkdirSync(cwd, { recursive: true });
    const { session, setToolUIContext } = await runExclusive(() =>
      createAgentSession({
        ...(cwd ? { cwd } : {}),
        agentRegistry: this.registry,
      }),
    );
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
    if (!entry) throw new SessionNotFoundError(sessionId);
    return entry;
  }

  /** Subscribe events and register a live child session; returns its session id. */
  protected attach(session: AgentSession): string {
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
  protected async infoOf(session: AgentSession, sessionId: string): Promise<SessionInfo> {
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
