import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { OmpRpcAdapter, SdkAdapter } from '@ai-gui/omp-adapter';

const processGlobal = (globalThis as { process?: { cwd?: () => string } }).process;

/**
 * Select the agent runtime: probe `omp --mode rpc` first (full-fidelity wire
 * to the real OMP session store), fall back to the in-process SDK adapter when
 * the binary is missing or the handshake fails.
 */
export async function createRuntime(defaultCwd?: string): Promise<AgentRuntime> {
  const cwd = defaultCwd ?? processGlobal?.cwd?.();
  try {
    await OmpRpcAdapter.probe(cwd);
    return new OmpRpcAdapter(cwd);
  } catch {
    return new SdkAdapter(cwd);
  }
}
