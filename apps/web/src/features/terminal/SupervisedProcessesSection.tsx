import { Badge, Button } from '@ai-gui/ui';
import { Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useProcessAction, useProcesses } from '../../lib/api-client/hooks';
import { processAction } from '../../lib/api-client/rest';

/** One daemon as the SDK reports it in a `ps` snapshot. */
interface Daemon {
  name: string;
  state: string;
  pid?: number;
  startedAt?: number;
  readyAt?: number;
  restartCount?: number;
  exitCode?: number;
  readyMatch?: string;
  detached?: boolean;
}

/**
 * argv split for the args field: whitespace separates, quotes group, so
 * `-e "console.log('hi')"` reaches the process as one argument.
 */
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const char of raw.trim()) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current !== '') out.push(current);
  return out;
}

function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'failed' || state === 'exited') return 'outline';
  if (state === 'ready') return 'default';
  return 'secondary';
}

function formatUptime(daemon: Daemon): string {
  const from = daemon.readyAt ?? daemon.startedAt;
  if (from === undefined) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - from) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Supervised long-running project processes (TUI: the `launch` surface behind
 * `hub start/ps/logs/stop`). The daemon broker is shared with the OMP harness,
 * so entries started elsewhere show up here too.
 */
export function SupervisedProcessesSection({ sessionId }: { sessionId: string }) {
  const processes = useProcesses(sessionId);
  const action = useProcessAction(sessionId);
  const [name, setName] = useState('web');
  const [application, setApplication] = useState('bun');
  const [args, setArgs] = useState('run dev:web');
  const [readyLog, setReadyLog] = useState('Local:.*http');
  const [readyPort, setReadyPort] = useState('');
  const [timeout, setTimeoutSeconds] = useState('60');
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [following, setFollowing] = useState(false);
  const [tailing, setTailing] = useState(false);
  const [tailError, setTailError] = useState<string | null>(null);
  const cursorRef = useRef<number | undefined>(undefined);

  const daemons: Daemon[] = Array.isArray(processes.data?.details?.daemons)
    ? (processes.data.details.daemons as Daemon[])
    : [];

  /**
   * A `logs` result is a window over the daemon's output ring (the SDK renders
   * the tail, not a byte delta), so it replaces what is shown. The trailing
   * marker `[name: state; cursor=N]` is the wait point for the next follow.
   */
  const collect = (result: { text: string }) => {
    setOutput(result.text.replace(/\n?\[[^\]]*cursor=\d+\]\s*$/, ''));
    const cursor = /cursor=(\d+)\]/.exec(result.text)?.[1];
    if (cursor !== undefined) cursorRef.current = Number(cursor);
  };

  const logs = (target: string, from?: number) =>
    action.mutate(
      {
        op: 'logs',
        name: target,
        lines: from === undefined ? 200 : 100,
        ...(from !== undefined ? { cursor: from } : {}),
      },
      { onSuccess: collect },
    );

  // Follow is the SDK's own long poll: the call returns once new output
  // arrives, so cycles are sequential and each shows the daemon's tail window.
  // It bypasses the mutation so a request in flight never disables the row
  // actions (Stop/Restart) while following.
  const tailRef = useRef(collect);
  tailRef.current = collect;
  useEffect(() => {
    if (!following || selected === null) return;
    let cancelled = false;
    const pump = async () => {
      while (!cancelled) {
        setTailing(true);
        const result = await processAction(sessionId, {
          op: 'logs',
          name: selected,
          follow: true,
          timeout: 10,
          ...(cursorRef.current !== undefined ? { cursor: cursorRef.current } : {}),
        });
        if (cancelled) return;
        setTailing(false);
        if (!result.ok) {
          setTailError(result.error);
          return;
        }
        setTailError(null);
        tailRef.current(result.data);
      }
    };
    void pump();
    return () => {
      cancelled = true;
    };
  }, [following, selected, sessionId]);

  const openLogs = (target: string) => {
    setSelected(target);
    setOutput('');
    setTailError(null);
    cursorRef.current = undefined;
    logs(target);
  };

  const start = () => {
    const seconds = Number.parseInt(timeout, 10);
    const port = readyPort.trim() === '' ? undefined : Number.parseInt(readyPort, 10);
    const log = readyLog.trim() === '' ? undefined : readyLog.trim();
    const ready = {
      ...(log !== undefined ? { log } : {}),
      ...(port !== undefined && Number.isFinite(port) ? { port } : {}),
      ...(Number.isFinite(seconds) ? { timeout: seconds } : {}),
    };
    action.mutate(
      {
        op: 'start',
        name: name.trim(),
        application: application.trim(),
        args: splitArgs(args),
        ...(Object.keys(ready).length > 0 ? { ready } : {}),
      },
      { onSuccess: (result) => setOutput(result.text) },
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Supervised processes
        </h4>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            {processes.isLoading
              ? 'loading…'
              : `${daemons.filter((d) => d.state === 'ready').length} ready / ${daemons.length}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={processes.isFetching}
            onClick={() => void processes.refetch()}
            aria-label="Refresh process list"
          >
            <RefreshCw className={processes.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          aria-label="Process name"
          className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
        />
        <input
          value={application}
          onChange={(e) => setApplication(e.target.value)}
          placeholder="application"
          aria-label="Application"
          className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
        />
        <input
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="args"
          aria-label="Arguments"
          className="col-span-2 h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
        />
        <input
          value={readyLog}
          onChange={(e) => setReadyLog(e.target.value)}
          placeholder="ready log regex"
          aria-label="Ready log pattern"
          className="h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
        />
        <div className="flex gap-1">
          <input
            value={readyPort}
            onChange={(e) => setReadyPort(e.target.value)}
            placeholder="ready port"
            aria-label="Ready port"
            className="h-7 min-w-0 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
          />
          <input
            value={timeout}
            onChange={(e) => setTimeoutSeconds(e.target.value)}
            placeholder="timeout s"
            aria-label="Readiness timeout seconds"
            className="h-7 w-16 shrink-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-[11px] outline-none"
          />
        </div>
        <Button
          size="sm"
          className="col-span-2"
          disabled={action.isPending || name.trim() === '' || application.trim() === ''}
          onClick={start}
        >
          <Play className="size-3.5" />
          Start
        </Button>
      </div>

      <ul className="flex flex-col gap-1">
        {daemons.map((daemon) => (
          <li
            key={daemon.name}
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{daemon.name}</span>
              <Badge variant={stateVariant(daemon.state)}>{daemon.state}</Badge>
              {daemon.pid !== undefined && (
                <span className="shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                  pid {daemon.pid}
                </span>
              )}
              <span className="shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                {formatUptime(daemon)}
              </span>
              <Button size="sm" variant="ghost" onClick={() => openLogs(daemon.name)}>
                Logs
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => action.mutate({ op: 'restart', name: daemon.name })}
              >
                Restart
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => action.mutate({ op: 'stop', name: daemon.name })}
                aria-label={`Stop ${daemon.name}`}
              >
                Stop
              </Button>
            </div>
            {daemon.readyMatch && (
              <p className="px-2 pb-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
                ready: {daemon.readyMatch}
              </p>
            )}
          </li>
        ))}
      </ul>

      {selected !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-[11px]">{selected}</span>
            <Button
              size="sm"
              variant={following ? 'default' : 'outline'}
              aria-pressed={following}
              onClick={() => setFollowing(!following)}
            >
              {following ? 'Following' : 'Follow'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px]">
            {output || (tailing ? 'waiting for output…' : '(no output yet)')}
          </pre>
          {tailError && <p className="text-xs text-[hsl(var(--destructive))]">tail: {tailError}</p>}
        </div>
      )}

      {action.isError && (
        <p className="text-xs text-[hsl(var(--destructive))]">
          {action.error instanceof Error ? action.error.message : 'Process action failed.'}
        </p>
      )}
      {processes.isError && (
        <p className="text-xs text-[hsl(var(--destructive))]">
          {processes.error instanceof Error ? processes.error.message : 'Could not list processes.'}
        </p>
      )}
      {action.data && selected === null && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px]">
          {action.data.text}
        </pre>
      )}
    </div>
  );
}
