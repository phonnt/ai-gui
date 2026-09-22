import { readFile } from 'node:fs/promises';
import type {
  HubAgent,
  HubJob,
  HubMessage,
  HubOps,
  HubSendResult,
  HubTranscriptEntry,
  ProcessActionResult,
  SpawnInput,
} from '@grove/agent-runtime';
import {
  AgentNotFoundError,
  InvalidRequestError,
  ReviveFailedError,
  RuntimeUnavailableError,
  UnknownAgentError,
} from '@grove/agent-runtime';
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
import { executeLaunch } from '@oh-my-pi/pi-coding-agent/tools/hub/launch';
import { toInvalidRequestError } from './client-errors.js';
import { withDeadline } from './deadline.js';
import { createLogCache } from './log-cache.js';
import { sessionFileTextToMessages, textOfContent } from './mapping.js';
import { getToolSession } from './tools.js';
import { liveSettingsGetterFor, sharedJobs } from './tools-session.js';

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
/** Flatten an SDK tool result's text blocks; process output is text-only. */
function launchText(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
}

/**
 * Ceiling for one supervised-process call. A healthy broker answers in
 * milliseconds, a cold scope pays a spawn (~12s observed), and a wedged spawn
 * used to hang the request for 23-35s+ before answering 500.
 */
const PROCESS_CALL_DEADLINE_MS = 20_000;

/** The broker never answered: a caller condition (503), with the scope to inspect. */
export function unknownProcessTarget(cwd: string): RuntimeUnavailableError {
  return new RuntimeUnavailableError(
    `daemon broker did not answer within ${PROCESS_CALL_DEADLINE_MS / 1000}s for ${cwd}. ` +
      'Its scope directory under ~/.omp/run/daemons holds no live broker; retry, or clear that scope’s stale files.',
  );
}

/** Typed client errors pass through; SDK broker faults become 503, not 500. */
export function mapProcessError(err: unknown, cwd: string): Error {
  void cwd;
  const client = toInvalidRequestError(err);
  if (client) return client;
  if (err instanceof RuntimeUnavailableError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/daemon broker|broker\.sock/i.test(message)) {
    return new RuntimeUnavailableError(`daemon broker unavailable: ${message}`);
  }
  return err instanceof Error ? err : new Error(message);
}

/** One shared ttl cache for the process log tail (see `log-cache.ts`). */
const logCache = createLogCache({ ttlMs: 2_000 });

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

    async processAction(input: {
      sessionId: string;
      params: Record<string, unknown>;
    }): Promise<ProcessActionResult> {
      const session = await getToolSession(input.sessionId);
      // The live session owns the gate: the tool session's copy is a snapshot
      // from attach time, so a later toggle would be invisible here.
      const settings = liveSettingsGetterFor(input.sessionId)?.() ?? session.settings;
      if (settings.get('launch.enabled') !== true) {
        throw new InvalidRequestError('process supervision is disabled (launch.enabled)');
      }
      const { op, ...rest } = input.params;
      if (typeof op !== 'string') throw new InvalidRequestError('process action requires an op');
      // Following a tail polls this action; serving the rendered tail from a
      // short-lived cache by cursor keeps one render per window instead of one
      // per poll (the render is the 10-20s cost).
      if (op === 'logs') {
        const key = `${input.sessionId}:${String(rest.name ?? '')}`;
        const cursor = typeof rest.cursor === 'number' ? rest.cursor : undefined;
        const cached = logCache.read(key, cursor);
        if (cached) {
          return { text: cached.text, details: { cursor: cached.cursor, cached: true } };
        }
      }
      // A live broker answers in milliseconds; a wedged spawn can hang for
      // minutes (audit: 23-35s, one probe never returned). Unknown daemon /
      // unsupported key are caller conditions, not faults.
      const result = await withDeadline(
        executeLaunch(session, {
          ...rest,
          op: op === 'ps' ? 'list' : op,
        } as Parameters<typeof executeLaunch>[1]),
        PROCESS_CALL_DEADLINE_MS,
        () => unknownProcessTarget(session.cwd),
      ).catch((err: unknown) => {
        throw mapProcessError(err, session.cwd);
      });
      const text = launchText(result);
      const details =
        result.details && typeof result.details === 'object'
          ? (result.details as unknown as Record<string, unknown>)
          : undefined;
      if (op === 'logs') {
        const key = `${input.sessionId}:${String(rest.name ?? '')}`;
        logCache.put(key, text);
        // A miss answers the whole window plus our own cursor: slicing a fresh
        // window by a stale offset would drop bytes.
        return { text, details: { ...(details ?? {}), cursor: text.length, cached: false } };
      }
      return {
        text,
        ...(details ? { details } : {}),
      };
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
