import { Button, Dialog, Input, Skeleton, useEscapeToClose } from '@grove/ui';
import { FolderOpen, MessageSquarePlus, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import { useCreateSession, useDropSession, useSessions } from '../../lib/api-client/hooks';
import { DirBrowser } from './DirBrowser';

interface SessionSwitcherProps {
  open: boolean;
  onClose: () => void;
}

export function SessionSwitcher({ open, onClose }: SessionSwitcherProps) {
  useEscapeToClose(open, onClose);
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const lastCwd = useSessionStore((s) => s.lastCwd);
  const setLastCwd = useSessionStore((s) => s.setLastCwd);
  const createSession = useCreateSession();
  const dropSession = useDropSession();
  const sessionsQuery = useSessions();
  const [filter, setFilter] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [cwd, setCwd] = useState(lastCwd);
  const [browserOpen, setBrowserOpen] = useState(false);
  const sessions = useMemo(() => {
    const all = sessionsQuery.data ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    // Fuzzy subsequence match (TUI /resume style): id prefix wins, then
    // title/cwd substring, then subsequence anywhere.
    const subseq = (hay: string): boolean => {
      let i = 0;
      for (const ch of hay) {
        if (ch === q[i]) i += 1;
        if (i >= q.length) return true;
      }
      return false;
    };
    const rank = (s: { id: string; title: string; cwd: string }): number => {
      const id = s.id.toLowerCase();
      const title = s.title.toLowerCase();
      const cwd = s.cwd.toLowerCase();
      if (id.startsWith(q)) return 0;
      if (title.includes(q) || cwd.includes(q) || id.includes(q)) return 1;
      if (subseq(id) || subseq(title) || subseq(cwd)) return 2;
      return -1;
    };
    return all
      .map((s) => ({ s, r: rank(s) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.s);
  }, [sessionsQuery.data, filter]);

  if (!open) return null;

  const handleSelect = (id: string) => {
    setActiveSessionId(id);
    onClose();
    void navigate(`/s/${id}`);
  };

  const handleNew = () => {
    const dir = cwd.trim();
    createSession.mutate(dir ? { cwd: dir } : {}, {
      onSuccess: (session) => {
        setActiveSessionId(session.id);
        if (dir) setLastCwd(dir);
        setFilter('');
        onClose();
        void navigate(`/s/${session.id}`);
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    dropSession.mutate(id);
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        label="Switch session"
        align="top"
        className="h-auto max-h-[60vh] w-full max-w-md"
      >
        <div className="flex items-center gap-2 hairline-b p-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
          />
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-2">
          {sessionsQuery.isPending && (
            <div className="flex flex-col gap-2 p-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {sessionsQuery.isError && (
            <div className="flex flex-col items-center gap-2 p-4 text-center">
              <p className="text-[13px] text-destructive">Failed to load sessions.</p>
              <Button variant="outline" onClick={() => sessionsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {sessionsQuery.data && sessions.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-4 text-center">
              <MessageSquarePlus className="size-5 text-muted-foreground" />
              <p className="text-[13px] text-muted-foreground">
                {filter ? 'No sessions match.' : 'No sessions yet.'}
              </p>
            </div>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => handleSelect(session.id)}
              >
                <span className="block truncate text-[13px] font-medium">
                  {session.title || session.id}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {session.cwd} · {session.updatedAt}
                </span>
              </button>
              {confirmDeleteId === session.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    onClick={() => handleDelete(session.id)}
                    disabled={dropSession.isPending}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => handleDelete(session.id)}
                  aria-label={`Delete ${session.title || session.id}`}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
        </div>
        {dropSession.isError && (
          <p className="hairline-t px-3 py-1 text-small text-destructive">
            Failed to delete session.
          </p>
        )}
        <div className="hairline-t p-2">
          <div className="mb-2 flex gap-1">
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Workspace directory (blank = server default)"
              aria-label="Workspace directory for new session"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={() => setBrowserOpen(true)}
              aria-label="Browse for workspace directory"
              title="Browse for workspace directory"
            >
              <FolderOpen />
            </Button>
          </div>
          <Button className="w-full" onClick={handleNew} disabled={createSession.isPending}>
            <Plus />
            New session
          </Button>
          {createSession.isError && (
            <p className="pt-1 text-small text-destructive">Failed to create session.</p>
          )}
        </div>
      </Dialog>
      <DirBrowser
        open={browserOpen}
        initialPath={cwd}
        onSelect={(dir) => {
          setCwd(dir);
          setBrowserOpen(false);
        }}
        onClose={() => setBrowserOpen(false)}
      />
    </>
  );
}
