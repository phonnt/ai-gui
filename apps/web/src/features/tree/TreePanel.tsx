import { Button, Skeleton } from '@ai-gui/ui';
import { GitBranch, GitFork } from 'lucide-react';
import { useState } from 'react';
import { useBranchSession, useNavigateTree, useSessionTree } from '../../lib/api-client/hooks';

interface TreePanelProps {
  sessionId: string;
}

export function TreePanel({ sessionId }: TreePanelProps) {
  const treeQuery = useSessionTree(sessionId);
  const navigateTree = useNavigateTree(sessionId);
  const branchSession = useBranchSession(sessionId);
  const [error, setError] = useState<string | null>(null);

  const handleNavigate = (leafId: string) => {
    setError(null);
    navigateTree.mutate(leafId, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Navigate failed'),
    });
  };

  const handleBranch = (parentId?: string) => {
    setError(null);
    branchSession.mutate(parentId, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Branch failed'),
    });
  };

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Tree
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleBranch(undefined)}
          disabled={branchSession.isPending}
          title="Branch from root"
        >
          <GitFork />
          Branch
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {treeQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {treeQuery.isError && (
          <div className="flex flex-col gap-2 rounded border border-[hsl(var(--border))] p-3">
            <p className="text-xs text-[hsl(var(--destructive))]">Failed to load tree.</p>
            <Button size="sm" variant="outline" onClick={() => treeQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {treeQuery.data && treeQuery.data.nodes.length === 0 && (
          <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
            No branches yet.
          </p>
        )}
        {treeQuery.data?.nodes.map((node) => {
          const active = node.id === treeQuery.data.leafId;
          return (
            <div
              key={node.id}
              className={`mb-1 flex items-center gap-1 rounded-[4px] px-2 py-1.5 ${
                active
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                  : 'hover:bg-[hsl(var(--accent))]'
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => handleNavigate(node.id)}
                title="Navigate to this node"
              >
                <span className="block truncate text-[13px]">{node.preview || node.id}</span>
                <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                  {node.role} · {node.createdAt}
                </span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleBranch(node.id)}
                disabled={branchSession.isPending}
                aria-label={`Branch from ${node.preview || node.id}`}
                title="Branch from this node"
              >
                <GitBranch />
              </Button>
            </div>
          );
        })}
      </div>
      {(error ?? navigateTree.isError ?? branchSession.isError) && (
        <p className="border-t border-[hsl(var(--border))] px-3 py-1 text-xs text-[hsl(var(--destructive))]">
          {error ?? 'Tree operation failed.'}
        </p>
      )}
    </div>
  );
}
