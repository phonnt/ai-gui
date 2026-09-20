import { Button, Skeleton } from '@ai-gui/ui';
import { Camera, Globe, Monitor, MousePointerClick, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useBrowserAction, useComputerAction } from '../../lib/api-client/hooks';

type Mode = 'web' | 'desktop';

/** One clickable element parsed out of an aria snapshot line. */
interface SnapshotRow {
  ref: string;
  label: string;
}

/**
 * Rows carrying a `[ref=eN]` handle in an aria snapshot, e.g.
 * `  - heading "Example Domain" [level=1] [ref=e2]:`.
 */
function parseSnapshotRows(text: string): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const line of text.split('\n')) {
    const ref = /\[ref=([^\]]+)\]/.exec(line)?.[1];
    if (!ref) continue;
    const label = line
      .replace(/^\s*-\s*/, '')
      .replace(/\[ref=[^\]]+\]:?/, '')
      .trim();
    rows.push({ ref, label: label || ref });
  }
  return rows.slice(0, 200);
}

/**
 * Drive the SDK's `browser` / `computer` preludes from the web (TUI `/browser`
 * and `/computer`). The pane only composes prelude calls — tab supervision,
 * CDP and the desktop controller stay inside the SDK.
 */
export function BrowserPane({ sessionId }: { sessionId: string }) {
  const [mode, setMode] = useState<Mode>('web');
  const [url, setUrl] = useState('https://example.com');
  const [selector, setSelector] = useState('');
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const browser = useBrowserAction(sessionId);
  const computer = useComputerAction(sessionId);

  const pending = browser.isPending || computer.isPending;

  const apply = (
    result: { text?: string; details?: unknown; images?: string[] },
    label: string,
    snapshotOf?: string,
  ) => {
    setImages(result.images ?? []);
    const details = result.details ? JSON.stringify(result.details, null, 1) : '';
    setOutput([result.text ?? '', details].filter(Boolean).join('\n').slice(0, 20_000));
    const snapshot = snapshotOf
      ? String((result.details as Record<string, unknown> | undefined)?.[snapshotOf] ?? '')
      : '';
    setRows(snapshot ? parseSnapshotRows(snapshot) : []);
    setNote(result.images?.length ? `${label} · ${result.images.length} image(s)` : label);
  };

  const runBrowser = (params: Record<string, unknown>, label: string, snapshotOf?: string) => {
    setNote(null);
    setOutput(null);
    setImages([]);
    setRows([]);
    browser.mutate(params, {
      onSuccess: (result) => apply(result, label, snapshotOf),
      onError: (err) => setNote(err.message),
    });
  };

  const runComputer = (params: Record<string, unknown>, label: string) => {
    setNote(null);
    setOutput(null);
    setImages([]);
    setRows([]);
    computer.mutate(params, {
      onSuccess: (result) => apply(result, label),
      onError: (err) => setNote(err.message),
    });
  };

  const call = (method: string, args: unknown[], label = method) =>
    runBrowser(
      { action: 'call', chain: [{ method, args }] },
      label,
      method === 'ariaSnapshot' ? 'value' : undefined,
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-[hsl(var(--border))] p-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <h3 className="flex-1 text-[13px] font-semibold">Browser & desktop</h3>
          <Button
            size="sm"
            variant={mode === 'web' ? 'default' : 'outline'}
            aria-pressed={mode === 'web'}
            onClick={() => setMode('web')}
          >
            Web
          </Button>
          <Button
            size="sm"
            variant={mode === 'desktop' ? 'default' : 'outline'}
            aria-pressed={mode === 'desktop'}
            onClick={() => setMode('desktop')}
          >
            Desktop
          </Button>
        </div>

        {mode === 'web' ? (
          <>
            <div className="flex gap-1">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Browser URL"
                className="h-7 min-w-0 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-xs outline-none"
              />
              <Button
                size="sm"
                disabled={pending || url.trim() === ''}
                onClick={() => runBrowser({ action: 'open', url: url.trim(), timeout: 60 }, 'open')}
              >
                Open
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => call('url', [])}
              >
                URL
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => call('title', [])}
              >
                Title
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => call('ariaSnapshot', [], 'aria snapshot')}
              >
                Snapshot
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => call('screenshot', [], 'screenshot')}
              >
                <Camera className="size-3.5" />
                Screenshot
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => runBrowser({ action: 'close', all: true }, 'close all tabs')}
              >
                Close tabs
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              <input
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                placeholder="aria-ref=e2 or CSS selector"
                aria-label="Element selector"
                className="h-7 min-w-0 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-xs outline-none"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || selector.trim() === ''}
                onClick={() => call('click', [selector.trim()], 'click')}
              >
                <MousePointerClick className="size-3.5" />
                Click
              </Button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="text to type"
                aria-label="Text to type"
                className="h-7 min-w-0 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-xs outline-none"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || selector.trim() === '' || text === ''}
                onClick={() => call('type', [selector.trim(), text], 'type')}
              >
                Type
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => runComputer({ action: 'capabilities' }, 'capabilities')}
            >
              Capabilities
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runComputer(
                  { action: 'call', chain: [{ method: 'displays', args: [] }] },
                  'displays',
                )
              }
            >
              Displays
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runComputer(
                  { action: 'call', chain: [{ method: 'screenshot', args: [] }] },
                  'screenshot',
                )
              }
            >
              <Monitor className="size-3.5" />
              Screenshot
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                runComputer({ action: 'call', chain: [{ method: 'windows', args: [] }] }, 'windows')
              }
            >
              Windows
            </Button>
          </div>
        )}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Calls the session's own `{mode === 'web' ? 'browser' : 'computer'}` prelude. Requires{' '}
          <code className="font-mono">{mode === 'web' ? 'browser' : 'computer'}.enabled</code>.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pending && (
          <div className="flex items-center gap-2">
            <RefreshCw className="size-3.5 animate-spin" />
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Working…</span>
          </div>
        )}
        {!pending && images.length > 0 && (
          <div className="mb-2 flex flex-col gap-2">
            {images.map((src) => (
              <img
                key={src.slice(-24)}
                src={src}
                alt="capture from the session prelude"
                className="max-w-full rounded-md border border-[hsl(var(--border))]"
              />
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="mb-2 flex flex-col gap-0.5">
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Elements — click a row to click it
            </p>
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li key={row.ref}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => call('click', [`aria-ref=${row.ref}`], `click ${row.ref}`)}
                    className="flex w-full items-baseline gap-2 rounded px-2 py-0.5 text-left font-mono text-[11px] hover:bg-[hsl(var(--accent))]"
                  >
                    <span className="shrink-0 text-[hsl(var(--muted-foreground))]">{row.ref}</span>
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {note && <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">{note}</p>}
        {output && (
          <pre className="whitespace-pre-wrap break-words rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px] leading-relaxed">
            {output}
          </pre>
        )}
        {!output && !note && !pending && <Skeleton className="h-10 w-full" />}
      </div>
    </div>
  );
}
