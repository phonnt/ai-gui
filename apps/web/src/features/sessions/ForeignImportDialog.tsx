import type { ForeignSessionSourceDto } from '@grove/protocol';
import { Button, Input, Skeleton } from '@grove/ui';
import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForeignSessions, useImportForeignSession } from '../../lib/api-client/hooks';

type ForeignSessionSource = ForeignSessionSourceDto;

interface ForeignImportDialogProps {
  open: boolean;
  /** Source preselected when the dialog opens (store-driven). */
  initialSource?: ForeignSessionSource;
  onClose: () => void;
  /** Called with the imported session so the shell can navigate to it. */
  onImported: (sessionId: string) => void;
  /** cwd used when the recorded one no longer exists. */
  fallbackCwd?: string;
}

const SOURCES: { id: ForeignSessionSource; label: string }[] = [
  { id: 'codex', label: 'Codex CLI' },
  { id: 'claude', label: 'Claude Code' },
];

/**
 * Import a session from another coding agent (TUI `/resume @claude|@codex`).
 * The import writes a copy under a fresh OMP identity; the source transcript
 * is only read.
 */
export function ForeignImportDialog({
  open,
  initialSource = 'codex',
  onClose,
  onImported,
  fallbackCwd,
}: ForeignImportDialogProps) {
  const [source, setSource] = useState<ForeignSessionSource>(initialSource);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Follow the store's selection while the dialog stays mounted.
  useEffect(() => {
    if (open) setSource(initialSource);
  }, [open, initialSource]);
  const sessionsQuery = useForeignSessions(source, open);
  const importSession = useImportForeignSession();

  const sessions = useMemo(() => {
    const all = sessionsQuery.data ?? [];
    const needle = filter.trim().toLowerCase();
    if (needle === '') return all;
    return all.filter(
      (session) =>
        session.title.toLowerCase().includes(needle) ||
        session.cwd.toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle),
    );
  }, [sessionsQuery.data, filter]);

  if (!open) return null;

  const runImport = (path: string) => {
    setError(null);
    importSession.mutate(
      { source, path, ...(fallbackCwd ? { fallbackCwd } : {}) },
      {
        onSuccess: (session) => {
          onImported(session.id);
          onClose();
        },
        onError: (err) => setError(err.message),
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Import session"
    >
      <button
        type="button"
        aria-label="Close import dialog"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg">
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] p-2">
          <Download className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <h2 className="flex-1 text-[13px] font-semibold">Import session</h2>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-b border-[hsl(var(--border))] p-2">
          {SOURCES.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={source === option.id ? 'default' : 'outline'}
              aria-pressed={source === option.id}
              onClick={() => {
                setSource(option.id);
                setFilter('');
              }}
            >
              {option.label}
            </Button>
          ))}
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title, path or id…"
            aria-label="Filter foreign sessions"
            className="h-7 min-w-40 flex-1 font-mono text-xs"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessionsQuery.isPending && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {sessionsQuery.isError && (
            <p className="p-2 text-xs text-[hsl(var(--destructive))]">
              {sessionsQuery.error instanceof Error
                ? sessionsQuery.error.message
                : 'Could not list sessions.'}
            </p>
          )}
          {sessionsQuery.data && sessions.length === 0 && (
            <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
              {filter.trim() === ''
                ? `No ${source === 'codex' ? 'Codex' : 'Claude'} sessions found on this machine.`
                : 'No session matches the filter.'}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {sessions.map((session) => (
              <li
                key={session.path}
                className="flex items-start gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]" title={session.title}>
                    {session.title || session.id}
                  </p>
                  <p
                    className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]"
                    title={session.cwd}
                  >
                    {session.cwd || '(no cwd)'} · {session.messageCount} msgs ·{' '}
                    {session.updatedAt.slice(0, 10)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importSession.isPending}
                  onClick={() => runImport(session.path)}
                >
                  Import
                </Button>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="px-2 pb-2 text-xs text-[hsl(var(--destructive))]">{error}</p>}
        <p className="border-t border-[hsl(var(--border))] px-2 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          Imports a copy; the source transcript is never modified.
        </p>
      </div>
    </div>
  );
}
