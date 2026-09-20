import type { AgentRuntime } from '@grove/agent-runtime';
import { SdkAdapter } from '@grove/omp-adapter';

const processGlobal = (
  globalThis as { process?: { cwd?: () => string; env?: Record<string, string | undefined> } }
).process;

/**
 * Create the agent runtime. SDK-only: the in-process adapter unlocks goal
 * mode plus true /clear + /fresh, pins behavior to the repo's OMP
 * dependency, and reattaches old sessions via the shared store. The
 * constructor never throws; session failures surface per call like any
 * other runtime error.
 */
export async function createRuntime(defaultCwd?: string): Promise<AgentRuntime> {
  const cwd = defaultCwd ?? processGlobal?.cwd?.();
  return new SdkAdapter(cwd);
}
