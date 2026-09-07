import type { HubAgent, HubJob, HubOps, SpawnInput } from '@ai-gui/agent-runtime';
import { AgentNotFoundError, ReviveFailedError } from '@ai-gui/agent-runtime';
import { AsyncJobManager } from '@oh-my-pi/pi-coding-agent/async/job-manager';
import { AgentLifecycleManager } from '@oh-my-pi/pi-coding-agent/registry/agent-lifecycle';
import type { AgentRef } from '@oh-my-pi/pi-coding-agent/registry/agent-registry';
import { AgentRegistry } from '@oh-my-pi/pi-coding-agent/registry/agent-registry';
import {
  reserveStructuredSubagentId,
  runStructuredSubagent,
} from '@oh-my-pi/pi-coding-agent/task/structured-subagent';
import { getToolSession } from './tools.js';
import { sharedJobs } from './tools-session.js';

function toHubAgent(ref: AgentRef): HubAgent {
  const model = ref.session?.model as { id?: unknown } | undefined;
  return {
    id: ref.id,
    displayName: ref.displayName,
    kind: String(ref.kind),
    status: ref.status,
    ...(ref.parentId !== undefined ? { parentId: ref.parentId } : {}),
    ...(typeof ref.activity === 'string' && ref.activity ? { activity: ref.activity } : {}),
    ...(typeof model?.id === 'string' ? { model: model.id } : {}),
    sessionFile: ref.sessionFile,
    createdAt: new Date(ref.createdAt).toISOString(),
    lastActivity: new Date(ref.lastActivity).toISOString(),
  };
}

function requireRef(id: string): AgentRef {
  const ref = AgentRegistry.global().get(id);
  if (!ref) throw new AgentNotFoundError(id);
  return ref;
}

/**
 * HubOps over the process-global AgentRegistry — the same registry
 * runStructuredSubagent adopts spawned subagents into and the hub tool reads.
 * Only subagents spawned through taskSpawn (or otherwise sharing this
 * registry) are manageable; subagents inside omp-rpc child turns live in the
 * child process and never appear here.
 */
export function createHubOps(): HubOps {
  const registry = AgentRegistry.global();
  const lifecycle = AgentLifecycleManager.global();
  const jobs: AsyncJobManager = AsyncJobManager.instance() ?? sharedJobs;

  return {
    async hubRoster(): Promise<HubAgent[]> {
      return registry
        .list()
        .map(toHubAgent)
        .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
    },

    async hubSteer(input: { id: string; text: string }): Promise<void> {
      requireRef(input.id);
      const session = await lifecycle.ensureLive(input.id);
      await session.prompt(input.text, { streamingBehavior: 'steer' });
    },

    async hubRevive(input: { id: string }): Promise<{
      revived: boolean;
      revivable: boolean;
      transcript?: string;
    }> {
      requireRef(input.id);
      try {
        await lifecycle.ensureLive(input.id);
        return { revived: true, revivable: true };
      } catch (err) {
        if (/no reviver/i.test(err instanceof Error ? err.message : String(err))) {
          return { revived: false, revivable: false, transcript: `history://${input.id}` };
        }
        throw new ReviveFailedError(input.id);
      }
    },

    async hubKill(input: { id: string }): Promise<{ killed: boolean }> {
      const ref = requireRef(input.id);
      if (ref.session && ref.status === 'running') {
        await ref.session.abort();
      }
      return { killed: await lifecycle.release(input.id, ref, { tombstone: true }) };
    },

    async jobsList(): Promise<HubJob[]> {
      return jobs.getRunningJobs().map((job) => ({
        id: job.id,
        type: String(job.type),
        status: job.status,
        label: job.label,
        ...(job.agentId !== undefined ? { agentId: job.agentId } : {}),
        startedAt: new Date(job.startTime).toISOString(),
      }));
    },

    async jobsCancel(input: { ids?: string[] }): Promise<{ cancelled: string[] }> {
      const cancelled: string[] = [];
      if (input.ids === undefined) {
        const running = jobs.getRunningJobs();
        jobs.cancelAll();
        return { cancelled: running.map((job) => job.id) };
      }
      for (const id of input.ids) {
        const job = jobs.getJob(id);
        if (job && job.status === 'running') {
          job.abortController.abort();
          cancelled.push(id);
        }
      }
      return { cancelled };
    },

    async taskSpawn(input: SpawnInput): Promise<{ agentId: string }> {
      const session = await getToolSession(input.sessionId);
      const agentId = await reserveStructuredSubagentId(
        session,
        input.agent ? { label: input.agent } : undefined,
      );
      void runStructuredSubagent({
        session,
        invocationKind: 'task',
        assignment: input.task,
        ...(input.context !== undefined ? { context: input.context } : {}),
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(input.outputSchema !== undefined ? { outputSchema: input.outputSchema } : {}),
        identity: { id: agentId },
      }).catch((err: unknown) => {
        console.error(`task subagent ${agentId} failed:`, err);
      });
      return { agentId };
    },
  };
}
