import type { SessionInfo } from '@grove/core';
import {
  Button,
  IconButton,
  loadSashWidth,
  Panel,
  ResizeSash,
  Skeleton,
  StatusDot,
} from '@grove/ui';
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
import { formatBytes, formatCount } from '../../lib/format';
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
  interrupted: 'text-warning-strong',
  aborted: 'text-muted-foreground',
  error: 'text-destructive',
  pending: 'text-link',
  unknown: '',
};

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
        <StatusDot
          tone={online ? 'success' : 'muted'}
          className="absolute inline-flex h-full w-full animate-ping opacity-60"
        />
        <StatusDot label={online ? 'connected' : 'offline'} tone={online ? 'success' : 'muted'} />
      </span>
      <div className="min-w-0">
        <p className="text-small font-strong">{online ? 'Server connected' : 'Server offline'}</p>
        <p className="truncate font-mono text-meta text-muted-foreground">
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
          `flex h-7 min-w-0 flex-1 items-center gap-2 truncate rounded-md px-2 text-body hover:bg-foreground/6 ${
            isActive || activeSessionId === session.id
              ? 'bg-foreground/9 text-foreground'
              : 'text-foreground'
          }`
        }
      >
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{session.title || 'Untitled session'}</span>
        {session.status !== 'complete' && session.status !== 'unknown' && (
          <span
            title={`Last turn: ${session.status}`}
            className={`shrink-0 font-mono text-meta ${STATUS_CLASS[session.status]}`}
          >
            {session.status === 'pending' ? '•' : STATUS_GLYPH[session.status]}
          </span>
        )}
        <span
          title={`${session.messageCount} messages · ${formatBytes(session.sizeBytes)} on disk`}
          className="shrink-0 font-mono text-meta text-muted-foreground"
        >
          {formatCount(session.messageCount)}
        </span>
      </NavLink>
      <IconButton
        label={isPinned ? `Unpin ${session.title}` : `Pin ${session.title}`}
        title={isPinned ? 'Unpin' : 'Pin'}
        onClick={() => togglePin(session.id)}
        className={`shrink-0 ${isPinned ? '' : 'opacity-0 group-hover:opacity-100'}`}
      >
        {isPinned ? <PinOff /> : <Pin />}
      </IconButton>
    </div>
  );

  return (
    <aside
      style={{ width: sideWidth }}
      aria-label="Sessions"
      className="relative flex h-full shrink-0 flex-col rounded-md panel"
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
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-body font-strong text-primary-foreground">
          ✦
        </span>
        <h2 className="flex-1 text-body font-strong">Grove</h2>
        <span className="flex items-center gap-1">
          <IconButton label="Close sidebar" onClick={toggleSidebar}>
            <PanelLeftClose />
          </IconButton>
          <IconButton
            label="Search sessions"
            title="Search sessions"
            onClick={() => setSwitcherOpen(true)}
          >
            <Search />
          </IconButton>
          <IconButton
            label="Import session"
            title="Import a session from Claude Code or Codex CLI"
            onClick={() => setImportOpen(true)}
          >
            <Download />
          </IconButton>
          <IconButton
            label={`Theme: ${themeMode} (click to change)`}
            title="Toggle theme"
            onClick={() => {
              const next = nextTheme(themeMode);
              setThemeMode(next);
              setTheme(next);
            }}
          >
            {themeMode === 'dark' ? <Moon /> : themeMode === 'light' ? <Sun /> : <Monitor />}
          </IconButton>
        </span>
      </div>
      <div className="px-3 pb-2">
        <Button
          className="w-full bg-secondary/40 hover:bg-secondary/65"
          variant="neutral"
          onClick={handleNew}
          disabled={createSession.isPending}
        >
          <Plus />
          New Chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area px-2 pb-2">
        {sessionsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {sessionsQuery.isError && (
          <Panel tone="plain" className="flex flex-col gap-2 p-3">
            <p className="text-small text-destructive">Failed to load sessions.</p>
            <Button variant="outline" onClick={() => sessionsQuery.refetch()}>
              Retry
            </Button>
          </Panel>
        )}
        {sessionsQuery.data?.length === 0 && (
          <Panel tone="plain" className="flex flex-col items-center gap-2 p-4 text-center">
            <MessageSquarePlus className="size-5 text-muted-foreground" />
            <p className="text-small text-muted-foreground">No chats yet.</p>
          </Panel>
        )}
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <section key={group.key} aria-label={GROUP_TITLES[group.key]} className="mt-1">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                  aria-expanded={!collapsed[group.key]}
                  className="flex w-full items-center gap-1 px-2 pb-1 pt-2 section-label hover:text-foreground"
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
      <Panel tone="inset" className="m-2 flex items-center gap-2 p-2.5">
        <StatusCard />
        <IconButton
          label="Open settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          className="shrink-0"
        >
          <Settings />
        </IconButton>
      </Panel>
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
