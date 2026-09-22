import { Badge, Button, cn, ErrorState, Input, Skeleton } from '@grove/ui';
import { Braces, Crosshair, Info, ListTree, Server } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useLsp } from '../../lib/api-client/hooks';
import type { LspInput } from '../../lib/api-client/rest';

/**
 * Result row that opens in the editor when embedded (onOpen set) and renders
 * as static content otherwise — never a dead button.
 */
function OpenRow({
  onOpen,
  file,
  range,
  title,
  className,
  children,
}: {
  onOpen?: (path: string, range?: string) => void;
  file: string;
  range?: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const base = 'w-full rounded-md panel-plain px-2 py-1 text-left';
  if (!onOpen) {
    return (
      <div title={title} className={cn(base, className)}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(file, range)}
      title={title}
      className={cn(base, 'hover:bg-muted', className)}
    >
      {children}
    </button>
  );
}

interface LspPanelProps {
  sessionId: string;
  onOpen?: (path: string, range?: string) => void;
}

interface DiagView {
  file: string;
  line: number;
  column?: number;
  severity: string;
  message: string;
}

interface LocView {
  file: string;
  line: number;
  column?: number;
}

interface SymbolView {
  name: string;
  kind: string;
  line: number;
}

interface ServerView {
  name: string;
  status: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toDiagView(value: unknown): DiagView | null {
  if (!isRecord(value)) return null;
  const { file, line, message } = value;
  if (typeof file !== 'string' || typeof line !== 'number' || typeof message !== 'string') {
    return null;
  }
  const column = typeof value.column === 'number' ? value.column : undefined;
  const severity = typeof value.severity === 'string' ? value.severity : 'info';
  return { file, line, column, severity, message };
}

function toLocView(value: unknown): LocView | null {
  if (!isRecord(value)) return null;
  const { file, line } = value;
  if (typeof file !== 'string' || typeof line !== 'number') return null;
  const column = typeof value.column === 'number' ? value.column : undefined;
  return { file, line, column };
}

function toSymbolView(value: unknown): SymbolView | null {
  if (!isRecord(value)) return null;
  const { name, kind, line } = value;
  if (typeof name !== 'string' || typeof line !== 'number') return null;
  return { name, kind: typeof kind === 'string' && kind ? kind : 'symbol', line };
}

function toServerView(value: unknown): ServerView | null {
  if (!isRecord(value)) return null;
  const { name, status } = value;
  if (typeof name !== 'string' || typeof status !== 'string') return null;
  return { name, status };
}

function hoverText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    const direct = value.contents ?? value.value ?? value.text;
    if (typeof direct === 'string') return direct;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function severityVariant(severity: string): 'neutral' | 'secondary' | 'destructive' | 'outline' {
  const s = severity.toLowerCase();
  if (s.includes('error')) return 'destructive';
  if (s.includes('warn')) return 'secondary';
  if (s.includes('info') || s.includes('hint')) return 'outline';
  return 'outline';
}

function locLabel(loc: LocView): string {
  return loc.column === undefined
    ? `${loc.file}:${loc.line}`
    : `${loc.file}:${loc.line}:${loc.column}`;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <ErrorState message={message} onRetry={onRetry} />;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed.';
}

export function LspPanel({ sessionId, onOpen }: LspPanelProps) {
  const [diagFile, setDiagFile] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [navFile, setNavFile] = useState('');
  const [navLine, setNavLine] = useState('');
  const [navSymbol, setNavSymbol] = useState('');
  const [symFile, setSymFile] = useState('');
  const [symQuery, setSymQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const diagMut = useLsp(sessionId);
  const defMut = useLsp(sessionId);
  const hoverMut = useLsp(sessionId);
  const symMut = useLsp(sessionId);
  const statusMut = useLsp(sessionId);

  const parseTimeout = (): number | undefined => {
    const raw = timeoutMs.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 && n <= 600_000 ? n : undefined;
  };

  const handleDiagnostics = () => {
    setFormError(null);
    if (!diagFile.trim()) {
      setFormError('Enter a file path to fetch diagnostics.');
      return;
    }
    const input: LspInput = { action: 'diagnostics', file: diagFile.trim() };
    if (timeoutMs.trim()) {
      const timeout = parseTimeout();
      if (timeout === undefined) {
        setFormError('Timeout must be an integer from 1 to 600000 ms.');
        return;
      }
      input.timeoutMs = timeout;
    }
    diagMut.mutate(input);
  };

  const parseNavLine = (): number | null => {
    if (!navLine.trim()) return null;
    const n = Number(navLine.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  const handleDefinition = () => {
    setFormError(null);
    const line = parseNavLine();
    if (!navFile.trim() || line === null || !navSymbol.trim()) {
      setFormError('Definition needs a file, a line number (≥ 1), and a symbol.');
      return;
    }
    defMut.mutate({ action: 'definition', file: navFile.trim(), line, symbol: navSymbol.trim() });
  };

  const handleHover = () => {
    setFormError(null);
    const line = parseNavLine();
    if (!navFile.trim() || line === null || !navSymbol.trim()) {
      setFormError('Hover needs a file, a numeric line, and a symbol.');
      return;
    }
    hoverMut.mutate({ action: 'hover', file: navFile.trim(), line, symbol: navSymbol.trim() });
  };

  const handleSymbols = () => {
    setFormError(null);
    if (!symFile.trim()) {
      setFormError('Enter a file path to list symbols.');
      return;
    }
    const input: LspInput = { action: 'symbols', file: symFile.trim() };
    if (symQuery.trim()) input.query = symQuery.trim();
    symMut.mutate(input);
  };

  const diagnostics = toArray(diagMut.data)
    .map(toDiagView)
    .filter((d) => d !== null);
  const definitions = toArray(defMut.data)
    .map(toLocView)
    .filter((l) => l !== null);
  const symbols = toArray(symMut.data)
    .map(toSymbolView)
    .filter((s) => s !== null);
  const statusRecord = isRecord(statusMut.data) ? statusMut.data : null;
  const servers = statusRecord
    ? toArray(statusRecord.servers)
        .map(toServerView)
        .filter((s) => s !== null)
    : null;
  const statusOk = statusRecord && typeof statusRecord.ok === 'boolean' ? statusRecord.ok : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        <div className="flex flex-col gap-4">
          {formError && <p className="text-small text-destructive">{formError}</p>}

          <section aria-label="Diagnostics" className="rounded-md panel">
            <header className="flex items-center gap-2 hairline-b px-2 py-1.5 section-label">
              <Braces className="size-3.5" />
              Diagnostics
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={diagFile}
                  onChange={(e) => setDiagFile(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDiagnostics();
                  }}
                  placeholder="path/to/file.ts"
                  aria-label="Diagnostics file"
                  className="font-mono"
                />
                <Input
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(e.target.value)}
                  placeholder="timeout ms"
                  aria-label="Diagnostics timeout ms"
                  className="w-28"
                />
              </div>
              <Button onClick={handleDiagnostics} disabled={diagMut.isPending}>
                {diagMut.isPending ? 'Loading…' : 'Fetch diagnostics'}
              </Button>
              {diagMut.isPending && <Skeleton className="h-12 w-full" />}
              {diagMut.isError && (
                <ErrorBox message={errorMessage(diagMut.error)} onRetry={handleDiagnostics} />
              )}
              {diagMut.data !== undefined &&
                !diagMut.isPending &&
                !diagMut.isError &&
                (diagnostics.length === 0 ? (
                  <p className="p-2 text-center text-small text-muted-foreground">
                    No diagnostics reported for this file.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {diagnostics.map((d) => (
                      <li key={`${d.file}:${d.line}:${d.message}`}>
                        <OpenRow
                          onOpen={onOpen}
                          file={d.file}
                          range={`${d.line}`}
                          title={onOpen ? `Open ${locLabel(d)} in editor` : locLabel(d)}
                          className="flex flex-col gap-1 px-2 py-1.5"
                        >
                          <span className="flex items-center gap-2">
                            <Badge variant={severityVariant(d.severity)}>{d.severity}</Badge>
                            <span className="truncate font-mono text-small">{locLabel(d)}</span>
                          </span>
                          <span className="text-small">{d.message}</span>
                        </OpenRow>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </section>

          <section aria-label="Definition and hover" className="rounded-md panel">
            <header className="flex items-center gap-2 hairline-b px-2 py-1.5 section-label">
              <Crosshair className="size-3.5" />
              Definition & hover
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={navFile}
                  onChange={(e) => setNavFile(e.target.value)}
                  placeholder="path/to/file.ts"
                  aria-label="Lookup file"
                  className="font-mono"
                />
                <Input
                  value={navLine}
                  onChange={(e) => setNavLine(e.target.value)}
                  placeholder="line"
                  aria-label="Lookup line"
                  className="w-20"
                />
              </div>
              <Input
                value={navSymbol}
                onChange={(e) => setNavSymbol(e.target.value)}
                placeholder="symbol name"
                aria-label="Lookup symbol"
                className="font-mono"
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleDefinition} disabled={defMut.isPending}>
                  {defMut.isPending ? 'Looking up…' : 'Go to definition'}
                </Button>
                <Button variant="outline" onClick={handleHover} disabled={hoverMut.isPending}>
                  <Info className="size-3.5" />
                  {hoverMut.isPending ? 'Loading…' : 'Hover'}
                </Button>
              </div>
              {defMut.isError && (
                <ErrorBox message={errorMessage(defMut.error)} onRetry={handleDefinition} />
              )}
              {defMut.data !== undefined &&
                !defMut.isPending &&
                !defMut.isError &&
                (definitions.length === 0 ? (
                  <p className="text-small text-muted-foreground">No definition locations found.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {definitions.map((loc) => (
                      <li key={`${loc.file}:${loc.line}`}>
                        <OpenRow
                          onOpen={onOpen}
                          file={loc.file}
                          range={`${loc.line}`}
                          title={onOpen ? `Open ${locLabel(loc)} in editor` : locLabel(loc)}
                          className="truncate font-mono text-small"
                        >
                          {locLabel(loc)}
                        </OpenRow>
                      </li>
                    ))}
                  </ul>
                ))}
              {hoverMut.isPending && <Skeleton className="h-16 w-full" />}
              {hoverMut.isError && (
                <ErrorBox message={errorMessage(hoverMut.error)} onRetry={handleHover} />
              )}
              {hoverMut.data !== undefined && !hoverMut.isPending && !hoverMut.isError && (
                <pre className="max-h-48 overflow-y-auto scroll-area whitespace-pre-wrap rounded-md panel-plain bg-muted p-2 font-mono text-small">
                  {hoverText(hoverMut.data)}
                </pre>
              )}
            </div>
          </section>

          <section aria-label="Symbols" className="rounded-md panel">
            <header className="flex items-center gap-2 hairline-b px-2 py-1.5 section-label">
              <ListTree className="size-3.5" />
              Symbols
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={symFile}
                  onChange={(e) => setSymFile(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSymbols();
                  }}
                  placeholder="path/to/file.ts"
                  aria-label="Symbols file"
                  className="font-mono"
                />
                <Input
                  value={symQuery}
                  onChange={(e) => setSymQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSymbols();
                  }}
                  placeholder="filter (optional)"
                  aria-label="Symbol filter"
                />
              </div>
              <Button variant="outline" onClick={handleSymbols} disabled={symMut.isPending}>
                {symMut.isPending ? 'Loading…' : 'List symbols'}
              </Button>
              {symMut.isPending && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
              {symMut.isError && (
                <ErrorBox message={errorMessage(symMut.error)} onRetry={handleSymbols} />
              )}
              {symMut.data !== undefined &&
                !symMut.isPending &&
                !symMut.isError &&
                (symbols.length === 0 ? (
                  <p className="text-small text-muted-foreground">No symbols found.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {symbols.map((s) => (
                      <li key={`${s.name}:${s.line}`}>
                        <OpenRow
                          onOpen={onOpen}
                          file={symFile.trim()}
                          range={`${s.line}`}
                          title={onOpen ? `Open ${s.name}:${s.line} in editor` : s.name}
                          className="flex items-center gap-2 px-2 py-1"
                        >
                          <Badge variant="outline">{s.kind}</Badge>
                          <span className="min-w-0 flex-1 truncate font-mono text-small">
                            {s.name}
                          </span>
                          <span className="font-mono text-small text-muted-foreground">
                            :{s.line}
                          </span>
                        </OpenRow>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </section>

          <section aria-label="Language server status" className="rounded-md panel">
            <header className="flex items-center gap-2 hairline-b px-2 py-1.5 section-label">
              <Server className="size-3.5" />
              Server status
              {statusOk !== null && (
                <Badge variant={statusOk ? 'neutral' : 'destructive'}>
                  {statusOk ? 'ok' : 'degraded'}
                </Badge>
              )}
            </header>
            <div className="flex flex-col gap-2 p-2">
              <Button
                variant="outline"
                onClick={() => statusMut.mutate({ action: 'status' })}
                disabled={statusMut.isPending}
              >
                {statusMut.isPending ? 'Checking…' : 'Check status'}
              </Button>
              {statusMut.isPending && <Skeleton className="h-12 w-full" />}
              {statusMut.isError && (
                <ErrorBox
                  message={errorMessage(statusMut.error)}
                  onRetry={() => statusMut.mutate({ action: 'status' })}
                />
              )}
              {servers !== null &&
                !statusMut.isPending &&
                !statusMut.isError &&
                (servers.length === 0 ? (
                  <p className="text-small text-muted-foreground">No language servers reported.</p>
                ) : (
                  <table className="w-full text-small">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="px-2 py-1 font-strong">Server</th>
                        <th className="px-2 py-1 font-strong">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servers.map((srv, idx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: server rows carry no ids
                        <tr key={idx} className="hairline-t">
                          <td className="px-2 py-1 font-mono">{srv.name}</td>
                          <td className="px-2 py-1">
                            <Badge variant="outline">{srv.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
