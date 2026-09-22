import { Button, Dialog, Input, Skeleton, useEscapeToClose } from '@grove/ui';
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
  useEscapeToClose(open, onClose);
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
    <Dialog
      open
      onClose={onClose}
      label="Choose workspace directory"
      align="top"
      className="relative flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-md panel-plain bg-popover shadow-floating"
    >
      <div className="hairline-b p-2">
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
            className="font-mono text-small"
          />
          <Button type="submit">Go</Button>
        </form>
        <p className="truncate px-1 pt-1 font-mono text-small text-muted-foreground">
          {data ? data.path : '…'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-1">
        {browse.isPending && <Skeleton className="m-2 h-8" />}
        {browse.isError && (
          <p className="p-3 text-small text-destructive">Cannot list this directory.</p>
        )}
        {data?.parent && (
          <button
            type="button"
            onClick={() => go(data.parent ?? undefined)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-accent"
          >
            <ArrowUp className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">..</span>
          </button>
        )}
        {data?.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            onClick={() => go(entry.path)}
            onDoubleClick={() => onSelect(entry.path)}
            title="Open (double-click to select)"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-accent"
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-small">{entry.name}</span>
          </button>
        ))}
        {data && data.entries.length === 0 && (
          <p className="p-3 text-small text-muted-foreground">No subdirectories.</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 hairline-t p-2">
        <span className="min-w-0 flex-1 truncate px-1 font-mono text-small text-muted-foreground">
          <FolderOpen className="mr-1 inline size-3" />
          {data?.path ?? ''}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!data} onClick={() => data && onSelect(data.path)}>
          Select this folder
        </Button>
      </div>
    </Dialog>
  );
}
