import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { OmpRpcAdapter, SdkAdapter } from '@ai-gui/omp-adapter';

const processGlobal = (
  globalThis as { process?: { cwd?: () => string; env?: Record<string, string | undefined> } }
).process;

/**
 * Select the agent runtime. Default is SDK-first: the in-process adapter
 * unlocks goal mode plus true /clear + /fresh, pins behavior to the repo's
 * OMP dependency, and reattaches old sessions via the shared store.
 * `AI_GUI_RUNTIME=rpc` forces the OMP child (process isolation);
 * `=sdk` forces SDK; `=auto` (or unset) tries SDK, then RPC. Server-wide:
 * restart to switch; the boot log prints the chosen runtime.
 */
export async function createRuntime(defaultCwd?: string): Promise<AgentRuntime> {
  const cwd = defaultCwd ?? processGlobal?.cwd?.();
  const forced = processGlobal?.env?.AI_GUI_RUNTIME?.trim().toLowerCase();
  if (forced === 'rpc') {
    await OmpRpcAdapter.probe(cwd);
    return new OmpRpcAdapter(cwd);
  }
  // SDK-first default (auto/sdk/unset): the constructor never throws; session
  // failures surface per call like any other runtime error.
  return new SdkAdapter(cwd);
}
