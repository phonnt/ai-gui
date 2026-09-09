import type { TreeNodeDto } from '@ai-gui/protocol';
import { Button, loadSashWidth, ResizeSash, Skeleton } from '@ai-gui/ui';
import { Bot, GitBranch, GitFork, Info, MessageSquare, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useBranchSession, useNavigateTree, useSessionTree } from '../../lib/api-client/hooks';

interface TreePanelProps {
  sessionId: string;
}

const ROLE_META: Record<TreeNodeDto['role'], { label: string; icon: typeof Info; tone: string }> = {
  user: { label: 'You', icon: MessageSquare, tone: 'text-[hsl(var(--primary))]' },
  assistant: { label: 'Assistant', icon: Bot, tone: 'text-[hsl(var(--ember))]' },
  tool: { label: 'Tool', icon: Wrench, tone: 'text-[hsl(var(--diff-add))]' },
  system: { label: 'System', icon: Info, tone: 'text-[hsl(var(--muted-foreground))]' },
  branch: { label: 'Branch', icon: GitFork, tone: 'text-[hsl(var(--muted-foreground))]' },
  'system-event': { label: 'Event', icon: Info, tone: 'text-[hsl(var(--muted-foreground))]' },
};

/** Compact relative time for tree rows ("just now", "5m", "3h", "2d"). */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function TreePanel({ sessionId }: TreePanelProps) {
  const treeQuery = useSessionTree(sessionId);
  const navigateTree = useNavigateTree(sessionId);
  const branchSession = useBranchSession(sessionId);
  const [error, setError] = useState<string | null>(null);
  const [treeWidth, setTreeWidth] = useState<number>(() =>
    loadSashWidth('ai-gui-tree-w', 256, 200, 480),
  );

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
    <div
      style={{ width: treeWidth }}
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <ResizeSash
        label="Resize tree"
        direction="left"
        value={treeWidth}
        min={200}
        max={480}
        defaultValue={256}
        storageKey="ai-gui-tree-w"
        onChange={setTreeWidth}
        className="absolute inset-y-0 -left-[9px] z-10 w-2"
      />
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
          <div className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3">
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
          const meta = ROLE_META[node.role] ?? ROLE_META['system-event'];
          const Icon = meta.icon;
          const branchable = node.role !== 'system-event';
          return (
            <div
              key={node.id}
              className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 ${
                active
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                  : 'hover:bg-[hsl(var(--accent))]'
              }`}
            >
              <Icon className={`size-4 shrink-0 ${meta.tone}`} aria-hidden="true" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => handleNavigate(node.id)}
                title={`Navigate to this node (${meta.label})`}
              >
                <span className="block truncate text-[13px]">{node.preview || node.id}</span>
                <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                  {meta.label} · {timeAgo(node.createdAt)}
                </span>
              </button>
              {branchable && (
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
              )}
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
