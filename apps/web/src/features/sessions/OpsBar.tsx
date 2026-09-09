import { Button, Input } from '@ai-gui/ui';
import {
  Copy,
  Download,
  Eraser,
  FileText,
  GitFork,
  Link2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../../app/store';
import {
  useClearSession,
  useDropSession,
  useDumpSession,
  useExportHtml,
  useForkSession,
  useFreshSession,
  useRenameSession,
  useShareSession,
} from '../../lib/api-client/hooks';
import { useServerHealth } from './useServerHealth';

interface OpsBarProps {
  sessionId: string;
}

/**
 * Slim session ops: Fork + Delete stay visible; everything else lives in the
 * ⋯ menu. Clear/Fresh only render on runtimes that implement them (omp-rpc
 * throws OperationNotSupported) instead of failing on click.
 */
export function OpsBar({ sessionId }: OpsBarProps) {
  const navigate = useNavigate();
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const health = useServerHealth();
  const supportsContextOps = health.data?.runtime === 'sdk';

  const fork = useForkSession(sessionId);
  const clear = useClearSession(sessionId);
  const fresh = useFreshSession(sessionId);
  const drop = useDropSession();
  const rename = useRenameSession(sessionId);
  const share = useShareSession(sessionId);
  const exportHtml = useExportHtml(sessionId);
  const dump = useDumpSession(sessionId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dumpOpen, setDumpOpen] = useState(false);

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
    share.mutate(undefined, {
      onSuccess: async (data) => {
        setSharedUrl(data.url);
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
    exportHtml.mutate(undefined, {
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

  const menuItemClass =
    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))] disabled:opacity-50';

  return (
    <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
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
                {supportsContextOps && (
                  <>
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
                  </>
                )}
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
      {error && <p className="px-3 pb-1.5 text-xs text-[hsl(var(--destructive))]">{error}</p>}
      {sharedUrl && (
        <p className="flex items-center gap-1 px-3 pb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <Copy className="size-3" />
          <span className="truncate">{sharedUrl}</span>
          {copied && <span>(copied)</span>}
        </p>
      )}
      {dumpOpen && dump.data && (
        <pre className="mx-3 mb-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 text-xs">
          {dump.data.text}
        </pre>
      )}
    </div>
  );
}
