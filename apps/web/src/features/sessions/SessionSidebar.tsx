import { Button, Skeleton } from '@ai-gui/ui';
import { ArrowLeftRight, MessageSquarePlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import { useCreateSession, useSessions } from '../../lib/api-client/hooks';
import { SessionSwitcher } from './SessionSwitcher';

export function SessionSidebar() {
  const navigate = useNavigate();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const sessionsQuery = useSessions();
  const createSession = useCreateSession();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const handleNew = () => {
    createSession.mutate(
      {},
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
          void navigate(`/s/${session.id}`);
        },
      },
    );
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center justify-between p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Sessions
        </h2>
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSwitcherOpen(true)}
            aria-label="Switch session"
          >
            <ArrowLeftRight />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleNew} disabled={createSession.isPending}>
            <Plus />
            New
          </Button>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessionsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {sessionsQuery.isError && (
          <div className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3">
            <p className="text-xs text-[hsl(var(--destructive))]">Failed to load sessions.</p>
            <Button size="sm" variant="outline" onClick={() => sessionsQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {sessionsQuery.data?.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-4 text-center">
            <MessageSquarePlus className="size-5 text-[hsl(var(--muted-foreground))]" />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">No sessions yet.</p>
            <Button size="sm" onClick={handleNew} disabled={createSession.isPending}>
              <Plus />
              New session
            </Button>
          </div>
        )}
        {sessionsQuery.data?.map((session) => (
          <NavLink
            key={session.id}
            to={`/s/${session.id}`}
            onClick={() => setActiveSessionId(session.id)}
            className={({ isActive }) =>
              `mb-1 block truncate rounded-[4px] px-2 py-1.5 text-[13px] hover:bg-[hsl(var(--accent))] ${
                isActive || activeSessionId === session.id
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                  : 'text-[hsl(var(--foreground))]'
              }`
            }
          >
            {session.title || session.id}
          </NavLink>
        ))}
      </div>
      <SessionSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
    </aside>
  );
}
