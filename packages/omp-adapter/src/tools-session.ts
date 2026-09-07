import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import type { TodoPhase as SdkTodoPhase, ToolSession } from '@oh-my-pi/pi-coding-agent/tools';
import { sessionToolSettingOverrides } from './session-tool-settings.js';
import { artifactsDirForSessionFile } from './tool-helpers.js';

export interface BuildToolSessionOptions {
  cwd: string;
  sessionFile?: string | null;
}

export interface ToolSessionHandle {
  /** The shared session object: read→edit MUST reuse this exact instance. */
  readonly session: ToolSession;
  setSessionFile(file: string | null): void;
  getSessionFile(): string | null;
}

/** In-memory Settings with the tool-surface overrides (no disk, no singleton). */
export function buildToolSessionSettings(): Settings {
  return Settings.isolated(sessionToolSettingOverrides());
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
 * - `enableLsp: false` (paired with the `lsp.enabled: false` override),
 * - `getTodoPhases`/`setTodoPhases` (in-memory per web session; the TodoTool
 *   reads/writes exactly these, falling back to `[]` without them),
 * - `getArtifactsDir` (derived from the session file via the SDK rule).
 *
 * The same handle (and its `session` object) MUST back every tool call for
 * one web session: the EditStore snapshot registry lives on the session
 * object, so read→edit tag continuity breaks if the object is rebuilt.
 */
export function buildToolSession(options: BuildToolSessionOptions): ToolSessionHandle {
  let sessionFile = options.sessionFile ?? null;
  let todoPhases: SdkTodoPhase[] = [];
  const session: ToolSession = {
    cwd: options.cwd,
    hasUI: false,
    enableLsp: false,
    getSessionFile: () => sessionFile,
    getSessionSpawns: () => '*',
    getTodoPhases: () => cloneTodoPhases(todoPhases),
    setTodoPhases: (phases) => {
      todoPhases = cloneTodoPhases(phases);
    },
    getArtifactsDir: () => artifactsDirForSessionFile(sessionFile),
    settings: buildToolSessionSettings(),
  };
  return {
    session,
    setSessionFile(file) {
      sessionFile = file;
    },
    getSessionFile: () => sessionFile,
  };
}
