import { Button, Input } from '@ai-gui/ui';
import {
  Copy,
  Download,
  Eraser,
  FileText,
  FolderInput,
  GitFork,
  Info,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Shrink,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import {
  useClearSession,
  useCompactSession,
  useDropSession,
  useDumpSession,
  useExportHtml,
  useForkSession,
  useFreshSession,
  useMoveSession,
  useRenameSession,
  useRetryTurn,
  useShareSession,
} from '../../lib/api-client/hooks';
import { SessionStatsPanel } from './SessionStatsPanel';

interface OpsBarProps {
  sessionId: string;
  /** Session identity controls rendered at the row start (same panel). */
  meta?: ReactNode;
}

/**
 * Slim session ops: Fork + Delete stay visible; everything else lives in the
 * ⋯ menu. The runtime is SDK-only, so Clear/Fresh always render.
 */
export function OpsBar({ sessionId, meta }: OpsBarProps) {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);

  const fork = useForkSession(sessionId);
  const clear = useClearSession(sessionId);
  const fresh = useFreshSession(sessionId);
  const compact = useCompactSession(sessionId);
  const retry = useRetryTurn(sessionId);
  const drop = useDropSession();
  const rename = useRenameSession(sessionId);
  const move = useMoveSession(sessionId);
  const share = useShareSession(sessionId);
  const exportHtml = useExportHtml(sessionId);
  const dump = useDumpSession(sessionId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [movingCwd, setMovingCwd] = useState(false);
  const [cwd, setCwd] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [userThemes, setUserThemes] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dumpOpen, setDumpOpen] = useState(false);
  const [dumpCopied, setDumpCopied] = useState(false);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  const closeMenu = () => setMenuOpen(false);

  const handleFork = () => {
    setError(null);
    fork.mutate(undefined, {
      onSuccess: (session) => {
        setActiveSessionId(session.id);
        void navigate(`/s/${session.id}`);
      },
      onError: (err) => fail(err, 'Fork failed'),
    });
  };

  const handleDrop = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    drop.mutate(sessionId, {
      onSuccess: () => {
        setActiveSessionId(null);
        void navigate('/');
      },
      onError: (err) => fail(err, 'Delete failed'),
    });
  };

  const handleSaveTitle = () => {
    const next = title.trim();
    if (!next) {
      setError('Title cannot be empty.');
      return;
    }
    setError(null);
    rename.mutate(next, {
      onSuccess: () => setEditingTitle(false),
      onError: (err) => fail(err, 'Rename failed'),
    });
  };

  const handleShare = () => {
    setError(null);
    setCopied(false);
    setShareNote(null);
    share.mutate(undefined, {
      onSuccess: async (data) => {
        setSharedUrl(data.url);
        const notes: string[] = [];
        if (data.truncated) notes.push('truncated');
        if (data.gistUrl) notes.push(`gist: ${data.gistUrl}`);
        setShareNote(notes.length > 0 ? notes.join(' · ') : null);
        try {
          await navigator.clipboard.writeText(data.url);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      },
      onError: (err) => fail(err, 'Share failed'),
    });
  };

  const handleExport = () => {
    setError(null);
    exportHtml.mutate(userThemes, {
      onSuccess: (data) => {
        const blob = new Blob([data.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session-${sessionId}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      onError: (err) => fail(err, 'Export failed'),
    });
  };

  const handleDump = () => {
    if (dumpOpen) {
      setDumpOpen(false);
      return;
    }
    setError(null);
    dump.mutate(undefined, {
      onSuccess: () => setDumpOpen(true),
      onError: (err) => fail(err, 'Dump failed'),
    });
  };

  const handleMove = () => {
    const next = cwd.trim();
    if (!next) {
      setError('Directory cannot be empty.');
      return;
    }
    setError(null);
    move.mutate(next, {
      onSuccess: () => setMovingCwd(false),
      onError: (err) => fail(err, 'Move failed'),
    });
  };

  const handleCopyDump = async () => {
    if (!dump.data) return;
    try {
      await navigator.clipboard.writeText(dump.data.text);
      setDumpCopied(true);
    } catch {
      setDumpCopied(false);
    }
  };

  const menuItemClass =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))] disabled:opacity-50';

  return (
    <div className="rounded-t-md border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
        {meta}
        {meta && <div aria-hidden="true" className="mx-1 h-4 w-px bg-[hsl(var(--border))]" />}
        <Button size="sm" variant="ghost" onClick={handleFork} disabled={fork.isPending}>
          <GitFork />
          Fork
        </Button>
        {confirmDelete ? (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="destructive" onClick={handleDrop} disabled={drop.isPending}>
              <Trash2 />
              Confirm delete?
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={handleDrop} disabled={drop.isPending}>
            <Trash2 />
            Delete
          </Button>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More session actions"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal />
          </Button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={closeMenu}
              />
              <div
                role="menu"
                aria-label="Session actions"
                className="absolute right-0 z-50 mt-1 flex w-52 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeMenu();
                    setTitle('');
                    setEditingTitle(true);
                  }}
                >
                  <Pencil className="size-4 shrink-0" />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeMenu();
                    setCwd('');
                    setMovingCwd(true);
                  }}
                >
                  <FolderInput className="size-4 shrink-0" />
                  Move directory…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  onClick={() => {
                    closeMenu();
                    setInfoOpen((v) => !v);
                  }}
                  aria-expanded={infoOpen}
                >
                  <Info className="size-4 shrink-0" />
                  Session info
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={clear.isPending}
                  title="Drop model context in place (transcript kept)"
                  onClick={() => {
                    closeMenu();
                    setError(null);
                    clear.mutate(undefined, {
                      onError: (err) => fail(err, 'Clear failed'),
                    });
                  }}
                >
                  <Eraser className="size-4 shrink-0" />
                  Clear context
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={fresh.isPending}
                  title="Rotate provider stream state (transcript kept)"
                  onClick={() => {
                    closeMenu();
                    setError(null);
                    fresh.mutate(undefined, {
                      onError: (err) => fail(err, 'Fresh failed'),
                    });
                  }}
                >
                  <RefreshCw className="size-4 shrink-0" />
                  Fresh stream
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={compact.isPending}
                  title="Summarize history into a compacted checkpoint (transcript kept)"
                  onClick={() => {
                    closeMenu();
                    setError(null);
                    compact.mutate(undefined, {
                      onError: (err) => fail(err, 'Compact failed'),
                    });
                  }}
                >
                  <Shrink className="size-4 shrink-0" />
                  Compact history
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={retry.isPending}
                  title="Re-run the last failed turn"
                  onClick={() => {
                    closeMenu();
                    setError(null);
                    retry.mutate(undefined, {
                      onError: (err) => fail(err, 'Retry failed'),
                      onSuccess: (data) => {
                        if (!data.retried) setError('Nothing to retry.');
                      },
                    });
                  }}
                >
                  <RotateCcw className="size-4 shrink-0" />
                  Retry turn
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={share.isPending}
                  onClick={() => {
                    closeMenu();
                    handleShare();
                  }}
                >
                  <Link2 className="size-4 shrink-0" />
                  Share
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={exportHtml.isPending}
                  onClick={() => {
                    closeMenu();
                    handleExport();
                  }}
                >
                  <Download className="size-4 shrink-0" />
                  Export HTML
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuItemClass}
                  disabled={dump.isPending}
                  onClick={() => {
                    closeMenu();
                    handleDump();
                  }}
                >
                  <FileText className="size-4 shrink-0" />
                  {dumpOpen ? 'Hide dump' : 'Dump journal'}
                </button>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]">
                  <input
                    type="checkbox"
                    checked={userThemes}
                    onChange={(e) => setUserThemes(e.target.checked)}
                    aria-label="Export with terminal theme"
                  />
                  Terminal theme export
                </label>
              </div>
            </>
          )}
        </div>
      </div>
      {editingTitle && (
        <div className="flex items-center gap-1 px-3 pb-1.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New title"
            aria-label="New session title"
            className="h-7 w-40"
          />
          <Button size="sm" onClick={handleSaveTitle} disabled={rename.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
            Cancel
          </Button>
        </div>
      )}
      {movingCwd && (
        <div className="flex items-center gap-1 px-3 pb-1.5">
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/new/working/directory"
            aria-label="New working directory"
            className="h-7 w-64"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleMove();
            }}
          />
          <Button size="sm" onClick={handleMove} disabled={move.isPending}>
            Move
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMovingCwd(false)}>
            Cancel
          </Button>
        </div>
      )}
      {infoOpen && <SessionStatsPanel sessionId={sessionId} />}
      {error && <p className="px-3 pb-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>}
      {sharedUrl && (
        <p className="flex items-center gap-1 px-3 pb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <Copy className="size-3" />
          <span className="truncate">{sharedUrl}</span>
          {copied && <span>(copied)</span>}
          {shareNote && <span>({shareNote})</span>}
        </p>
      )}
      {dumpOpen && dump.data && (
        <div className="mx-3 mb-2 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-2 py-1">
            <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
              Journal dump
            </span>
            <Button size="sm" variant="ghost" onClick={handleCopyDump} aria-label="Copy dump">
              <Copy className="size-3" />
              {dumpCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap p-2 text-xs">
            {dump.data.text}
          </pre>
        </div>
      )}
    </div>
  );
}
