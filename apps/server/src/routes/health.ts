import type { AgentRuntime } from '@ai-gui/agent-runtime';
import { PROTOCOL_VERSION } from '@ai-gui/protocol';

/** GET /api/health → { ok, version, runtime }. */
export function healthResponse(runtime: AgentRuntime): {
  ok: boolean;
  version: string;
  runtime: string;
} {
  return { ok: true, version: PROTOCOL_VERSION, runtime: runtime.kind };
}
