import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import CodeMirror from '@uiw/react-codemirror';
import { Diff, Save, TriangleAlert, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { P2aFileContent } from '../../lib/api-client/hooks';
import { useEditFile, useFileContent, useWriteFile } from '../../lib/api-client/hooks';
import { splitPathRange } from '../explorer/ExplorerPane';

interface EditorPaneProps {
  sessionId: string;
  path: string;
  range?: string;
  onPathChange: (path: string, range?: string) => void;
}

type Mode = 'save' | 'patch';

function languageFor(path: string) {
  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return [javascript({ jsx: true, typescript: true })];
  if (/\.py$/.test(path)) return [python()];
  if (/\.json$/.test(path)) return [json()];
  if (/\.md$/.test(path)) return [markdown()];
  return [];
}

interface DiffLine {
  type: ' ' | '-' | '+';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Minimal line diff (LCS backtrack). Null when the grid would be too large. */
export function lineDiff(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  if (a.length * b.length > 4_000_000) return null;
  const dp: Uint32Array[] = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = dp[i];
      const next = dp[i + 1];
      const ai = a[i];
      const bj = b[j];
      if (!row || !next || ai === undefined || bj === undefined) continue;
      const diag = next[j + 1] ?? 0;
      const down = next[j] ?? 0;
      const right = row[j + 1] ?? 0;
      row[j] = ai === bj ? diag + 1 : Math.max(down, right);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const av = a[i];
    const bv = b[j];
    if (av === undefined || bv === undefined) break;
    if (av === bv) {
      out.push({ type: ' ', text: av, oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({ type: '-', text: av, oldNo: i + 1, newNo: null });
      i++;
    } else {
      out.push({ type: '+', text: bv, oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < a.length) {
    const av = a[i];
    if (av === undefined) break;
    out.push({ type: '-', text: av, oldNo: i + 1, newNo: null });
    i++;
  }
  while (j < b.length) {
    const bv = b[j];
    if (bv === undefined) break;
    out.push({ type: '+', text: bv, oldNo: null, newNo: j + 1 });
    j++;
  }
  return out;
}

export function EditorPane({ sessionId, path, range, onPathChange }: EditorPaneProps) {
  const [bar, setBar] = useState(path);
  const [value, setValue] = useState('');
  const [baseText, setBaseText] = useState<string | null>(null);
  const [loadedTag, setLoadedTag] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('save');
  const [patchInput, setPatchInput] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fileQuery = useFileContent(sessionId, path, range);
  const writeFile = useWriteFile(sessionId);
  const editFile = useEditFile(sessionId);

  useEffect(() => {
    setBar(range ? `${path}:${range}` : path);
  }, [path, range]);

  const serverFile: P2aFileContent | undefined = fileQuery.data;
  useEffect(() => {
    if (!serverFile) return;
    // Adopt server text on first load, path change, or while still pristine.
    if (loadedPath !== path || baseText === null || value === baseText) {
      setValue(serverFile.text);
      setBaseText(serverFile.text);
      setLoadedTag(serverFile.tag ?? null);
      setLoadedPath(path);
    }
  }, [serverFile, path, loadedPath, baseText, value]);

  const dirty = baseText !== null && value !== baseText;
  const stale = dirty && loadedTag !== null && serverFile?.tag !== loadedTag;
  const diff = useMemo(
    () => (showDiff && baseText !== null ? lineDiff(baseText, value) : null),
    [showDiff, baseText, value],
  );
  const changedCount = useMemo(() => diff?.filter((l) => l.type !== ' ').length ?? 0, [diff]);

  const handleGo = () => {
    const parsed = splitPathRange(bar);
    if (parsed.path) onPathChange(parsed.path, parsed.range);
  };

  const handleSave = () => {
    setNotice(null);
    writeFile.mutate(
      { path, content: value },
      {
        onSuccess: (res) => {
          setBaseText(value);
          setLoadedTag(res.tag);
          setNotice(`Saved ${res.bytes} bytes (tag ${res.tag}).`);
        },
        onError: (err) => setNotice(err instanceof Error ? err.message : 'Save failed.'),
      },
    );
  };

  const handlePatch = () => {
    setNotice(null);
    if (!patchInput.trim()) {
      setNotice('Patch input is empty.');
      return;
    }
    editFile.mutate(
      { path, tag: loadedTag ?? serverFile?.tag ?? '', input: patchInput },
      {
        onSuccess: (res) => {
          setNotice(
            res.applied ? `Patch applied (tag ${res.tag}).` : 'Server did not apply the patch.',
          );
          if (res.applied) {
            setLoadedTag(res.tag);
            setPatchInput('');
            void fileQuery.refetch();
          }
        },
        onError: (err) => setNotice(err instanceof Error ? err.message : 'Patch failed.'),
      },
    );
  };

  const busy = writeFile.isPending || editFile.isPending;

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
          aria-label="File path"
          className="font-mono"
        />
        <Button size="sm" onClick={handleGo}>
          Load
        </Button>
      </div>

      {!path && (
        <div className="flex flex-1 items-center justify-center p-4 text-center">
          <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
            Pick a file in the Explorer tab, or type a path above.
          </p>
        </div>
      )}

      {path && fileQuery.isPending && (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {path && fileQuery.isError && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-[13px] text-[hsl(var(--destructive))]">
            {fileQuery.error instanceof Error ? fileQuery.error.message : 'Failed to load file.'}
          </p>
          <Button size="sm" variant="outline" onClick={() => fileQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {path && serverFile && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-1.5 text-xs">
            <Badge variant="outline" title="Hashline snapshot tag the next patch applies against">
              tag: {serverFile.tag ?? 'none'}
            </Badge>
            {serverFile.truncated && (
              <Badge variant="secondary">truncated — range-limited view</Badge>
            )}
            {dirty ? <Badge variant="secondary">modified</Badge> : <Badge>clean</Badge>}
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant={mode === 'save' ? 'default' : 'ghost'}
                onClick={() => setMode('save')}
              >
                <Save />
                Save
              </Button>
              <Button
                size="sm"
                variant={mode === 'patch' ? 'default' : 'ghost'}
                onClick={() => setMode('patch')}
              >
                <WandSparkles />
                Patch
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowDiff((v) => !v)}>
                <Diff />
                Diff
              </Button>
            </div>
          </div>

          {stale && (
            <p className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))] px-3 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              <TriangleAlert className="size-3.5 shrink-0" />
              Snapshot moved (tag {loadedTag} → {serverFile.tag ?? 'none'}) while you have unsaved
              edits — patches apply against the loaded tag and may be rejected.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {showDiff ? (
              <div className="p-2 font-mono text-xs">
                {diff === null ? (
                  <p className="p-2 text-[hsl(var(--muted-foreground))]">
                    {baseText !== null
                      ? 'File too large for inline diff preview.'
                      : 'Nothing to compare yet.'}
                  </p>
                ) : (
                  <>
                    <p className="px-2 pb-1 text-[hsl(var(--muted-foreground))]">
                      {changedCount} changed line{changedCount === 1 ? '' : 's'}
                    </p>
                    {diff.map((line, idx) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: diff rows are positional
                        key={idx}
                        className={
                          line.type === '+'
                            ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                            : line.type === '-'
                              ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                              : 'text-[hsl(var(--muted-foreground))]'
                        }
                      >
                        <span className="inline-block w-8 shrink-0 select-none text-right opacity-60">
                          {line.newNo ?? line.oldNo}
                        </span>{' '}
                        <span className="select-none opacity-60">{line.type}</span> {line.text}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <CodeMirror
                value={value}
                theme={document.documentElement.classList.contains('dark') ? oneDark : undefined}
                extensions={languageFor(path)}
                onChange={setValue}
                basicSetup={{ lineNumbers: true }}
                className="h-full text-[13px]"
              />
            )}
          </div>

          {mode === 'patch' && (
            <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] p-3">
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                Hashline patch applied against tag {loadedTag ?? serverFile.tag ?? 'none'} — e.g.
                PUT 3.=5: followed by +lines.
              </p>
              <textarea
                value={patchInput}
                onChange={(e) => setPatchInput(e.target.value)}
                placeholder={'PUT 3.=5:\n+new line'}
                rows={4}
                aria-label="Hashline patch input"
                className="w-full rounded-[4px] border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
              />
              <Button size="sm" onClick={handlePatch} disabled={busy}>
                <WandSparkles />
                {editFile.isPending ? 'Applying…' : 'Apply patch'}
              </Button>
            </div>
          )}

          {mode === 'save' && (
            <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] p-3">
              <Button size="sm" onClick={handleSave} disabled={busy || !dirty}>
                <Save />
                {writeFile.isPending ? 'Saving…' : 'Save (write whole file)'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => fileQuery.refetch()}>
                Reload
              </Button>
            </div>
          )}

          {(notice || writeFile.isError || editFile.isError) && (
            <p className="border-t border-[hsl(var(--border))] px-3 py-1 text-xs text-[hsl(var(--destructive))]">
              {notice ??
                (writeFile.error instanceof Error ? writeFile.error.message : 'Operation failed.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
