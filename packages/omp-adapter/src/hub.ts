import { readFile } from 'node:fs/promises';
import type {
  HubAgent,
  HubJob,
  HubMessage,
  HubOps,
  HubSendResult,
  HubTranscriptEntry,
  SpawnInput,
} from '@ai-gui/agent-runtime';
import { AgentNotFoundError, ReviveFailedError, UnknownAgentError } from '@ai-gui/agent-runtime';
import { resolveAgentModelSelection } from '@oh-my-pi/pi-coding-agent/config/model-resolver';
import { IrcBus } from '@oh-my-pi/pi-coding-agent/irc/bus';
import { AgentLifecycleManager } from '@oh-my-pi/pi-coding-agent/registry/agent-lifecycle';
import type { AgentRef } from '@oh-my-pi/pi-coding-agent/registry/agent-registry';
import { AgentRegistry } from '@oh-my-pi/pi-coding-agent/registry/agent-registry';
import { discoverAgents, getAgent } from '@oh-my-pi/pi-coding-agent/task';
import {
  reserveStructuredSubagentId,
  runStructuredSubagent,
} from '@oh-my-pi/pi-coding-agent/task/structured-subagent';
import { sessionFileTextToMessages, textOfContent } from './mapping.js';
import { getToolSession } from './tools.js';
import { sharedJobs } from './tools-session.js';

/**
 * Literal model for a spawn whose agent definition names a role alias.
 *
 * Frontmatter like `model: "@slow"` does not reach the child as the configured
 * role model: the child re-resolves the alias and lands on the role's builtin
 * default, so a role edited in Settings had no effect on subagents. Expanding
 * here (same resolver the spawn path uses for precedence) keeps the alias's
 * meaning: settings override -> agent frontmatter -> active/fallback model.
 */
async function expandAgentAlias(
  session: Awaited<ReturnType<typeof getToolSession>>,
  agentName: string | undefined,
): Promise<string | string[] | undefined> {
  if (!agentName) return undefined;
  const agents = await discoverAgents(session.cwd, undefined, session.effectiveExtensionRoots?.());
  const agentModel = getAgent(agents.agents, agentName)?.model;
  if (!hasRoleAlias(agentModel)) return undefined;
  const overrides = session.settings.get('task.agentModelOverrides') ?? {};
  const { patterns } = resolveAgentModelSelection({
    settingsOverride: overrides[agentName],
    agentModel,
    settings: session.settings,
    activeModelPattern: session.getActiveModelString?.(),
    fallbackModelPattern: session.getModelString?.(),
  });
  if (patterns.length === 0) return undefined;
  return patterns.length > 1 ? patterns : patterns[0];
}

function hasRoleAlias(agentModel: string[] | undefined): boolean {
  return Array.isArray(agentModel) && agentModel.some((entry) => entry.trim().startsWith('@'));
}

/**
 * Reject unknown agent names before reserving an id: the executor's preflight
 * failure happens after `runStructuredSubagent` is already detached, which
 * would otherwise return a phantom agent id to the caller.
 */
async function assertKnownAgent(
  session: Awaited<ReturnType<typeof getToolSession>>,
  agentName: string | undefined,
): Promise<void> {
  if (!agentName) return;
  const discovery = await discoverAgents(
    session.cwd,
    undefined,
    session.effectiveExtensionRoots?.(),
  );
  if (!getAgent(discovery.agents, agentName)) {
    const available = discovery.agents.map((candidate) => candidate.name).join(', ') || 'none';
    throw new UnknownAgentError(agentName, available);
  }
}

function toHubAgent(ref: AgentRef, unread: number, revivable: boolean): HubAgent {
  const model = ref.session?.model as { id?: unknown } | undefined;
  const metrics = ref.history?.metrics;
  const resolved = ref.history?.resolvedModel;
  return {
    id: ref.id,
    displayName: ref.displayName,
    kind: String(ref.kind),
    status: ref.status,
    ...(ref.parentId !== undefined ? { parentId: ref.parentId } : {}),
    ...(typeof ref.activity === 'string' && ref.activity ? { activity: ref.activity } : {}),
    ...(typeof model?.id === 'string'
      ? { model: model.id }
      : typeof resolved === 'string'
        ? { model: resolved }
        : {}),
    sessionFile: ref.sessionFile,
    createdAt: new Date(ref.createdAt).toISOString(),
    lastActivity: new Date(ref.lastActivity).toISOString(),
    ...(metrics
      ? {
          metrics: {
            tokens: metrics.tokens ?? 0,
            requests: metrics.requests ?? 0,
            tools: metrics.tools ?? 0,
            cost: metrics.cost ?? 0,
            durationMs: metrics.durationMs ?? 0,
          },
        }
      : {}),
    unread,
    revivable,
  };
}

/** Transcript rows from an agent's on-disk journal (parked or restarted agents). */
async function readJournalTranscript(file: string | null): Promise<HubTranscriptEntry[]> {
  if (!file) return [];
  try {
    const text = await readFile(file, 'utf8');
    return sessionFileTextToMessages(text).map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    }));
  } catch {
    return [];
  }
}

function toTranscriptEntry(message: unknown, index: number): HubTranscriptEntry | null {
  if (!message || typeof message !== 'object') return null;
  const record = message as { role?: unknown; content?: unknown; timestamp?: unknown };
  const role =
    record.role === 'user' || record.role === 'assistant' || record.role === 'toolResult'
      ? record.role === 'toolResult'
        ? 'tool'
        : record.role
      : 'system';
  const text = textOfContent(record.content);
  if (!text) return null;
  return {
    id: `${typeof record.timestamp === 'number' ? record.timestamp : 't'}-${index}`,
    role,
    text,
    createdAt:
      typeof record.timestamp === 'number'
        ? new Date(record.timestamp).toISOString()
        : new Date().toISOString(),
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
 * registry) are manageable; subagents spawned inside session turns are
 * internal and never appear here.
 */
export function createHubOps(): HubOps {
  const registry = AgentRegistry.global();
  const lifecycle = AgentLifecycleManager.global();
  // Same manager the tool sessions register into: a separate instance would
  // never see spawned task/bash jobs.
  const jobs = sharedJobs;

  return {
    async hubRoster(): Promise<HubAgent[]> {
      const bus = IrcBus.global();
      return registry
        .list()
        .filter((ref) => ref.kind !== 'advisor')
        .map((ref) => toHubAgent(ref, bus.unreadCount(ref.id), lifecycle.has(ref.id)))
        .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
    },

    async hubTranscript(input: { id: string; limit?: number }): Promise<HubTranscriptEntry[]> {
      const ref = requireRef(input.id);
      const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 500) : 200;
      // Live session first (in-memory messages), else the durable journal, so a
      // parked agent still reads back exactly like in the TUI.
      const live = ref.session?.messages;
      const entries =
        live && live.length > 0
          ? live.flatMap((message, index) => {
              const entry = toTranscriptEntry(message, index);
              return entry ? [entry] : [];
            })
          : await readJournalTranscript(ref.sessionFile);
      return entries.slice(-limit);
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

    async hubSend(input: { from: string; to: string; text: string }): Promise<HubSendResult> {
      // The sender is an opaque label (a web session is not a registry agent);
      // only the recipient must resolve, and the bus reports delivery failures.
      requireRef(input.to);
      const receipt = await IrcBus.global().send({
        from: input.from,
        to: input.to,
        body: input.text,
      });
      return {
        outcome: receipt.outcome,
        ...(receipt.error !== undefined ? { error: receipt.error } : {}),
      };
    },

    async hubInbox(input: { id: string; peek?: boolean }): Promise<HubMessage[]> {
      requireRef(input.id);
      const messages = IrcBus.global().inbox(input.id, { peek: input.peek === true });
      return messages.map((message) => ({
        id: String(message.id),
        from: message.from,
        to: message.to,
        body: message.body,
        ts: message.ts,
        ...(message.replyTo !== undefined ? { replyTo: String(message.replyTo) } : {}),
      }));
    },

    async hubWait(input: {
      id: string;
      from?: string;
      timeoutMs: number;
    }): Promise<HubMessage | null> {
      requireRef(input.id);
      const message = await IrcBus.global().wait(
        input.id,
        { ...(input.from !== undefined ? { from: input.from } : {}) },
        input.timeoutMs,
      );
      if (!message) return null;
      return {
        id: String(message.id),
        from: message.from,
        to: message.to,
        body: message.body,
        ts: message.ts,
        ...(message.replyTo !== undefined ? { replyTo: String(message.replyTo) } : {}),
      };
    },

    async jobsList(): Promise<HubJob[]> {
      // Same shape as the TUI snapshot: running jobs plus recently settled ones.
      const seen = new Map<string, HubJob>();
      const toJob = (job: {
        id: string;
        type: unknown;
        status: string;
        label: string;
        startTime: number;
        agentId?: string | undefined;
        resultText?: string | undefined;
        errorText?: string | undefined;
      }): HubJob => ({
        id: job.id,
        type: String(job.type),
        status: job.status as HubJob['status'],
        label: job.label,
        ...(job.agentId !== undefined ? { agentId: job.agentId } : {}),
        startedAt: new Date(job.startTime).toISOString(),
        durationMs: Math.max(0, Date.now() - job.startTime),
        ...(typeof job.resultText === 'string' ? { resultText: job.resultText } : {}),
        ...(typeof job.errorText === 'string' ? { errorText: job.errorText } : {}),
      });
      for (const job of jobs.getRunningJobs()) seen.set(job.id, toJob(job));
      for (const job of jobs.getRecentJobs()) if (!seen.has(job.id)) seen.set(job.id, toJob(job));
      return [...seen.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
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
      await assertKnownAgent(session, input.agent);
      const expanded = input.model ?? (await expandAgentAlias(session, input.agent));
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
        ...(input.schemaMode !== undefined ? { schemaMode: input.schemaMode } : {}),
        ...(expanded !== undefined ? { model: expanded } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.isolation !== undefined ? { isolation: input.isolation } : {}),
        ...(input.detached !== undefined ? { detached: input.detached } : {}),
        identity: { id: agentId },
      }).catch((err: unknown) => {
        console.error(`task subagent ${agentId} failed:`, err);
      });
      return { agentId };
    },
  };
}
