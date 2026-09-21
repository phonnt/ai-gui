import { Badge, Button, ErrorState, Input, Skeleton } from '@grove/ui';
import { Bot, FileText, MessageSquarePlus, RefreshCw, Send, Skull, Sprout, X } from 'lucide-react';
import { useState } from 'react';
import type { HubAgent } from '../../lib/api-client/hooks';
import {
  useHubAgents,
  useHubInbox,
  useHubTranscript,
  useKillHubAgent,
  useReviveHubAgent,
  useSendHubMessage,
  useSteerHubAgent,
} from '../../lib/api-client/hooks';
import { formatCount } from '../../lib/format';
import { SpawnWizard } from './SpawnWizard';

function statusVariant(
  status: HubAgent['status'],
): 'neutral' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'running':
      return 'neutral';
    case 'idle':
      return 'secondary';
    case 'aborted':
      return 'destructive';
    case 'parked':
      return 'outline';
  }
}

const steerBoxClassName =
  'flex min-h-20 w-full rounded-md bg-background hairline px-2 py-1.5 text-[13px] placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';

interface InspectorProps {
  agent: HubAgent;
  onClose: () => void;
}

function Inspector({ agent, onClose }: InspectorProps) {
  const steer = useSteerHubAgent();
  const revive = useReviveHubAgent();
  const kill = useKillHubAgent();
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState<'revive' | 'kill' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcript = useHubTranscript(transcriptOpen ? agent.id : undefined);
  const inbox = useHubInbox(agent.id);
  const send = useSendHubMessage();
  const [from, setFrom] = useState('Main');

  const handleSend = () => {
    if (from.trim() === '') return;
    send.mutate({ from: from.trim(), to: agent.id, text: text.trim() });
  };

  const handleSteer = () => {
    if (text.trim().length === 0) return;
    setNotice(null);
    steer.mutate(
      { id: agent.id, text: text.trim() },
      {
        onSuccess: () => {
          setText('');
          setNotice('Steer sent.');
        },
      },
    );
  };

  const handleRevive = () => {
    if (confirming !== 'revive') {
      setConfirming('revive');
      return;
    }
    setConfirming(null);
    setNotice(null);
    revive.mutate(agent.id, {
      onSuccess: (data) => {
        setNotice(data.revived ? 'Agent revived.' : 'Agent not revived — it may not be revivable.');
      },
    });
  };

  const handleKill = () => {
    if (confirming !== 'kill') {
      setConfirming('kill');
      return;
    }
    setConfirming(null);
    setNotice(null);
    kill.mutate(agent.id, {
      onSuccess: (data) => {
        if (data.killed) onClose();
        else setNotice('Agent not killed.');
      },
    });
  };

  const detailRows: [string, string][] = [
    ['id', agent.id],
    ['status', agent.status],
    ['kind', agent.kind ?? '—'],
    ['activity', agent.activity ?? '—'],
    ['model', agent.model ?? '—'],
    ['revivable', agent.revivable ? 'yes' : 'no'],
    ...(agent.metrics
      ? ([
          ['tokens', formatCount(agent.metrics.tokens)],
          ['requests', String(agent.metrics.requests)],
          ['tools', String(agent.metrics.tools)],
          ['cost', `$${agent.metrics.cost.toFixed(4)}`],
          ['duration', `${(agent.metrics.durationMs / 1000).toFixed(1)}s`],
        ] as [string, string][])
      : []),
    ['session file', agent.sessionFile ?? '—'],
  ];

  return (
    <aside
      aria-label={`Inspector for agent ${agent.id}`}
      className="absolute top-0 right-0 bottom-0 flex w-[320px] flex-col border-l border-border bg-background"
    >
      <header className="flex items-center justify-between gap-2 hairline-b p-3">
        <h3 className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold">
          <Bot />
          <span className="truncate font-mono text-xs">{agent.id}</span>
        </h3>
        <Button variant="ghost" onClick={onClose} aria-label="Close inspector">
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-area p-3">
        <dl className="flex flex-col gap-1 rounded-md bg-card hairline p-2 text-xs">
          {detailRows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-meta font-strong uppercase text-muted-foreground">Transcript</h4>
            <Button
              variant="ghost"
              onClick={() => setTranscriptOpen((v) => !v)}
              aria-expanded={transcriptOpen}
            >
              <FileText />
              {transcriptOpen ? 'Hide' : 'Show'}
            </Button>
          </div>
          {transcriptOpen && transcript.isPending && <Skeleton className="h-16 w-full" />}
          {transcriptOpen && transcript.isError && (
            <p className="text-small text-destructive">Failed to load transcript.</p>
          )}
          {transcriptOpen && transcript.data && (
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto scroll-area rounded-md hairline p-2">
              {transcript.data.length === 0 && (
                <li className="text-xs text-muted-foreground">No transcript rows yet.</li>
              )}
              {transcript.data.map((row) => (
                <li key={row.id} className="text-xs">
                  <span className="mr-1 font-mono text-[10px] uppercase text-muted-foreground">
                    {row.role}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {row.text.length > 400 ? `${row.text.slice(0, 400)}…` : row.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-meta font-strong uppercase text-muted-foreground">Steer</h4>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Steer this agent…"
            aria-label="Steer text"
            className={steerBoxClassName}
          />
          <p className="text-xs text-muted-foreground">
            Steering sends through the same prompt path as a chat prompt.
          </p>
          <Button onClick={handleSteer} disabled={steer.isPending || text.trim().length === 0}>
            <MessageSquarePlus />
            {steer.isPending ? 'Sending…' : 'Send steer'}
          </Button>
          {steer.isError && (
            <p className="text-small text-destructive">
              {steer.error instanceof Error ? steer.error.message : 'Steer failed.'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-meta font-strong uppercase text-muted-foreground">Message agent</h4>
            {inbox.data && inbox.data.length > 0 && (
              <Badge variant="destructive" title="Unread messages in this mailbox">
                {inbox.data.length}
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="from (agent id)"
              aria-label="Message sender id"
              className="h-7 text-xs"
            />
            <Button
              onClick={handleSend}
              disabled={send.isPending || from.trim() === ''}
              title="Send an agent-to-agent message"
            >
              <Send />
              {send.isPending ? '…' : 'Send'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Delivery wakes a parked agent or injects into a live one.
          </p>
          {send.data && (
            <p className="text-xs text-muted-foreground">
              {send.data.outcome}
              {send.data.error ? ` — ${send.data.error}` : ''}
            </p>
          )}
          {send.isError && (
            <p className="text-small text-destructive">
              {send.error instanceof Error ? send.error.message : 'Send failed.'}
            </p>
          )}
          {inbox.data && inbox.data.length > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto scroll-area rounded-md hairline p-2">
              {inbox.data.map((message) => (
                <li key={message.id} className="text-xs">
                  <span className="mr-1 font-mono text-[10px] text-muted-foreground">
                    {message.from}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{message.body}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-meta font-strong uppercase text-muted-foreground">Lifecycle</h4>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRevive} disabled={revive.isPending}>
              <Sprout />
              {confirming === 'revive' ? 'Confirm revive?' : 'Revive'}
            </Button>
            <Button variant="destructive" onClick={handleKill} disabled={kill.isPending}>
              <Skull />
              {confirming === 'kill' ? 'Confirm kill?' : 'Kill'}
            </Button>
          </div>
          {(revive.isError || kill.isError) && (
            <p className="text-small text-destructive">
              {revive.error instanceof Error
                ? revive.error.message
                : kill.error instanceof Error
                  ? kill.error.message
                  : 'Lifecycle op failed.'}
            </p>
          )}
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        </div>
      </div>
    </aside>
  );
}

export function HubPanel({ sessionId }: { sessionId: string }) {
  const agentsQuery = useHubAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);

  const agents = agentsQuery.data ?? [];
  const selected = agents.find((agent) => agent.id === selectedId) ?? null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 hairline-b p-3">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Bot />
          Agent Hub
        </h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowSpawn((v) => !v)}
            aria-pressed={showSpawn}
          >
            <MessageSquarePlus />
            Spawn
          </Button>
          <Button
            variant="outline"
            onClick={() => agentsQuery.refetch()}
            disabled={agentsQuery.isFetching}
          >
            <RefreshCw />
            {agentsQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        {agentsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {agentsQuery.isError && (
          <ErrorState
            message={
              agentsQuery.error instanceof Error ? agentsQuery.error.message : 'Roster failed.'
            }
            onRetry={() => agentsQuery.refetch()}
          />
        )}
        {agentsQuery.data && agents.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md hairline p-4 text-center">
            <Bot className="size-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">
              No agents yet — spawn one below to get started. Only agents spawned via Spawn below
              appear here; subagents spawned inside session turns are internal and are not listed.
            </p>
          </div>
        )}
        {agents.length > 0 && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1">ID</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Kind</th>
                <th className="px-2 py-1">Activity</th>
                <th className="px-2 py-1">Model</th>
                <th className="px-2 py-1">Usage</th>
                <th className="px-2 py-1">Inbox</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelectedId(agent.id);
                  }}
                  tabIndex={0}
                  aria-selected={selectedId === agent.id}
                  className={`cursor-pointer hairline-t hover:bg-accent ${
                    selectedId === agent.id ? 'bg-accent' : ''
                  }`}
                >
                  <td className="max-w-40 truncate px-2 py-1.5 font-mono text-xs">{agent.id}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                  </td>
                  <td className="px-2 py-1.5 text-xs">{agent.kind ?? '—'}</td>
                  <td className="max-w-48 truncate px-2 py-1.5 text-xs text-muted-foreground">
                    {agent.activity ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{agent.model ?? '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {agent.metrics
                      ? `${formatCount(agent.metrics.tokens)} tok · $${agent.metrics.cost.toFixed(3)} · ${agent.metrics.tools} tools`
                      : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {agent.unread > 0 ? (
                      <Badge variant="destructive" title="Unread agent-to-agent messages">
                        {agent.unread}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showSpawn && (
        <SpawnWizard
          sessionId={sessionId}
          onSpawned={(agentId) => {
            setSelectedId(agentId);
            setShowSpawn(false);
          }}
        />
      )}

      {selected && <Inspector agent={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
