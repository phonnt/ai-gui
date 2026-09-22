import { EmptyState, Panel, Skeleton } from '@grove/ui';
import { FileDiff, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { useGitDiff, useGitStatus } from '../../lib/api-client/hooks';

/**
 * Working-tree state for the session cwd. The TUI opens this as a Git UI behind
 * `/git`; here it sits next to the files it describes, which is where a reader
 * looks after editing one. Read-only by design: staging and committing stay with
 * the agent (or bash).
 */
export function GitSection({ sessionId }: { sessionId: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const status = useGitStatus(sessionId);
  const diff = useGitDiff(sessionId, selected);

  const state = status.data?.status;
  const totals = state ? `+${state.insertions} −${state.deletions}` : '';

  return (
    <section className="px-2 pb-2">
      <div className="flex items-center justify-between gap-2 py-1">
        <span className="section-label">Git</span>
        {state && (
          <span className="flex items-center gap-1 text-meta text-muted-foreground">
            <GitBranch className="size-3.5" />
            <span className="font-mono">{state.detached ? 'detached HEAD' : state.branch}</span>
            {state.entries.length > 0 && <span className="font-mono">{totals}</span>}
          </span>
        )}
      </div>

      {status.isPending && <Skeleton className="h-8 w-full" />}
      {status.isError && <EmptyState message="Git status is unavailable." />}
      {state && state.entries.length === 0 && (
        <EmptyState message="No changes in the working tree." />
      )}

      <ul className="flex flex-col gap-0.5">
        {(state?.entries ?? []).map((entry) => (
          <li key={`${entry.status}:${entry.path}`}>
            <button
              type="button"
              onClick={() => setSelected(entry.path === selected ? null : entry.path)}
              aria-pressed={selected === entry.path}
              className={`flex w-full items-center gap-2 rounded-md panel-plain px-2 py-1 text-left ${
                selected === entry.path ? 'panel-plain-active' : ''
              }`}
            >
              <span className="w-6 shrink-0 font-mono text-meta text-muted-foreground">
                {entry.status}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-small">{entry.path}</span>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <Panel tone="plain" className="mt-1.5">
          <div className="flex items-center gap-1.5 px-2 py-1 text-meta text-muted-foreground">
            <FileDiff className="size-3.5" />
            <span className="font-mono">{selected}</span>
          </div>
          {diff.isPending && <Skeleton className="mx-2 mb-2 h-16" />}
          {diff.data && (
            <pre className="max-h-72 overflow-auto whitespace-pre px-2 pb-2 font-mono text-small">
              {diff.data.text || 'No textual diff (binary or untracked file).'}
            </pre>
          )}
        </Panel>
      )}
    </section>
  );
}
