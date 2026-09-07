import { Button } from '@ai-gui/ui';
import { MessageSquarePlus, Plus } from 'lucide-react';
import { createBrowserRouter, Outlet, useNavigate } from 'react-router-dom';
import { ChatPage } from '../features/chat/ChatPage';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useCreateSession, useSessions } from '../lib/api-client/hooks';
import { useSessionStore } from './store';

function AppLayout() {
  return (
    <div className="flex h-full bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <SessionSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return '';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function SessionsHome() {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const createSession = useCreateSession();
  const sessionsQuery = useSessions();

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

  const openSession = (id: string) => {
    setActiveSessionId(id);
    void navigate(`/s/${id}`);
  };

  const sessions = [...(sessionsQuery.data ?? [])].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center gap-6 overflow-y-auto p-8">
      <div className="flex flex-col items-start gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">AI-GUI</h1>
        <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
          Chat with coding agents, browse files, run tools — pick up a session or start fresh.
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button onClick={handleNew} disabled={createSession.isPending}>
            <Plus />
            New session
          </Button>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">⌘K for commands</span>
        </div>
      </div>

      <section aria-label="Recent sessions" className="flex min-h-0 flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          Recent sessions
        </h2>
        {sessionsQuery.isPending && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading…</p>
        )}
        {sessionsQuery.isError && (
          <p className="text-xs text-[hsl(var(--destructive))]">Failed to load sessions.</p>
        )}
        {sessionsQuery.data && sessions.length === 0 && (
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
            No sessions yet — create one above to get started.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {sessions.slice(0, 8).map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => openSession(session.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-left hover:bg-[hsl(var(--accent))]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">
                    {session.title || 'Untitled session'}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {session.cwd}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                  {timeAgo(session.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <SessionsHome /> },
      { path: 's/:id', element: <ChatPage /> },
    ],
  },
]);
