import { Badge, Button, Skeleton } from '@grove/ui';
import { Ban, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useCancelHubJobs, useHubJobs } from '../../lib/api-client/hooks';

function stateVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = state.toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'destructive';
  if (s.includes('run') || s.includes('active') || s.includes('pending')) return 'secondary';
  if (s.includes('done') || s.includes('complet') || s.includes('cancel')) return 'default';
  return 'outline';
}

export function JobsPanel() {
  const jobsQuery = useHubJobs(5000);
  const cancel = useCancelHubJobs();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<'selected' | 'all' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const jobs = jobsQuery.data ?? [];
  const tracked = new Set(jobs.map((job) => job.id));
  const selectedTracked = selected.filter((id) => tracked.has(id));

  const toggle = (id: string) => {
    setConfirming(null);
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const runCancel = (ids: string[] | undefined, scope: 'selected' | 'all') => {
    if (confirming !== scope) {
      setConfirming(scope);
      return;
    }
    setConfirming(null);
    setResult(null);
    cancel.mutate(
      { ids },
      {
        onSuccess: (data) => {
          setSelected([]);
          setResult(
            data.cancelled.length > 0
              ? `Cancelled ${data.cancelled.length}: ${data.cancelled.join(', ')}`
              : 'Nothing to cancel.',
          );
        },
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 hairline-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Jobs</h3>
          <Button size="sm" variant="outline" onClick={() => jobsQuery.refetch()}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Auto-refreshes every 5s.</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedTracked.length === 0 || cancel.isPending}
            onClick={() => runCancel(selectedTracked, 'selected')}
          >
            <Ban />
            {confirming === 'selected'
              ? `Confirm cancel ${selectedTracked.length}?`
              : `Cancel selected${selectedTracked.length > 0 ? ` (${selectedTracked.length})` : ''}`}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={jobs.length === 0 || cancel.isPending}
            onClick={() => runCancel(undefined, 'all')}
          >
            <Ban />
            {confirming === 'all' ? 'Confirm cancel all?' : 'Cancel all'}
          </Button>
        </div>
        {cancel.isError && (
          <p className="text-xs text-destructive">
            {cancel.error instanceof Error ? cancel.error.message : 'Cancel failed.'}
          </p>
        )}
        {result && <p className="text-xs text-muted-foreground">{result}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {jobsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {jobsQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded-md hairline p-3 text-center">
            <p className="text-xs text-destructive">
              {jobsQuery.error instanceof Error ? jobsQuery.error.message : 'Jobs failed.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => jobsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {jobsQuery.data && jobs.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">No jobs.</p>
        )}
        {jobs.length > 0 && (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-2 py-1" aria-label="Select">
                  <span aria-hidden="true">✓</span>
                </th>
                <th className="px-2 py-1">ID</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1">State</th>
                <th className="px-2 py-1">Owner</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="hairline-t">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(job.id)}
                      onChange={() => toggle(job.id)}
                      aria-label={`Select job ${job.id}`}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">{job.id}</td>
                  <td className="px-2 py-1.5">{job.type}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={stateVariant(job.status)}>{job.status}</Badge>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {job.agentId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
