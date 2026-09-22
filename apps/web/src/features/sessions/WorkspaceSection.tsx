import { Button, IconButton, Input } from '@grove/ui';
import { FolderOpen, X } from 'lucide-react';
import { useState } from 'react';
import {
  useAddWorkspaceDir,
  useRemoveWorkspaceDir,
  useWorkspace,
} from '../../lib/api-client/hooks';
import { DirBrowser } from './DirBrowser';

/**
 * Workspace roots of the session (TUI `/dirs`, `/add-dir`, `/remove-dir`):
 * the primary root comes from the session cwd and cannot be removed; extra
 * roots widen what the session's tools and the server's file routes may touch.
 */
export function WorkspaceSection({ sessionId }: { sessionId: string }) {
  const workspaceQuery = useWorkspace(sessionId);
  const add = useAddWorkspaceDir(sessionId);
  const remove = useRemoveWorkspaceDir(sessionId);
  const [picking, setPicking] = useState(false);
  const [manualPath, setManualPath] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const workspace = workspaceQuery.data;

  const runAdd = (path: string) => {
    const next = path.trim();
    if (!next) return;
    setNote(null);
    add.mutate(next, {
      onSuccess: (result) => {
        setNote(result.added ? `Added ${result.added}` : `Already a root: ${next}`);
        setManualPath('');
      },
      onError: (err) => setNote(err instanceof Error ? err.message : 'Add failed'),
    });
  };

  const runRemove = (path: string) => {
    setNote(null);
    remove.mutate(path, {
      onSuccess: (result) => {
        setNote(result.removed ? `Removed ${result.removed}` : `Not a root: ${path}`);
      },
      onError: (err) => setNote(err instanceof Error ? err.message : 'Remove failed'),
    });
  };

  return (
    <div className="flex flex-col gap-1.5 hairline-t px-3 py-2 font-mono text-meta">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">workspace</span>
        <Button
          variant="ghost"
          onClick={() => setPicking(true)}
          disabled={add.isPending}
          title="Browse the server filesystem for a directory to add"
        >
          <FolderOpen className="size-3" />
          Add directory…
        </Button>
      </div>
      {workspaceQuery.isError && (
        <p className="text-destructive">Workspace unavailable (session busy?).</p>
      )}
      {workspace && (
        <ul className="flex flex-col gap-0.5">
          <li className="flex items-center gap-2">
            <span className="flex-1 truncate" title={workspace.cwd}>
              {workspace.cwd}
            </span>
            <span className="shrink-0 text-muted-foreground">root</span>
          </li>
          {workspace.directories.map((dir) => (
            <li key={dir} className="flex items-center gap-2">
              <span className="flex-1 truncate" title={dir}>
                {dir}
              </span>
              <IconButton
                label={`Remove workspace directory ${dir}`}
                title="Remove from workspace"
                disabled={remove.isPending}
                onClick={() => runRemove(dir)}
              >
                <X className="size-3" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          runAdd(manualPath);
        }}
      >
        <Input
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          placeholder="~/other-repo — absolute or cwd-relative"
          aria-label="Workspace directory path"
          className="h-7 font-mono text-small"
        />
        <Button type="submit" disabled={add.isPending || !manualPath.trim()}>
          Add
        </Button>
      </form>
      {note && <p className="text-muted-foreground">{note}</p>}
      <DirBrowser
        open={picking}
        initialPath={workspace?.cwd}
        onSelect={(path) => {
          setPicking(false);
          runAdd(path);
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
