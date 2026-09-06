import { Button } from '@ai-gui/ui';
import { MessageSquarePlus, Plus } from 'lucide-react';
import { createBrowserRouter, Outlet, useNavigate } from 'react-router-dom';
import { ChatPage } from '../features/chat/ChatPage';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useCreateSession } from '../lib/api-client/hooks';
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

function SessionsHome() {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const createSession = useCreateSession();

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
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <MessageSquarePlus className="size-6 text-[hsl(var(--muted-foreground))]" />
      <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
        Select a session on the left, or start a new one.
      </p>
      <Button onClick={handleNew} disabled={createSession.isPending}>
        <Plus />
        New session
      </Button>
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
