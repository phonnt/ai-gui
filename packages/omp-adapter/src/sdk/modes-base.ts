import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  BranchInput,
  BranchResult,
  ExtensionEntry,
  ForeignSession,
  GitStatusResult,
  InstalledMarketplacePlugin,
  LabelInput,
  MarketplacePlugin,
  MarketplacePluginInstall,
  MarketplacePluginUpdate,
  MarketplaceScope,
  MoveInput,
  NavigateInput,
  PlanDecisionInput,
  PlanDraft,
  PluginEntry,
  SessionModes,
  SessionToolInfo,
  SessionTree,
  SetFlagInput,
  SetQueueModesInput,
  ShareResult,
} from '@grove/agent-runtime';
import {
  InvalidRequestError,
  ModeConflictError,
  OperationNotSupportedError,
  SessionBusyError,
} from '@grove/agent-runtime';
import type { SessionInfo } from '@grove/core';
import { type AgentSession, createAgentSession, SessionManager } from '@oh-my-pi/pi-coding-agent';
import { parseNumstat } from '@oh-my-pi/pi-coding-agent/commit/git/diff';
import { formatModelString } from '@oh-my-pi/pi-coding-agent/config/model-resolver';
import {
  clearPluginRootsAndCaches,
  resolveOrDefaultProjectRegistryPath,
} from '@oh-my-pi/pi-coding-agent/discovery/helpers';
import { listOmpExtensionRoots } from '@oh-my-pi/pi-coding-agent/discovery/omp-extension-roots';
import { shareSession as uploadSharedSession } from '@oh-my-pi/pi-coding-agent/export/share';
import { listPlugins as listInstalledPlugins } from '@oh-my-pi/pi-coding-agent/extensibility/plugins/installer';
import { MarketplaceManager } from '@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/manager';
import {
  getInstalledPluginsRegistryPath,
  getMarketplacesCacheDir,
  getPluginsCacheDir,
  readInstalledPluginsRegistry,
} from '@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/registry';
import {
  buildPluginId,
  isValidNameSegment,
  parsePluginId,
} from '@oh-my-pi/pi-coding-agent/extensibility/plugins/marketplace/types';
import { resolvePlanTitle } from '@oh-my-pi/pi-coding-agent/plan-mode/approved-plan';
import { listPlanFiles, readPlanFile } from '@oh-my-pi/pi-coding-agent/plan-mode/plan-files';
import {
  createForeignSessionStore,
  persistForeignSession,
} from '@oh-my-pi/pi-coding-agent/session/foreign-session-import';
import {
  createSessionWorktree,
  defaultSessionWorktreeBranch,
} from '@oh-my-pi/pi-coding-agent/session/session-worktree';
import {
  addSSHHost,
  readSSHConfigFile,
  removeSSHHost,
  validateHostName,
} from '@oh-my-pi/pi-coding-agent/ssh/config-writer';
import {
  type VibeParentSession,
  VibeSessionRegistry,
} from '@oh-my-pi/pi-coding-agent/vibe/runtime';
import { getMarketplacesRegistryPath, getSSHConfigPath } from '@oh-my-pi/pi-utils';
import { flattenSessionTree, sdkSessionInfoToCore, textOfContent } from '../mapping.js';
import { settingsSnapshot } from '../settings.js';
import { runBashImpl } from '../tools/shell.js';
import { setSessionCwd } from '../tools.js';
import {
  registerLiveModel,
  registerLiveSettings,
  registerLiveSettingsGetter,
} from '../tools-session.js';

import { SdkGoalBase } from './goal-base';

import {
  buildBtwPrompt,
  DEFAULT_PLAN_URL,
  PLAN_EXECUTION_DIRECTIVE,
  readSessionModes,
  runExclusive,
} from './helpers';

export abstract class SdkModesBase extends SdkGoalBase {
  /** Implemented in `sdk.ts`. */
  protected abstract attach(session: AgentSession): string;
  protected abstract emit(event: AgentEvent): void;
  protected abstract infoOf(session: AgentSession, sessionId: string): Promise<SessionInfo>;
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
  protected async publishPlanProposal(
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

  async listForeignSessions(source: 'claude' | 'codex'): Promise<ForeignSession[]> {
    const store = createForeignSessionStore(source);
    const sessions = await store.list();
    return sessions.map((info) => ({
      source,
      id: info.id,
      path: info.path,
      cwd: info.cwd,
      title: info.title ?? info.firstMessage ?? info.id,
      createdAt: new Date(info.created).toISOString(),
      updatedAt: new Date(info.modified).toISOString(),
      messageCount: info.messageCount ?? 0,
      firstMessage: info.firstMessage ?? '',
    }));
  }

  async importForeignSession(input: {
    source: 'claude' | 'codex';
    path: string;
    fallbackCwd?: string;
  }): Promise<SessionInfo> {
    const store = createForeignSessionStore(input.source);
    const sessions = await store.list();
    const info = sessions.find((candidate) => candidate.path === input.path);
    if (!info) throw new Error(`${input.source} session not found: ${input.path}`);
    // Persisted copy under a fresh OMP identity: the source transcript is only
    // read. The fallback cwd covers a recorded directory that no longer exists.
    const imported = await persistForeignSession(store, info, {
      ...(input.fallbackCwd !== undefined ? { fallbackCwd: input.fallbackCwd } : {}),
    });
    const file = imported.getSessionFile();
    const id = imported.getSessionId();
    const cwd = imported.getCwd();
    await imported.close();
    if (!file) throw new Error('failed to persist the imported session');
    return sdkSessionInfoToCore({
      id,
      cwd,
      title: info.title ?? info.firstMessage ?? id,
      firstMessage: info.firstMessage,
      created: info.created,
      modified: info.modified,
      messageCount: info.messageCount ?? 0,
      size: 0,
      status: 'complete',
    });
  }

  /**
   * The hosts `/ssh` manages: one JSON file per scope (`getSSHConfigPath`), the
   * same file the `ssh://` read path consults.
   */
  /**
   * Working-tree state for the session cwd. Runs git through the same tool path
   * the agent's bash uses, so it inherits the session cwd and sandbox, and
   * parses numstat with the SDK's own parser instead of a second implementation.
   */
  async gitStatus(sessionId: string): Promise<GitStatusResult> {
    const empty: GitStatusResult = {
      branch: '',
      detached: false,
      entries: [],
      insertions: 0,
      deletions: 0,
    };
    // `git status` fails (exit 128) outside a repo, so it doubles as the probe:
    // one tool call fewer on the path the explorer hits on every session open.
    const porcelain = await this.runGit(sessionId, 'git status --porcelain=v1 --branch', 20_000);
    if (!porcelain.ok) return empty;
    const lines = porcelain.output.split('\n');
    const head = lines[0] ?? '';
    const detached = /^## HEAD \(no branch\)/.test(head);
    const branch = detached ? '' : (head.match(/^## ([^.\s]+)/)?.[1] ?? '');
    const entries = lines
      .slice(1)
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }));

    const numstat = await this.runGit(sessionId, 'git diff --numstat HEAD', 20_000);
    const stats = numstat.ok ? parseNumstat(numstat.output) : [];

    return {
      branch,
      detached,
      entries,
      insertions: stats.reduce((total, entry) => total + entry.additions, 0),
      deletions: stats.reduce((total, entry) => total + entry.deletions, 0),
    };
  }

  async gitDiff(sessionId: string, path: string): Promise<{ text: string }> {
    // Single quotes, not double: inside double quotes the shell still expands
    // `$(…)`, backticks and `${…}`, so a path like `pwned$(id).txt` would run.
    // A single quote cannot be escaped inside single quotes, so it is closed,
    // escaped and reopened — the standard `'\''` dance.
    const quoted = `'${path.replace(/'/g, "'\\''")}'`;
    const diff = await this.runGit(sessionId, `git diff -- ${quoted}`, 30_000);
    return { text: diff.ok ? diff.output : '' };
  }

  /** git refuses (not a repo, missing binary) as a non-zero exit: callers degrade. */
  private async runGit(
    sessionId: string,
    command: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; output: string }> {
    try {
      const result = await runBashImpl(sessionId, command, undefined, timeoutMs);
      return { ok: result.exitCode === 0, output: result.output };
    } catch {
      return { ok: false, output: '' };
    }
  }

  async listSshHosts(cwd: string, scope: 'user' | 'project'): Promise<string[]> {
    const path = getSSHConfigPath(scope, cwd);
    if (!existsSync(path)) return [];
    try {
      const config = await readSSHConfigFile(path);
      return Object.keys(config.hosts ?? {}).sort();
    } catch {
      // A corrupt file must not take the pane down: the UI shows an empty list,
      // and adding a host rewrites the file.
      return [];
    }
  }

  async addSshHost(input: {
    cwd: string;
    scope: 'user' | 'project';
    name: string;
    host: string;
    user?: string;
    port?: number;
  }): Promise<void> {
    const invalid = validateHostName(input.name);
    if (invalid) throw new InvalidRequestError(invalid);
    if (!input.host) throw new InvalidRequestError('host address cannot be empty');
    if ((await this.listSshHosts(input.cwd, input.scope)).includes(input.name)) {
      throw new InvalidRequestError(`ssh host already exists: ${input.name}`);
    }
    await addSSHHost(getSSHConfigPath(input.scope, input.cwd), input.name, {
      host: input.host,
      ...(input.user ? { username: input.user } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
    });
  }

  async removeSshHost(input: {
    cwd: string;
    scope: 'user' | 'project';
    name: string;
  }): Promise<void> {
    await removeSSHHost(getSSHConfigPath(input.scope, input.cwd), input.name);
  }

  async listPlugins(): Promise<PluginEntry[]> {
    // Two sources, because `listInstalledPlugins()` only walks the plugin
    // package.json: npm/link plugins come from there, while marketplace
    // installs live in installed_plugins.json and would otherwise never show.
    const installed = await listInstalledPlugins().catch((err: unknown) => {
      console.error('plugin discovery failed:', err);
      return [];
    });
    const entries: PluginEntry[] = installed.map((plugin) => ({
      name: plugin.name,
      ...(typeof plugin.version === 'string' ? { version: plugin.version } : {}),
      source: 'npm',
      enabled: plugin.enabled !== false,
    }));
    const registry = await readInstalledPluginsRegistry(getInstalledPluginsRegistryPath());
    for (const [id, installs] of Object.entries(registry.plugins)) {
      // Ids are `<name>@<marketplace>`; scoped names ( `@scope/pkg@market` )
      // mean the marketplace is the segment after the *last* `@`.
      const at = id.lastIndexOf('@');
      const name = at > 0 ? id.slice(0, at) : id;
      const marketplace = at > 0 ? id.slice(at + 1) : 'marketplace';
      if (entries.some((entry) => entry.name === name)) continue;
      const local = installs.find((entry) => entry.scope === 'user') ?? installs[0];
      entries.push({
        name,
        ...(typeof local?.version === 'string' ? { version: local.version } : {}),
        source: marketplace,
        enabled: local?.enabled !== false,
      });
    }
    for (const root of await this.extensionRoots()) {
      if (entries.some((entry) => entry.name === root.name)) continue;
      entries.push({ name: root.name, source: `omp:${root.level}`, enabled: true });
    }
    return entries;
  }

  /**
   * A `MarketplaceManager` for this process's config root, wired with the SDK's
   * own registry/cache paths (plus the active project's registry when the cwd
   * sits in one) so installs land exactly where the SDK looks for them. Built
   * per call: the manager holds only paths, and a cached instance would pin a
   * stale project registry after the session moves to a worktree.
   */
  protected async marketplaceManager(): Promise<MarketplaceManager> {
    const cwd = this.defaultCwd ?? process.cwd();
    return new MarketplaceManager({
      marketplacesRegistryPath: getMarketplacesRegistryPath(),
      installedRegistryPath: getInstalledPluginsRegistryPath(),
      projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(cwd),
      marketplacesCacheDir: getMarketplacesCacheDir(),
      pluginsCacheDir: getPluginsCacheDir(),
      clearPluginRootsCache: clearPluginRootsAndCaches,
    });
  }

  /**
   * Reject a malformed id before it reaches the manager: the manager's own
   * "Invalid plugin ID format" would otherwise surface as an upstream failure
   * (502) instead of a request error (400).
   */
  private assertMarketplacePluginId(pluginId: string): void {
    if (!parsePluginId(pluginId)) {
      throw new InvalidRequestError(`pluginId must be "<name>@<marketplace>": "${pluginId}"`);
    }
  }

  async listMarketplacePlugins(marketplace?: string): Promise<MarketplacePlugin[]> {
    const manager = await this.marketplaceManager();
    // `listAvailablePlugins()` returns catalog entries without naming their
    // marketplace, which makes the result un-installable and ambiguous across
    // sources — walk each configured marketplace and tag the plugin with it.
    const sources = marketplace
      ? [marketplace]
      : (await manager.listMarketplaces()).map((entry) => entry.name);
    const plugins: MarketplacePlugin[] = [];
    for (const source of sources) {
      for (const entry of await manager.listAvailablePlugins(source)) {
        plugins.push({
          name: entry.name,
          marketplace: source,
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.version ? { version: entry.version } : {}),
        });
      }
    }
    return plugins;
  }

  async installMarketplacePlugin(input: {
    pluginId: string;
    marketplace: string;
    scope?: MarketplaceScope;
  }): Promise<MarketplacePluginInstall> {
    if (!isValidNameSegment(input.pluginId)) {
      throw new InvalidRequestError(`pluginId must be a plugin name: "${input.pluginId}"`);
    }
    if (!isValidNameSegment(input.marketplace)) {
      throw new InvalidRequestError(
        `marketplace must be a marketplace name: "${input.marketplace}"`,
      );
    }
    const manager = await this.marketplaceManager();
    const entry = await manager.installPlugin(input.pluginId, input.marketplace, {
      scope: input.scope,
    });
    return { pluginId: buildPluginId(input.pluginId, input.marketplace), version: entry.version };
  }

  async listInstalledMarketplacePlugins(): Promise<InstalledMarketplacePlugin[]> {
    const manager = await this.marketplaceManager();
    const summaries = await manager.listInstalledPlugins();
    return summaries.map((summary) => {
      // Reinstalls append entries; the newest (index 0) carries the live version.
      const entry = summary.entries[0];
      return {
        id: summary.id,
        scope: summary.scope,
        ...(typeof entry?.version === 'string' ? { version: entry.version } : {}),
        enabled: entry?.enabled !== false,
        ...(summary.shadowedBy ? { shadowedBy: summary.shadowedBy } : {}),
      };
    });
  }

  async setMarketplacePluginEnabled(input: {
    pluginId: string;
    enabled: boolean;
    scope?: MarketplaceScope;
  }): Promise<void> {
    this.assertMarketplacePluginId(input.pluginId);
    const manager = await this.marketplaceManager();
    await manager.setPluginEnabled(input.pluginId, input.enabled, input.scope);
  }

  async uninstallMarketplacePlugin(input: {
    pluginId: string;
    scope?: MarketplaceScope;
  }): Promise<void> {
    this.assertMarketplacePluginId(input.pluginId);
    const manager = await this.marketplaceManager();
    await manager.uninstallPlugin(input.pluginId, input.scope);
  }

  async pluginUpdates(): Promise<MarketplacePluginUpdate[]> {
    const manager = await this.marketplaceManager();
    return manager.checkForUpdates();
  }

  async upgradeMarketplacePlugin(input: {
    pluginId: string;
    scope?: MarketplaceScope;
  }): Promise<MarketplacePluginInstall> {
    this.assertMarketplacePluginId(input.pluginId);
    const manager = await this.marketplaceManager();
    const entry = await manager.upgradePlugin(input.pluginId, input.scope);
    return { pluginId: input.pluginId, version: entry.version };
  }

  async listExtensions(): Promise<ExtensionEntry[]> {
    const roots = await this.extensionRoots();
    return roots.map((root) => ({ name: root.name, path: root.path, source: `omp:${root.level}` }));
  }

  /** Extension roots the SDK would load for this process (best-effort). */
  protected async extensionRoots(): Promise<{ path: string; name: string; level: string }[]> {
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
  protected async applyPlanRoleModel(sessionId: string, session: AgentSession): Promise<void> {
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
  protected async restorePlanRoleModel(sessionId: string, session: AgentSession): Promise<void> {
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
  protected shareSettingsWithTools(sessionId: string, session: AgentSession): void {
    try {
      registerLiveSettings(sessionId, settingsSnapshot(session.settings), session.modelRegistry);
      registerLiveSettingsGetter(sessionId, () => session.settings);
      // Read lazily: the model can change after attach (plan role, /model).
      registerLiveModel(sessionId, () => session.model);
    } catch {
      /* tool settings are a convenience: never break session attach */
    }
  }

  /** Structural adapter for the vibe registry (same shape the TUI assembles). */
  protected vibeParentSession(session: AgentSession): VibeParentSession {
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
  protected async dropOrphanedJournal(sessionId: string): Promise<boolean> {
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
      throw new InvalidRequestError(`tree node not found: ${input.leafId}`);
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
    if (!parent) throw new InvalidRequestError(`tree node not found: ${leafId}`);
    // TUI only branches user messages; the branch-point text becomes the new draft.
    const parentMessage =
      parent && typeof parent === 'object' && 'message' in parent ? parent.message : undefined;
    if (parentMessage?.role !== 'user') {
      throw new InvalidRequestError('branch requires a user message');
    }
    const draft = textOfContent(parentMessage.content);
    // New session file containing only the root→leaf path; served from a new
    // child session so the original session keeps running.
    const newFile = manager.createBranchedSession(leafId);
    if (!newFile) throw new OperationNotSupportedError('branch');
    const branchCwd = manager.getCwd();
    const { session, setToolUIContext } = await runExclusive(() =>
      createAgentSession({
        ...(branchCwd ? { cwd: branchCwd } : {}),
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
    return { session: info, draft: draft ? draft : null };
  }

  async labelTreeEntry(input: LabelInput): Promise<void> {
    const entry = await this.ensureSession(input.sessionId);
    entry.session.sessionManager.appendLabelChange(input.entryId, input.label || undefined);
  }
  async exportHtml(sessionId: string, userThemes?: boolean): Promise<string> {
    const entry = await this.ensureSession(sessionId);
    const journal = entry.session.sessionFile;
    if (!journal || !existsSync(journal)) {
      // Export used to fail here with a bare `not found`, which reads as a
      // missing session rather than a session with nothing to export yet.
      throw new InvalidRequestError('session has no journal yet, nothing to export');
    }
    // `exportToHtml()` writes into the process cwd when given no path, which
    // littered the server directory with 458 KB HTML files (and Biome linted
    // them). Write into a temp dir and read the result back.
    const dir = await mkdtemp(join(tmpdir(), 'grove-export-'));
    try {
      const written = await entry.session.exportToHtml(
        join(dir, 'session.html'),
        userThemes === true,
      );
      return await readFile(written, 'utf8');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * The export again, but the document stays on disk: the route streams it, so
   * a long session no longer becomes one multi-megabyte JSON body.
   */
  async exportHtmlFile(sessionId: string, userThemes?: boolean): Promise<{ path: string }> {
    const entry = await this.ensureSession(sessionId);
    const journal = entry.session.sessionFile;
    if (!journal || !existsSync(journal)) {
      throw new InvalidRequestError('session has no journal yet, nothing to export');
    }
    const dir = await mkdtemp(join(tmpdir(), 'grove-export-'));
    const path = join(dir, 'session.html');
    await entry.session.exportToHtml(path, userThemes === true);
    return { path };
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
}
