import type { TreeNodeDto } from '@grove/protocol';
import { Button, Input, loadSashWidth, ResizeSash, Skeleton } from '@grove/ui';
import { Bot, GitBranch, GitFork, Info, MessageSquare, Pencil, Wrench, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  useBranchSession,
  useLabelTreeEntry,
  useNavigateTree,
  useSessionTree,
} from '../../lib/api-client/hooks';

interface TreePanelProps {
  sessionId: string;
  onBranched?: (sessionId: string, draft: string | null) => void;
}

const ROLE_META: Record<TreeNodeDto['role'], { label: string; icon: typeof Info; tone: string }> = {
  user: { label: 'You', icon: MessageSquare, tone: 'text-link' },
  assistant: { label: 'Assistant', icon: Bot, tone: 'text-syntax-keyword' },
  tool: { label: 'Tool', icon: Wrench, tone: 'text-success' },
  system: { label: 'System', icon: Info, tone: 'text-muted-foreground' },
  branch: { label: 'Branch', icon: GitFork, tone: 'text-muted-foreground' },
  'system-event': { label: 'Event', icon: Info, tone: 'text-muted-foreground' },
};

type TreeFilter = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all';

const FILTERS: { id: TreeFilter; label: string; title: string }[] = [
  { id: 'default', label: 'Default', title: 'Hide system events' },
  { id: 'no-tools', label: 'No tools', title: 'Hide tool output rows' },
  { id: 'user-only', label: 'Prompts', title: 'Only user prompts' },
  { id: 'labeled-only', label: 'Labeled', title: 'Only labeled nodes' },
  { id: 'all', label: 'All', title: 'Every journal row' },
];

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

/** Depth from the parent chain (cycle-guarded) for visual indent. */
function nodeDepth(node: TreeNodeDto, byId: Map<string, TreeNodeDto>): number {
  let depth = 0;
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  const seen = new Set<string>([node.id]);
  while (current && !seen.has(current.id) && depth < 64) {
    seen.add(current.id);
    depth += 1;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return depth;
}

export function TreePanel({ sessionId, onBranched }: TreePanelProps) {
  const treeQuery = useSessionTree(sessionId);
  const navigateTree = useNavigateTree(sessionId);
  const branchSession = useBranchSession(sessionId);
  const labelEntry = useLabelTreeEntry(sessionId);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TreeFilter>('default');
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelText, setLabelText] = useState('');
  const [treeWidth, setTreeWidth] = useState<number>(() =>
    loadSashWidth('grove-tree-w', 256, 200, 480),
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
      onSuccess: (data) => onBranched?.(data.session.id, data.draft),
      onError: (err) => setError(err instanceof Error ? err.message : 'Branch failed'),
    });
  };

  const startLabelEdit = (node: TreeNodeDto) => {
    setEditingId(node.id);
    setLabelText(node.label ?? '');
  };

  const saveLabel = () => {
    if (!editingId) return;
    const id = editingId;
    const text = labelText.trim();
    setEditingId(null);
    labelEntry.mutate(
      { entryId: id, label: text },
      { onError: (err) => setError(err instanceof Error ? err.message : 'Label failed') },
    );
  };

  const nodes = useMemo(() => {
    const all = treeQuery.data?.nodes ?? [];
    const byId = new Map(all.map((n) => [n.id, n]));
    const q = search.trim().toLowerCase();
    return all
      .filter((node) => {
        switch (filter) {
          case 'no-tools':
            if (node.role === 'tool') return false;
            break;
          case 'user-only':
            if (node.role !== 'user') return false;
            break;
          case 'labeled-only':
            if (!node.label) return false;
            break;
          case 'all':
            break;
          case 'default':
            if (node.role === 'system-event' || node.role === 'system') return false;
            break;
        }
        if (
          q &&
          !(node.preview.toLowerCase().includes(q) || node.label?.toLowerCase().includes(q))
        ) {
          return false;
        }
        return true;
      })
      .map((node) => ({ node, depth: nodeDepth(node, byId) }));
  }, [treeQuery.data, filter, search]);

  return (
    <div
      style={{ width: treeWidth }}
      className="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      <ResizeSash
        label="Resize tree"
        direction="left"
        value={treeWidth}
        min={200}
        max={480}
        defaultValue={256}
        storageKey="grove-tree-w"
        onChange={setTreeWidth}
        className="absolute inset-y-0 -left-[9px] z-10 w-2"
      />
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tree
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleBranch(undefined)}
          disabled={branchSession.isPending}
          title="Branch from current position (must be a user prompt)"
        >
          <GitFork />
          Branch
        </Button>
      </div>
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes…"
          aria-label="Search tree nodes"
          className="h-7 text-xs"
        />
        {search && (
          <Button size="sm" variant="ghost" onClick={() => setSearch('')} aria-label="Clear search">
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      <fieldset className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
        <legend className="sr-only">Tree filters</legend>
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? 'default' : 'ghost'}
            onClick={() => setFilter(f.id)}
            title={f.title}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </Button>
        ))}
      </fieldset>
      <div className="flex-1 overflow-y-auto p-2">
        {treeQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {treeQuery.isError && (
          <div className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="text-xs text-destructive">Failed to load tree.</p>
            <Button size="sm" variant="outline" onClick={() => treeQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {treeQuery.data && nodes.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {search || filter !== 'default' ? 'No nodes match.' : 'No branches yet.'}
          </p>
        )}
        {nodes.map(({ node, depth }) => {
          const active = node.id === treeQuery.data?.leafId;
          const meta = ROLE_META[node.role] ?? ROLE_META['system-event'];
          const Icon = meta.icon;
          const branchable = node.role === 'user';
          const editing = editingId === node.id;
          return (
            <div
              key={node.id}
              style={{ marginLeft: Math.min(depth, 8) * 12 }}
              className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 ${
                active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent'
              }`}
            >
              <Icon className={`size-4 shrink-0 ${meta.tone}`} aria-hidden="true" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => handleNavigate(node.id)}
                title={`Navigate to this node (${meta.label})`}
              >
                <span className="block truncate text-[13px]">
                  {node.label ? (
                    <>
                      <span className="font-medium">{node.label}</span>
                      <span className="text-muted-foreground"> · {node.preview || node.id}</span>
                    </>
                  ) : (
                    node.preview || node.id
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {meta.label} · {timeAgo(node.createdAt)}
                </span>
              </button>
              {editing ? (
                <Input
                  value={labelText}
                  onChange={(e) => setLabelText(e.target.value)}
                  placeholder="Label…"
                  aria-label="Node label"
                  className="h-7 w-28 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveLabel();
                    else if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => setEditingId(null)}
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => startLabelEdit(node)}
                  disabled={labelEntry.isPending}
                  aria-label={`Label ${node.preview || node.id}`}
                  title="Edit label (empty clears)"
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
              {branchable && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleBranch(node.id)}
                  disabled={branchSession.isPending}
                  aria-label={`Branch from ${node.preview || node.id}`}
                  title="Branch from this prompt"
                >
                  <GitBranch />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {(error ?? navigateTree.isError ?? branchSession.isError) && (
        <p className="border-t border-border px-3 py-1 text-xs text-destructive">
          {error ?? 'Tree operation failed.'}
        </p>
      )}
    </div>
  );
}
