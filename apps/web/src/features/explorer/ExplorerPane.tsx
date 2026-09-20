import { Button, Input, Skeleton } from '@grove/ui';
import { CornerUpLeft, File, Folder, FolderOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { useDirEntries, useGrep } from '../../lib/api-client/hooks';
import { listDir } from '../../lib/api-client/rest';

interface ExplorerPaneProps {
  sessionId: string;
  onOpen: (path: string, range?: string) => void;
}

const RANGE_SUFFIX = /^(.*?):(\d+(?:-\d+)?)$/;

export function splitPathRange(input: string): { path: string; range?: string } {
  const match = RANGE_SUFFIX.exec(input.trim());
  if (match && match[1] !== undefined && match[2] !== undefined) {
    return { path: match[1], range: match[2] };
  }
  return { path: input.trim() };
}

export function ExplorerPane({ sessionId, onOpen }: ExplorerPaneProps) {
  const [dirPath, setDirPath] = useState('.');
  const [bar, setBar] = useState('.');
  const [probing, setProbing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const entriesQuery = useDirEntries(sessionId, dirPath);
  const searchPath = dirPath === '.' ? undefined : dirPath;
  // Content search over the directory in view (workspace root at `.`).
  const grep = useGrep(sessionId, searchQuery, searchPath, caseSensitive);

  const navigate = (path: string) => {
    setDirPath(path);
    setBar(path);
  };

  const handleGo = async () => {
    const { path, range } = splitPathRange(bar);
    if (!path || probing) return;
    if (range === undefined && (path.endsWith('/') || path === '.' || path === '..')) {
      navigate(path);
      return;
    }
    if (range !== undefined) {
      onOpen(path, range);
      return;
    }
    // Without a range we cannot tell file from dir without listing it; if the
    // current listing contains the name as a dir, navigate, else open as file.
    const hit = entriesQuery.data?.find((e) => e.path === path || e.name === path);
    if (hit) {
      if (hit.kind === 'dir') navigate(hit.path);
      else onOpen(path);
      return;
    }
    // Typed path outside the current listing: probe once. A listable path is
    // a directory; anything else falls back to opening as a file.
    setProbing(true);
    try {
      const probed = await listDir(sessionId, path);
      if (probed.ok) navigate(path);
      else onOpen(path);
    } finally {
      setProbing(false);
    }
  };

  const entries = [...(entriesQuery.data ?? [])].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 border-b border-[hsl(var(--border))] p-3">
        <Input
          value={bar}
          onChange={(e) => setBar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleGo();
          }}
          placeholder="path or path:start-end…"
          aria-label="Path"
          className="font-mono"
        />
        <Button size="sm" onClick={handleGo} disabled={probing}>
          Open
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(dirPath === '.' ? '..' : `${dirPath}/..`)}
          aria-label="Go up"
        >
          <CornerUpLeft />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {dirPath}
        </span>
      </div>

      <form
        className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setSearchQuery(search.trim() === '' ? null : search.trim());
        }}
      >
        <Search className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search file contents…"
          aria-label="Search contents"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
        />
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => {
              setCaseSensitive(e.target.checked);
              if (searchQuery !== null) setSearchQuery(search.trim());
            }}
            aria-label="Case sensitive search"
          />
          Aa
        </label>
        {searchQuery !== null ? (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => {
              setSearch('');
              setSearchQuery(null);
            }}
          >
            Clear
          </Button>
        ) : (
          <Button size="sm" variant="ghost" type="submit" disabled={search.trim() === ''}>
            Find
          </Button>
        )}
      </form>

      {searchQuery !== null && (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {grep.isFetching && (
            <p className="p-2 text-xs text-[hsl(var(--muted-foreground))]">Searching…</p>
          )}
          {grep.isError && (
            <p className="p-2 text-xs text-[hsl(var(--destructive))]">
              {grep.error instanceof Error ? grep.error.message : 'Search failed.'}
            </p>
          )}
          {grep.data && grep.data.files.length === 0 && !grep.isFetching && (
            <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
              No matches for “{searchQuery}”.
            </p>
          )}
          {grep.data && grep.data.files.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="px-1 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {grep.data.files.length} file(s) · {grep.data.matchCount} match(es)
                {grep.data.truncated ? ' · truncated' : ''}
              </p>
              <ul className="flex flex-col">
                {grep.data.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => onOpen(file.path)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-[hsl(var(--accent))]"
                    >
                      <File className="size-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                      <span className="min-w-0 flex-1 truncate">{file.path}</span>
                      {file.count > 0 && (
                        <span className="shrink-0 text-[hsl(var(--muted-foreground))]">
                          {file.count}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              <pre className="max-h-72 overflow-auto whitespace-pre rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px] leading-relaxed">
                {grep.data.text}
              </pre>
            </div>
          )}
        </div>
      )}

      {searchQuery === null && (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entriesQuery.isPending && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          )}
          {entriesQuery.isError && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
              <p className="text-xs text-[hsl(var(--destructive))]">
                {entriesQuery.error instanceof Error ? entriesQuery.error.message : 'List failed.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => entriesQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {entriesQuery.data && entries.length === 0 && (
            <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
              Empty directory.
            </p>
          )}
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => (entry.kind === 'dir' ? navigate(entry.path) : onOpen(entry.path))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--muted))]"
            >
              {entry.kind === 'dir' ? (
                <Folder className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              ) : (
                <File className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              )}
              <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
              {entry.size !== undefined && (
                <span className="shrink-0 text-[11px] text-[hsl(var(--muted-foreground))]">
                  {entry.size}b
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 border-t border-[hsl(var(--border))] px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
        <FolderOpen className="size-3.5 shrink-0" />
        Append :start-end to a path (e.g. src/app.ts:10-40) to open a line range.
      </p>
    </div>
  );
}
