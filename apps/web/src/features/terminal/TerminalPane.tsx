import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { useQueryClient } from '@tanstack/react-query';
import { History, Play, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { P2aBashResult, P2aTruncation } from '../../lib/api-client/hooks';
import { useRunBash } from '../../lib/api-client/hooks';
import { readArtifact } from '../../lib/api-client/rest';
import { BackgroundJobsSection } from './BackgroundJobsSection';

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

/** Bash output terminal: env overrides, PTY allocation, background jobs. */
export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [envText, setEnvText] = useState('');
  const [pty, setPty] = useState(false);
  const [detach, setDetach] = useState(false);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [lastTruncated, setLastTruncated] = useState(false);
  const [lastTruncation, setLastTruncation] = useState<P2aTruncation | null>(null);
  const [artifactFull, setArtifactFull] = useState<string | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const runBash = useRunBash(sessionId);
  const queryClient = useQueryClient();

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
    let timeout: number | undefined;
    if (timeoutMs.trim() !== '') {
      timeout = Number(timeoutMs);
      if (!Number.isFinite(timeout) || timeout <= 0) {
        setJobs((prev) => [
          {
            id: nextJobId++,
            command: cmd,
            at: Date.now(),
            error: 'Timeout must be a positive number of ms.',
          },
          ...prev,
        ]);
        return;
      }
    }
    const jobCwd = cwd.trim() === '' ? undefined : cwd.trim();
    let env: Record<string, string> | undefined;
    if (envText.trim() !== '') {
      // One KEY=VALUE per line (TUI passes the same shape to the bash tool).
      env = {};
      for (const line of envText.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) {
          setJobs((prev) => [
            {
              id: nextJobId++,
              command: cmd,
              at: Date.now(),
              error: `Invalid env line: ${trimmed} (expected KEY=VALUE)`,
            },
            ...prev,
          ]);
          return;
        }
        env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      }
    }
    const id = nextJobId++;
    termRef.current?.term.writeln(`$ ${cmd}`);
    runBash.mutate(
      { command: cmd, cwd: jobCwd, timeoutMs: timeout, env, pty, async: detach },
      {
        onSuccess: (result) => {
          setJobs((prev) => [{ id, command: cmd, at: Date.now(), result }, ...prev]);
          // A detached run only becomes visible through the jobs query, whose
          // poll backs off to 10s when nothing was running at fetch time.
          if (result.jobId)
            void queryClient.invalidateQueries({ queryKey: ['session', sessionId, 'jobs'] });
          setLastTruncated(result.truncated);
          setLastTruncation(result.truncation ?? null);
          const term = termRef.current?.term;
          if (term) {
            if (result.output) term.write(result.output);
            term.writeln(
              result.jobId
                ? `[background job ${result.jobId}]`
                : `[exit ${result.exitCode}${result.timedOut ? ' timed out' : ''}${result.truncated ? ' — output truncated' : ''}]`,
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
        <div className="flex items-start gap-2">
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="env overrides, one KEY=VALUE per line (optional)"
            aria-label="Environment overrides"
            className="min-h-9 flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
          />
          <Button
            size="sm"
            variant={pty ? 'default' : 'outline'}
            onClick={() => setPty((v) => !v)}
            aria-pressed={pty}
            title="Request a PTY. Falls back to a plain pipe until an interactive terminal transport is wired (the SDK reports the fallback in the output)."
          >
            PTY
          </Button>
          <Button
            size="sm"
            variant={detach ? 'default' : 'outline'}
            onClick={() => setDetach((v) => !v)}
            aria-pressed={detach}
            title="Run in the background and return a job id"
          >
            Background
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#0c0c0c] p-2">
        <div ref={mountRef} className="h-full min-h-48 w-full" />
      </div>

      {lastTruncated && (
        <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span>
            Output truncated
            {lastTruncation
              ? ` (${lastTruncation.truncatedBy}, ${lastTruncation.totalLines} lines total${
                  lastTruncation.shownRange
                    ? `, showing ${lastTruncation.shownRange.start}-${lastTruncation.shownRange.end}`
                    : ''
                })`
              : ''}
          </span>
          {lastTruncation?.artifactId && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const res = await readArtifact(sessionId, lastTruncation.artifactId as string);
                if (!res.ok) return;
                setArtifactFull(res.data.content);
              }}
            >
              Show full output
            </Button>
          )}
        </div>
      )}
      {artifactFull !== null && (
        <div className="border-t border-[hsl(var(--border))]">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
              artifact://{lastTruncation?.artifactId}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setArtifactFull(null)}>
              Close
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-2 text-xs">
            {artifactFull}
          </pre>
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
        <BackgroundJobsSection sessionId={sessionId} />
      </div>
    </div>
  );
}
