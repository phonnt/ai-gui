import type { SessionInfo } from '@grove/core';
import { Button, loadSashWidth, ResizeSash, Skeleton } from '@grove/ui';
import {
  ChevronDown,
  ChevronRight,
  Download,
  MessageSquare,
  MessageSquarePlus,
  Monitor,
  Moon,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import { getTheme, nextTheme, setTheme, type ThemeMode } from '../../app/theme';
import { useCreateSession, useSessions } from '../../lib/api-client/hooks';
import { SettingsModal } from '../settings/SettingsModal';
import { ForeignImportDialog } from './ForeignImportDialog';
import { SessionSwitcher } from './SessionSwitcher';
import { useServerHealth } from './useServerHealth';

type Bucket = 'pinned' | 'today' | 'yesterday' | 'week' | 'older';

/** Lifecycle markers mirroring the TUI session picker (complete has none). */
const STATUS_GLYPH: Record<Exclude<SessionInfo['status'], 'complete'>, string> = {
  interrupted: '!',
  aborted: '×',
  error: '✗',
  pending: '•',
  unknown: '',
};

const STATUS_CLASS: Record<SessionInfo['status'], string> = {
  complete: '',
  interrupted: 'text-[hsl(var(--amber))]',
  aborted: 'text-[hsl(var(--muted-foreground))]',
  error: 'text-[hsl(var(--destructive))]',
  pending: 'text-[hsl(var(--primary))]',
  unknown: '',
};

/** 850 → 850, 12_400 → 12.4k (list rows stay narrow). */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const GROUP_TITLES: Record<Bucket, string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  older: 'Older',
};

function dayBucket(iso: string, now: Date): Exclude<Bucket, 'pinned'> {
  const day = new Date(iso);
  if (Number.isNaN(day.getTime())) return 'older';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(day)) / 86_400_000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 7) return 'week';
  return 'older';
}

function StatusCard() {
  const health = useServerHealth();
  const online = health.data?.ok === true;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="relative flex size-2.5 shrink-0">
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
            online ? 'bg-emerald-500' : 'bg-[hsl(var(--muted-foreground))]'
          }`}
        />
        <span
          className={`relative inline-flex size-2.5 rounded-full ${
            online ? 'bg-emerald-500' : 'bg-[hsl(var(--muted-foreground))]'
          }`}
        />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium">{online ? 'Server connected' : 'Server offline'}</p>
        <p className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
          {health.data ? `${health.data.runtime} · v${health.data.version}` : 'retrying…'}
        </p>
      </div>
    </div>
  );
}

export function SessionSidebar() {
  const navigate = useNavigate();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const pins = useSessionStore((s) => s.pins);
  const togglePin = useSessionStore((s) => s.togglePin);
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar);
  const sessionsQuery = useSessions();
  const createSession = useCreateSession();
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getTheme());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sideWidth, setSideWidth] = useState<number>(() =>
    loadSashWidth('grove-sidebar-w', 240, 200, 480),
  );
  const handleNew = () => {
    createSession.mutate(
      {},
      {
        onSuccess: (session) => {
          setActiveSessionId(session.id);
          navigate(`/s/${session.id}`);
        },
      },
    );
  };

  const now = new Date();
  const sessions = [...(sessionsQuery.data ?? [])].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1,
  );
  const pinned = sessions.filter((s) => pins.includes(s.id));
  const unpinned = sessions.filter((s) => !pins.includes(s.id));
  const groups: { key: Bucket; items: SessionInfo[] }[] = [
    { key: 'pinned', items: pinned },
    { key: 'today', items: unpinned.filter((s) => dayBucket(s.updatedAt, now) === 'today') },
    {
      key: 'yesterday',
      items: unpinned.filter((s) => dayBucket(s.updatedAt, now) === 'yesterday'),
    },
    { key: 'week', items: unpinned.filter((s) => dayBucket(s.updatedAt, now) === 'week') },
    { key: 'older', items: unpinned.filter((s) => dayBucket(s.updatedAt, now) === 'older') },
  ];

  const row = (session: SessionInfo, isPinned: boolean) => (
    <div key={session.id} className="group mb-0.5 flex items-center gap-0.5">
      <NavLink
        to={`/s/${session.id}`}
        onClick={() => setActiveSessionId(session.id)}
        className={({ isActive }) =>
          `flex min-w-0 flex-1 items-center gap-2 truncate rounded-md px-2 py-1.5 text-[13px] hover:bg-[hsl(var(--foreground)/0.06)] ${
            isActive || activeSessionId === session.id
              ? 'bg-[hsl(var(--foreground)/0.09)] text-[hsl(var(--foreground))]'
              : 'text-[hsl(var(--foreground))]'
          }`
        }
      >
        <MessageSquare className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled session'}</span>
        {session.status !== 'complete' && session.status !== 'unknown' && (
          <span
            title={`Last turn: ${session.status}`}
            className={`shrink-0 font-mono text-[10px] ${STATUS_CLASS[session.status]}`}
          >
            {session.status === 'pending' ? '•' : STATUS_GLYPH[session.status]}
          </span>
        )}
        <span
          title={`${session.messageCount} messages · ${formatBytes(session.sizeBytes)} on disk`}
          className="shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]"
        >
          {formatCount(session.messageCount)}
        </span>
      </NavLink>
      <Button
        size="sm"
        variant="ghost"
        aria-label={isPinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
        title={isPinned ? 'Unpin' : 'Pin'}
        onClick={() => togglePin(session.id)}
        className={`shrink-0 px-1.5 ${isPinned ? '' : 'opacity-0 group-hover:opacity-100'}`}
      >
        {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </Button>
    </div>
  );

  return (
    <aside
      style={{ width: sideWidth }}
      className="relative flex h-full shrink-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <ResizeSash
        label="Resize sidebar"
        direction="right"
        value={sideWidth}
        min={200}
        max={480}
        defaultValue={240}
        storageKey="grove-sidebar-w"
        onChange={setSideWidth}
        className="absolute inset-y-0 -right-[9px] z-10 w-2"
      />
      <div className="flex items-center gap-2 p-3">
        <span className="flex size-6 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[13px] font-bold text-[hsl(var(--primary-foreground))]">
          ✦
        </span>
        <h2 className="flex-1 text-[13px] font-semibold">Grove</h2>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={toggleSidebar} aria-label="Close sidebar">
            <PanelLeftClose />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSwitcherOpen(true)}
            aria-label="Search sessions"
            title="Search sessions"
          >
            <Search />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setImportOpen(true)}
            aria-label="Import session"
            title="Import a session from Claude Code or Codex CLI"
          >
            <Download />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Theme: ${themeMode} (click to change)`}
            title="Toggle theme"
            onClick={() => {
              const next = nextTheme(themeMode);
              setThemeMode(next);
              setTheme(next);
            }}
          >
            {themeMode === 'dark' ? <Moon /> : themeMode === 'light' ? <Sun /> : <Monitor />}
          </Button>
        </span>
      </div>
      <div className="px-3 pb-2">
        <Button
          className="w-full bg-[hsl(var(--secondary)/0.4)] hover:bg-[hsl(var(--secondary)/0.65)]"
          variant="secondary"
          onClick={handleNew}
          disabled={createSession.isPending}
        >
          <Plus />
          New Chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {sessionsQuery.isPending && (
          <div className="flex flex-col gap-2">
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
            <p className="text-xs text-[hsl(var(--muted-foreground))]">No chats yet.</p>
          </div>
        )}
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <section key={group.key} aria-label={GROUP_TITLES[group.key]} className="mt-1">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                  aria-expanded={!collapsed[group.key]}
                  className="flex w-full items-center gap-1 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                >
                  {collapsed[group.key] ? (
                    <ChevronRight className="size-3" />
                  ) : (
                    <ChevronDown className="size-3" />
                  )}
                  {GROUP_TITLES[group.key]}
                </button>
                {!collapsed[group.key] && group.items.map((s) => row(s, group.key === 'pinned'))}
              </section>
            ),
        )}
      </div>
      <div className="m-2 flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5">
        <StatusCard />
        <Button
          size="sm"
          variant="ghost"
          aria-label="Open settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          className="shrink-0"
        >
          <Settings />
        </Button>
      </div>
      <SessionSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <ForeignImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setActiveSessionId(id);
          navigate(`/s/${id}`);
        }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </aside>
  );
}
