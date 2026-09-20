import { AsyncJobManager } from '@oh-my-pi/pi-coding-agent/async/job-manager';
import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import { AgentRegistry } from '@oh-my-pi/pi-coding-agent/registry/agent-registry';
import type { TodoPhase as SdkTodoPhase, ToolSession } from '@oh-my-pi/pi-coding-agent/tools';
import { sessionToolSettingOverrides } from './session-tool-settings.js';
import { artifactsDirForSessionFile } from './tool-helpers.js';

/**
 * Process-wide async job registry shared by every web session stub, so hub
 * jobsList/jobsCancel see tool-spawned async work (bash async, eval).
 */
export const sharedJobs = new AsyncJobManager({});

export interface BuildToolSessionOptions {
  cwd: string;
  sessionFile?: string | null;
  /**
   * Effective settings of the live session, snapshotted. Out-of-turn tools
   * consult user settings (security gate, memory backend, bash env, LSP), so
   * without this they would run against schema defaults instead of what the
   * session actually has.
   */
  settingsSeed?: Record<string, unknown>;
  /**
   * Model registry and auth storage of the live session. Tools such as
   * `security_scan` refuse to run without both, so they are threaded through
   * rather than left to the stub.
   */
  modelRegistry?: ToolSession['modelRegistry'];
  authStorage?: ToolSession['authStorage'];
  /** Live model getter: `security_scan` preflight refuses without one. */
  getActiveModel?: ToolSession['getActiveModel'];
}

/**
 * Live session settings, keyed by web session id. Registered by the SDK
 * adapter when a session attaches, read by the tool-session builder so
 * out-of-turn tools see the same effective settings the model does.
 */
const liveSessionSettings = new Map<string, Record<string, unknown>>();
const liveSessionRegistries = new Map<string, NonNullable<ToolSession['modelRegistry']>>();
const liveSessionAuth = new Map<string, NonNullable<ToolSession['authStorage']>>();

export function registerLiveSettings(
  sessionId: string,
  seed: Record<string, unknown>,
  registry?: NonNullable<ToolSession['modelRegistry']>,
  authStorage?: NonNullable<ToolSession['authStorage']>,
): void {
  liveSessionSettings.set(sessionId, seed);
  if (registry) liveSessionRegistries.set(sessionId, registry);
  // The registry owns the storage it was built with; derive when not passed.
  const auth = authStorage ?? registry?.authStorage;
  if (auth) liveSessionAuth.set(sessionId, auth);
}

export function liveRegistryFor(
  sessionId: string,
): NonNullable<ToolSession['modelRegistry']> | undefined {
  return liveSessionRegistries.get(sessionId);
}

export function liveAuthFor(
  sessionId: string,
): NonNullable<ToolSession['authStorage']> | undefined {
  return liveSessionAuth.get(sessionId);
}

const liveSessionModels = new Map<string, NonNullable<ToolSession['getActiveModel']>>();

export function registerLiveModel(
  sessionId: string,
  getActiveModel: NonNullable<ToolSession['getActiveModel']>,
): void {
  liveSessionModels.set(sessionId, getActiveModel);
}

export function liveModelFor(
  sessionId: string,
): NonNullable<ToolSession['getActiveModel']> | undefined {
  return liveSessionModels.get(sessionId);
}

export function liveSettingsFor(sessionId: string): Record<string, unknown> | undefined {
  return liveSessionSettings.get(sessionId);
}

/**
 * Live settings accessor for the attached session. The snapshot above is
 * frozen at attach time, so gates that the user can toggle mid-session
 * (`browser.enabled`, …) must read through this instead.
 */
const liveSettingsGetters = new Map<string, () => Settings>();

export function registerLiveSettingsGetter(sessionId: string, get: () => Settings): void {
  liveSettingsGetters.set(sessionId, get);
}

export function liveSettingsGetterFor(sessionId: string): (() => Settings) | undefined {
  return liveSettingsGetters.get(sessionId);
}

export function forgetLiveSettings(sessionId: string): void {
  liveSessionSettings.delete(sessionId);
}

export interface ToolSessionHandle {
  /** The shared session object: read→edit MUST reuse this exact instance. */
  readonly session: ToolSession;
  setSessionFile(file: string | null): void;
  getSessionFile(): string | null;
}

/**
 * In-memory Settings with the tool-surface overrides (no disk, no singleton).
 * When a live-session snapshot is available it is used as the base, so the
 * tools read the session's effective values; the overrides win where they
 * deliberately diverge (tool gating, xdev mounting, edit mode).
 */
export function buildToolSessionSettings(seed?: Record<string, unknown>): Settings {
  return Settings.isolated({ ...(seed ?? {}), ...sessionToolSettingOverrides() });
}

function cloneTodoPhases(phases: SdkTodoPhase[]): SdkTodoPhase[] {
  return phases.map((phase) => ({
    name: phase.name,
    tasks: phase.tasks.map((task) =>
      task.blocker !== undefined
        ? { content: task.content, status: task.status, blocker: task.blocker }
        : { content: task.content, status: task.status },
    ),
  }));
}

/**
 * Build the minimal ToolSession the SDK tool factories accept.
 *
 * Required ToolSession fields (per `src/tools/index.ts`): `cwd`, `hasUI`,
 * `getSessionFile`, `getSessionSpawns`, `settings`. Everything else is
 * optional and omitted except:
 * - `enableLsp: true` (paired with the `lsp.enabled: true` override, so the
 *   lsp tool builds and edit/write get LSP writethrough),
 * - `getTodoPhases`/`setTodoPhases` (in-memory per web session; the TodoTool
 *   reads/writes exactly these, falling back to `[]` without them),
 * - `getArtifactsDir` (derived from the session file via the SDK rule).
 *
 * The same handle (and its `session` object) MUST back every tool call for
 * one web session: the EditStore snapshot registry lives on the session
 * object, so read→edit tag continuity breaks if the object is rebuilt.
 * The cwd is the project root; the DAP side needs no session field (the
 * debug tool talks to the process-wide singleton manager).
 */
export function buildToolSession(options: BuildToolSessionOptions): ToolSessionHandle {
  let sessionFile = options.sessionFile ?? null;
  let todoPhases: SdkTodoPhase[] = [];
  // Sequential artifact ids per web session, matching the SDK's
  // `<id>.<toolType>.log` naming so list/read keep working.
  let artifactSeq = 0;
  const session: ToolSession = {
    cwd: options.cwd,
    hasUI: false,
    enableLsp: true,
    agentRegistry: AgentRegistry.global(),
    asyncJobManager: sharedJobs,
    getSessionFile: () => sessionFile,
    getSessionSpawns: () => '*',
    getTodoPhases: () => cloneTodoPhases(todoPhases),
    setTodoPhases: (phases) => {
      todoPhases = cloneTodoPhases(phases);
    },
    getArtifactsDir: () => artifactsDirForSessionFile(sessionFile),
    allocateOutputArtifact: async (toolType: string) => {
      // Full tool output is stored next to the journal, exactly like the TUI,
      // so truncated results stay retrievable through artifact://<id>.
      const dir = artifactsDirForSessionFile(sessionFile);
      if (!dir) return {};
      const id = String(++artifactSeq);
      return { id, path: `${dir}/${id}.${toolType}.log` };
    },
    settings: buildToolSessionSettings(options.settingsSeed),
    ...(options.modelRegistry ? { modelRegistry: options.modelRegistry } : {}),
    ...(options.authStorage ? { authStorage: options.authStorage } : {}),
    ...(options.getActiveModel ? { getActiveModel: options.getActiveModel } : {}),
  };
  return {
    session,
    setSessionFile(file) {
      sessionFile = file;
    },
    getSessionFile: () => sessionFile,
  };
}
