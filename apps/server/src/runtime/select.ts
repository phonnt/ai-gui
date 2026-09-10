import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { OmpRpcAdapter, SdkAdapter } from '@ai-gui/omp-adapter';

const processGlobal = (
  globalThis as { process?: { cwd?: () => string; env?: Record<string, string | undefined> } }
).process;

/**
 * Select the agent runtime. `AI_GUI_RUNTIME=sdk` forces the in-process SDK
 * adapter (goal mode, true /clear + /fresh); `=rpc` forces the OMP child;
 * unset/auto probes RPC first with SDK fallback. Server-wide: restart to switch.
 */
export async function createRuntime(defaultCwd?: string): Promise<AgentRuntime> {
  const cwd = defaultCwd ?? processGlobal?.cwd?.();
  const forced = processGlobal?.env?.AI_GUI_RUNTIME?.trim().toLowerCase();
  if (forced === 'sdk') return new SdkAdapter(cwd);
  if (forced !== 'rpc') {
    try {
      await OmpRpcAdapter.probe(cwd);
      return new OmpRpcAdapter(cwd);
    } catch {
      return new SdkAdapter(cwd);
    }
  }
  await OmpRpcAdapter.probe(cwd);
  return new OmpRpcAdapter(cwd);
}
