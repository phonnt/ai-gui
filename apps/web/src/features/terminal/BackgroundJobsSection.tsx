import { Badge, Button } from '@grove/ui';
import { useState } from 'react';
import { useCancelJob, useJobs } from '../../lib/api-client/hooks';

function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'failed') return 'destructive';
  if (state === 'running') return 'secondary';
  if (state === 'cancelled') return 'outline';
  return 'default';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s`;
}

/**
 * Background jobs started from this session (TUI: the job list behind a
 * detached `bash`). The live tail exists for commands the web detached; an
 * in-turn job started by the agent shows its output once it settles.
 */
export function BackgroundJobsSection({ sessionId }: { sessionId: string }) {
  const jobsQuery = useJobs(sessionId);
  const cancel = useCancelJob(sessionId);
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = jobsQuery.data?.jobs ?? [];
  if (jobs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 hairline-t p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Background jobs
        </h4>
        <span className="font-mono text-[10px] text-muted-foreground">
          {jobs.filter((job) => job.status === 'running').length} running
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {jobs.map((job) => {
          const open = openId === job.id;
          return (
            <li key={job.id} className="rounded-md bg-card hairline">
              <div className="flex items-center gap-2 px-2 py-1">
                <span className="font-mono text-[11px]">{job.id}</span>
                <Badge variant={stateVariant(job.status)}>{job.status}</Badge>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
                  title={job.label}
                >
                  {job.label}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatDuration(job.durationMs)}
                </span>
                {(job.output ?? job.errorText) !== undefined && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : job.id)}
                  >
                    {open ? 'Hide' : 'Output'}
                  </Button>
                )}
                {job.status === 'running' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(job.id)}
                    aria-label={`Cancel job ${job.id}`}
                  >
                    Stop
                  </Button>
                )}
              </div>
              {open && (
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap hairline-t bg-background p-2 font-mono text-[11px]">
                  {job.errorText ?? job.output ?? '(no output yet)'}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
      {cancel.isError && (
        <p className="text-xs text-destructive">
          {cancel.error instanceof Error ? cancel.error.message : 'Cancel failed.'}
        </p>
      )}
    </div>
  );
}
