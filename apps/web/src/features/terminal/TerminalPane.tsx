import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { History, Play, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { P2aBashResult } from '../../lib/api-client/hooks';
import { useRunBash } from '../../lib/api-client/hooks';

interface TerminalPaneProps {
  sessionId: string;
}

interface JobEntry {
  id: number;
  command: string;
  at: number;
  result?: P2aBashResult;
  error?: string;
}

let nextJobId = 1;

/** Non-interactive output terminal. Interactive PTY is deferred (P2a). */
export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [lastTruncated, setLastTruncated] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const runBash = useRunBash(sessionId);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const term = new Terminal({
      convertEol: true,
      fontSize: 12,
      scrollback: 5000,
      theme: { background: '#0c0c0c' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet; resize handler recovers */
    }
    term.writeln('# session shell — output only (interactive PTY deferred)');
    termRef.current = { term, fit };
    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const handleRun = () => {
    const cmd = command.trim();
    if (!cmd || runBash.isPending) return;
    const timeout = timeoutMs.trim() === '' ? undefined : Number(timeoutMs);
    const jobCwd = cwd.trim() === '' ? undefined : cwd.trim();
    const id = nextJobId++;
    termRef.current?.term.writeln(`$ ${cmd}`);
    runBash.mutate(
      { command: cmd, cwd: jobCwd, timeoutMs: Number.isFinite(timeout) ? timeout : undefined },
      {
        onSuccess: (result) => {
          setJobs((prev) => [{ id, command: cmd, at: Date.now(), result }, ...prev]);
          setLastTruncated(result.truncated);
          const term = termRef.current?.term;
          if (term) {
            if (result.output) term.write(result.output);
            term.writeln(
              `[exit ${result.exitCode}${result.timedOut ? ' timed out' : ''}${result.truncated ? ' — output truncated' : ''}]`,
            );
          }
        },
        onError: (err) => {
          const message = err instanceof Error ? err.message : 'Command failed';
          setJobs((prev) => [{ id, command: cmd, at: Date.now(), error: message }, ...prev]);
          termRef.current?.term.writeln(`[error] ${message}`);
        },
      },
    );
  };

  const handleClear = () => {
    termRef.current?.term.clear();
    setJobs([]);
    setLastTruncated(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-[hsl(var(--border))] p-3">
        <div className="flex gap-2">
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRun();
            }}
            placeholder="command to run…"
            aria-label="Command"
            className="font-mono"
          />
          <Button size="sm" onClick={handleRun} disabled={runBash.isPending || !command.trim()}>
            <Play />
            {runBash.isPending ? 'Running…' : 'Run'}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClear} aria-label="Clear terminal">
            <Trash2 />
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="cwd (optional)"
            aria-label="Working directory"
            className="font-mono"
          />
          <Input
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
            placeholder="timeout ms (optional)"
            aria-label="Timeout ms"
            inputMode="numeric"
            className="w-44 font-mono"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#0c0c0c] p-2">
        <div ref={mountRef} className="h-full min-h-48 w-full" />
      </div>

      {lastTruncated && (
        <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <TriangleAlert className="size-3.5 shrink-0" />
          Output was truncated by the server — narrow the command or page with a range-aware tool.
        </div>
      )}

      <div className="flex max-h-44 min-h-0 flex-col border-t border-[hsl(var(--border))]">
        <div className="flex items-center gap-1.5 px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <History className="size-3.5" />
          Jobs ({jobs.length})
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {runBash.isPending && <Skeleton className="h-6 w-full" />}
          {jobs.length === 0 && !runBash.isPending && (
            <p className="p-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
              No commands run yet.
            </p>
          )}
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-[hsl(var(--muted))]"
            >
              <span className="min-w-0 flex-1 truncate font-mono">{job.command}</span>
              {job.result ? (
                <Badge variant={job.result.exitCode === 0 ? 'secondary' : 'destructive'}>
                  exit {job.result.exitCode}
                  {job.result.timedOut ? ' · timeout' : ''}
                  {job.result.truncated ? ' · cut' : ''}
                </Badge>
              ) : (
                <Badge variant="destructive">error</Badge>
              )}
            </div>
          ))}
          {runBash.isError && (
            <p className="px-2 py-1 text-xs text-[hsl(var(--destructive))]">
              {runBash.error instanceof Error ? runBash.error.message : 'Command failed.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
