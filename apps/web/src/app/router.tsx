import { Button } from '@ai-gui/ui';
import { ArrowUp, BookOpen, FlaskConical, PanelLeftOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { createBrowserRouter, Outlet, useNavigate } from 'react-router-dom';
import { ChatPage } from '../features/chat/ChatPage';
import { SessionSidebar } from '../features/sessions/SessionSidebar';
import { useCreateSession } from '../lib/api-client/hooks';
import { useSessionStore } from './store';

function AppLayout() {
  const sidebarOpen = useSessionStore((s) => s.sidebarOpen);
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar);
  return (
    <div className="flex h-full bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      {sidebarOpen ? (
        <SessionSidebar />
      ) : (
        <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2">
          <Button size="sm" variant="ghost" onClick={toggleSidebar} aria-label="Open sidebar">
            <PanelLeftOpen />
          </Button>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
const SUGGESTIONS = [
  {
    title: 'Explain this codebase',
    prompt: 'Explain the architecture of this codebase, starting from the entry point.',
    icon: 'book',
  },
  {
    title: 'Review my changes',
    prompt: 'Review the uncommitted changes in this repo and point out risks.',
    icon: 'search',
  },
  {
    title: 'Write tests',
    prompt: 'Find the least-tested module in this repo and write tests for it.',
    icon: 'flask',
  },
] as const;

function SessionsHome() {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const setPendingPrompt = useSessionStore((s) => s.setPendingPrompt);
  const createSession = useCreateSession();
  const [draft, setDraft] = useState('');

  const startWith = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || createSession.isPending) return;
    createSession.mutate(
      {},
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
          setPendingPrompt(trimmed);
          void navigate(`/s/${session.id}`);
        },
      },
    );
  };
  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-2xl font-bold text-[hsl(var(--primary-foreground))]">
            ✦
          </span>
          <div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Welcome to AI-GUI</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-tight">How Can I Assist You?</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => startWith(s.prompt)}
              className="flex min-h-24 flex-col justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-left text-[13px] hover:border-[hsl(var(--primary)/0.6)] hover:bg-[hsl(var(--accent))]"
            >
              <span className="font-medium">{s.title}</span>
              <span className="text-[hsl(var(--muted-foreground))]">
                {s.icon === 'book' ? (
                  <BookOpen className="size-4" />
                ) : s.icon === 'search' ? (
                  <Search className="size-4" />
                ) : (
                  <FlaskConical className="size-4" />
                )}
              </span>
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startWith(draft);
          }}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[0_8px_24px_hsl(var(--foreground)/0.08)]"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                startWith(draft);
              }
            }}
            rows={2}
            placeholder="Ask anything or write your request…"
            aria-label="Start a new chat"
            className="w-full resize-none bg-transparent px-3 py-2 text-[13px] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
          />
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="px-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              ⏎ starts a new session · ⇧⏎ newline
            </span>
            <Button
              type="submit"
              disabled={!draft.trim() || createSession.isPending}
              aria-label="Send"
            >
              {createSession.isPending ? '…' : <ArrowUp />}
            </Button>
          </div>
        </form>
      </div>
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
