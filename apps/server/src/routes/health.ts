import type { AgentRuntime } from '@grove/agent-runtime';
import { PROTOCOL_VERSION } from '@grove/protocol';

/** GET /api/health → { ok, version, runtime }. */
export function healthResponse(runtime: AgentRuntime): {
  ok: boolean;
  version: string;
  runtime: string;
} {
  return { ok: true, version: PROTOCOL_VERSION, runtime: runtime.kind };
}
