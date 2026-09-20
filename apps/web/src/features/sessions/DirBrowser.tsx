import { Button, Input, Skeleton } from '@grove/ui';
import { ArrowUp, Folder, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useBrowseDir } from '../../lib/api-client/hooks';

interface DirBrowserProps {
  open: boolean;
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Filesystem directory picker for the workspace field (server-side browses). */
export function DirBrowser({ open, initialPath, onSelect, onClose }: DirBrowserProps) {
  const [path, setPath] = useState<string | undefined>(initialPath?.trim() || undefined);
  const [bar, setBar] = useState(initialPath ?? '');
  const browse = useBrowseDir(open ? path : undefined);

  if (!open) return null;

  const data = browse.data;
  const go = (next: string | undefined) => {
    setPath(next);
    setBar(next ?? '');
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Choose workspace directory"
    >
      <button
        type="button"
        aria-label="Close directory browser"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg">
        <div className="border-b border-[hsl(var(--border))] p-2">
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              go(bar.trim() || undefined);
            }}
          >
            <Input
              value={bar}
              onChange={(e) => setBar(e.target.value)}
              placeholder="~/dev — path on the server"
              aria-label="Directory path"
              className="font-mono text-xs"
            />
            <Button size="sm" type="submit">
              Go
            </Button>
          </form>
          <p className="truncate px-1 pt-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {data ? data.path : '…'}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {browse.isPending && <Skeleton className="m-2 h-8" />}
          {browse.isError && (
            <p className="p-3 text-xs text-[hsl(var(--destructive))]">
              Cannot list this directory.
            </p>
          )}
          {data?.parent && (
            <button
              type="button"
              onClick={() => go(data.parent ?? undefined)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))]"
            >
              <ArrowUp className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="text-[hsl(var(--muted-foreground))]">..</span>
            </button>
          )}
          {data?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => go(entry.path)}
              onDoubleClick={() => onSelect(entry.path)}
              title="Open (double-click to select)"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))]"
            >
              <Folder className="size-4 shrink-0 text-[hsl(var(--primary))]" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
            </button>
          ))}
          {data && data.entries.length === 0 && (
            <p className="p-3 text-xs text-[hsl(var(--muted-foreground))]">No subdirectories.</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--border))] p-2">
          <span className="min-w-0 flex-1 truncate px-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">
            <FolderOpen className="mr-1 inline size-3" />
            {data?.path ?? ''}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!data} onClick={() => data && onSelect(data.path)}>
            Select this folder
          </Button>
        </div>
      </div>
    </div>
  );
}
