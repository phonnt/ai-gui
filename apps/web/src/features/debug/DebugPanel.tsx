import type { DebugRequestDto } from '@ai-gui/protocol';
import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import {
  ArrowDown,
  ArrowUp,
  Bug,
  Pause,
  Play,
  Plus,
  Square,
  StepForward,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useDebug } from '../../lib/api-client/hooks';
import type { DebugAction } from '../../lib/api-client/rest';

interface DebugPanelProps {
  sessionId: string;
}

interface BpEntry {
  id: number;
  file?: string;
  line?: number;
  fn?: string;
}

interface ThreadView {
  id: number;
  name: string;
}

interface FrameView {
  id: number;
  name: string;
  file?: string;
  line?: number;
}

interface ScopeView {
  ref: number;
  name: string;
}

interface VarView {
  name: string;
  value: string;
}

interface DebugSessionView {
  id: string;
  state: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toThread(value: unknown): ThreadView | null {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  return { id, name };
}

function toFrame(value: unknown): FrameView | null {
  if (!isRecord(value)) return null;
  const { id, name } = value;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  const file = typeof value.file === 'string' ? value.file : undefined;
  const line = typeof value.line === 'number' ? value.line : undefined;
  return { id, name, file, line };
}

function toScope(value: unknown): ScopeView | null {
  if (!isRecord(value)) return null;
  const ref = value.ref ?? value.id;
  const { name } = value;
  if (typeof ref !== 'number' || typeof name !== 'string') return null;
  return { ref, name };
}

function toVar(value: unknown): VarView | null {
  if (!isRecord(value)) return null;
  const { name, value: val } = value;
  if (typeof name !== 'string') return null;
  return { name, value: typeof val === 'string' ? val : stringify(val) };
}

function toDebugSession(value: unknown): DebugSessionView | null {
  if (!isRecord(value)) return null;
  const { id, state } = value;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return { id: String(id), state: typeof state === 'string' ? state : 'unknown' };
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function DebugPanel({ sessionId }: DebugPanelProps) {
  const debugMut = useDebug(sessionId);
  const [busy, setBusy] = useState<DebugAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [program, setProgram] = useState('');
  const [argsText, setArgsText] = useState('');
  const [cwd, setCwd] = useState('');
  const [adapter, setAdapter] = useState('');
  const [pid, setPid] = useState('');
  const [port, setPort] = useState('');
  const [host, setHost] = useState('');
  const [bpFile, setBpFile] = useState('');
  const [bpLine, setBpLine] = useState('');
  const [bpFn, setBpFn] = useState('');
  const [bpCondition, setBpCondition] = useState('');
  const [breakpoints, setBreakpoints] = useState<BpEntry[]>([]);

  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [frames, setFrames] = useState<FrameView[]>([]);
  const [levels, setLevels] = useState('');
  const [frameId, setFrameId] = useState('');
  const [scopes, setScopes] = useState<ScopeView[]>([]);
  const [scopeRef, setScopeRef] = useState('');
  const [variables, setVariables] = useState<VarView[]>([]);

  const [evalExpr, setEvalExpr] = useState('');
  const [evalHistory, setEvalHistory] = useState<{ expr: string; result: string }[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DebugSessionView[]>([]);

  const run = async (
    action: DebugAction,
    params: Omit<DebugRequestDto, 'action'>,
    onOk?: (result: unknown) => void,
  ) => {
    setBusy(action);
    setError(null);
    try {
      const result = await debugMut.mutateAsync({ action, ...params });
      onOk?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed.`);
    } finally {
      setBusy(null);
    }
  };

  /** Protocol ints: line/pid/port/levels are positive, frame/ref nonnegative. */
  const parseIntParam = (raw: string, min: number, max?: number): number | null => {
    if (!raw.trim()) return null;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  };

  const parseLaunch = (): Omit<DebugRequestDto, 'action'> => {
    const args = argsText
      .split(/\s+/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const params: Omit<DebugRequestDto, 'action'> = { program: program.trim() };
    if (args.length > 0) params.args = args;
    if (cwd.trim()) params.cwd = cwd.trim();
    if (adapter.trim()) params.adapter = adapter.trim();
    return params;
  };

  const handleLaunch = () => {
    setNotice(null);
    if (!program.trim()) {
      setError('Enter a program path to launch.');
      return;
    }
    void run('launch', parseLaunch(), (result) => {
      const id =
        isRecord(result) && typeof result.session === 'string' ? result.session : stringify(result);
      setNotice(`Launched debug session ${id}.`);
      void refreshSessions();
    });
  };

  const handleAttach = () => {
    setNotice(null);
    const params: Omit<DebugRequestDto, 'action'> = {};
    if (pid.trim()) {
      const pidNum = parseIntParam(pid, 1);
      if (pidNum === null) {
        setError('PID must be a positive integer.');
        return;
      }
      params.pid = pidNum;
    }
    if (port.trim()) {
      const portNum = parseIntParam(port, 1, 65_535);
      if (portNum === null) {
        setError('Port must be an integer from 1 to 65535.');
        return;
      }
      params.port = portNum;
    }
    if (params.pid === undefined && params.port === undefined) {
      setError('Attach needs a PID or a port.');
      return;
    }
    if (host.trim()) params.host = host.trim();
    if (adapter.trim()) params.adapter = adapter.trim();
    if (cwd.trim()) params.cwd = cwd.trim();
    void run('attach', params, (result) => {
      const id =
        isRecord(result) && typeof result.session === 'string' ? result.session : stringify(result);
      setNotice(`Attached debug session ${id}.`);
      void refreshSessions();
    });
  };

  const handleAddBreakpoint = () => {
    const params: Omit<DebugRequestDto, 'action'> = {};
    if (bpFile.trim()) params.file = bpFile.trim();
    if (bpLine.trim()) {
      const lineNum = parseIntParam(bpLine, 1);
      if (lineNum === null) {
        setError('Breakpoint line must be a positive integer.');
        return;
      }
      params.line = lineNum;
    }
    if (bpFn.trim()) params.fn = bpFn.trim();
    if (bpCondition.trim()) params.condition = bpCondition.trim();
    if (params.file === undefined && params.fn === undefined) {
      setError('A breakpoint needs a file or a function name.');
      return;
    }
    const file = params.file;
    const line = params.line;
    const fn = params.fn;
    void run('breakpoint', params, (result) => {
      if (!isRecord(result) || typeof result.id !== 'number') {
        setError('Server returned an unexpected breakpoint shape.');
        return;
      }
      const id = result.id;
      setBreakpoints((prev) => [...prev, { id, file, line, fn }]);
      setNotice(`Breakpoint ${id} added.`);
    });
  };

  const handleRemoveBreakpoint = (id: number) => {
    void run('unbreak', { id }, () => {
      setBreakpoints((prev) => prev.filter((b) => b.id !== id));
      setNotice(`Breakpoint ${id} removed.`);
    });
  };

  const refreshThreads = () => {
    void run('threads', {}, (result) => {
      setThreads(
        toArray(result)
          .map(toThread)
          .filter((t) => t !== null),
      );
    });
  };

  const refreshStack = () => {
    const params: Omit<DebugRequestDto, 'action'> = {};
    if (levels.trim()) {
      const n = parseIntParam(levels, 1);
      if (n === null) {
        setError('Levels must be a positive integer.');
        return;
      }
      params.levels = n;
    }
    void run('stack', params, (result) => {
      setFrames(
        toArray(result)
          .map(toFrame)
          .filter((f) => f !== null),
      );
    });
  };

  const refreshScopes = () => {
    const params: Omit<DebugRequestDto, 'action'> = {};
    if (frameId.trim()) {
      const n = parseIntParam(frameId, 0);
      if (n === null) {
        setError('Frame id must be a nonnegative integer.');
        return;
      }
      params.frameId = n;
    }
    void run('scopes', params, (result) => {
      setScopes(
        toArray(result)
          .map(toScope)
          .filter((s) => s !== null),
      );
    });
  };

  const refreshVariables = () => {
    const n = parseIntParam(scopeRef, 0);
    if (n === null) {
      setError('Pick a scope (numeric ref) to load variables.');
      return;
    }
    void run('variables', { ref: n }, (result) => {
      setVariables(
        toArray(result)
          .map(toVar)
          .filter((v) => v !== null),
      );
    });
  };

  const handleEvaluate = () => {
    if (!evalExpr.trim()) {
      setError('Enter an expression to evaluate.');
      return;
    }
    const params: Omit<DebugRequestDto, 'action'> = { expression: evalExpr.trim() };
    if (frameId.trim()) {
      const n = parseIntParam(frameId, 0);
      if (n === null) {
        setError('Frame id must be a nonnegative integer.');
        return;
      }
      params.frameId = n;
    }
    const expr = evalExpr.trim();
    void run('evaluate', params, (result) => {
      const text =
        isRecord(result) && result.result !== undefined
          ? stringify(result.result)
          : stringify(result);
      setEvalHistory((prev) => [...prev, { expr, result: text }]);
      setEvalExpr('');
    });
  };

  const refreshOutput = () => {
    void run('output', {}, (result) => {
      const text =
        isRecord(result) && typeof result.text === 'string' ? result.text : stringify(result);
      setOutput(text);
    });
  };

  const refreshSessions = () => {
    void run('sessions', {}, (result) => {
      setSessions(
        toArray(result)
          .map(toDebugSession)
          .filter((s) => s !== null),
      );
    });
  };

  const stepDisabled = busy !== null;
  const stepLabel = (action: DebugAction, idle: string) => (busy === action ? '…' : idle);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex items-center gap-1 border-b border-[hsl(var(--border))] px-2 py-1.5"
        role="toolbar"
        aria-label="Debug stepping"
      >
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('continue', {})}
          disabled={stepDisabled}
          title="Continue"
        >
          <Play className="size-3.5" />
          {stepLabel('continue', 'Continue')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('step', { kind: 'over' })}
          disabled={stepDisabled}
          title="Step over"
        >
          <StepForward className="size-3.5" />
          {stepLabel('step', 'Over')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('step', { kind: 'in' })}
          disabled={stepDisabled}
          title="Step in"
        >
          <ArrowDown className="size-3.5" />
          In
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('step', { kind: 'out' })}
          disabled={stepDisabled}
          title="Step out"
        >
          <ArrowUp className="size-3.5" />
          Out
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('pause', {})}
          disabled={stepDisabled}
          title="Pause"
        >
          <Pause className="size-3.5" />
          {stepLabel('pause', 'Pause')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void run('terminate', {})}
          disabled={stepDisabled}
          title="Terminate session"
        >
          <Square className="size-3.5" />
          {stepLabel('terminate', 'Stop')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-4">
          {busy && <p className="text-xs text-[hsl(var(--muted-foreground))]">Running {busy}…</p>}
          {notice && <p className="text-xs text-[hsl(var(--muted-foreground))]">{notice}</p>}
          {error && <p className="text-xs text-[hsl(var(--destructive))]">{error}</p>}

          <section
            aria-label="Launch or attach"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <Bug className="size-3.5" />
              Launch / attach
            </header>
            <div className="flex flex-col gap-2 p-2">
              <Input
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                placeholder="program path (e.g. ./bin/app)"
                aria-label="Program"
                className="font-mono"
              />
              <div className="flex gap-2">
                <Input
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="args (space separated)"
                  aria-label="Program args"
                  className="font-mono"
                />
                <Input
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="cwd"
                  aria-label="Working directory"
                  className="font-mono"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  value={adapter}
                  onChange={(e) => setAdapter(e.target.value)}
                  placeholder="adapter (optional)"
                  aria-label="Debug adapter"
                />
                <Button size="sm" onClick={handleLaunch} disabled={busy !== null}>
                  {busy === 'launch' ? 'Launching…' : 'Launch'}
                </Button>
              </div>
              <div className="flex gap-2 border-t border-[hsl(var(--border))] pt-2">
                <Input
                  value={pid}
                  onChange={(e) => setPid(e.target.value)}
                  placeholder="pid"
                  aria-label="Attach PID"
                  className="font-mono"
                />
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="port"
                  aria-label="Attach port"
                  className="font-mono"
                />
                <Input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="host"
                  aria-label="Attach host"
                />
                <Button size="sm" variant="outline" onClick={handleAttach} disabled={busy !== null}>
                  {busy === 'attach' ? 'Attaching…' : 'Attach'}
                </Button>
              </div>
            </div>
          </section>

          <section
            aria-label="Breakpoints"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <Plus className="size-3.5" />
              Breakpoints ({breakpoints.length})
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={bpFile}
                  onChange={(e) => setBpFile(e.target.value)}
                  placeholder="source file"
                  aria-label="Breakpoint file"
                  className="font-mono"
                />
                <Input
                  value={bpLine}
                  onChange={(e) => setBpLine(e.target.value)}
                  placeholder="line"
                  aria-label="Breakpoint line"
                  className="w-20 font-mono"
                />
              </div>
              <div className="flex gap-2">
                <Input
                  value={bpFn}
                  onChange={(e) => setBpFn(e.target.value)}
                  placeholder="function (optional)"
                  aria-label="Breakpoint function"
                  className="font-mono"
                />
                <Input
                  value={bpCondition}
                  onChange={(e) => setBpCondition(e.target.value)}
                  placeholder="condition (optional)"
                  aria-label="Breakpoint condition"
                  className="font-mono"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddBreakpoint}
                disabled={busy !== null}
              >
                {busy === 'breakpoint' ? 'Adding…' : 'Add breakpoint'}
              </Button>
              {breakpoints.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">No breakpoints yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {breakpoints.map((bp) => (
                    <li
                      key={bp.id}
                      className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1"
                    >
                      <Badge variant="outline">{bp.id}</Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {[
                          bp.file,
                          bp.line !== undefined ? `:${bp.line}` : '',
                          bp.fn ? ` ${bp.fn}` : '',
                        ].join('')}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveBreakpoint(bp.id)}
                        disabled={busy !== null}
                        aria-label={`Remove breakpoint ${bp.id}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section
            aria-label="Threads and stack"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Threads & stack
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshThreads}
                  disabled={busy !== null}
                >
                  {busy === 'threads' ? 'Loading…' : 'Refresh threads'}
                </Button>
                <Input
                  value={levels}
                  onChange={(e) => setLevels(e.target.value)}
                  placeholder="levels (optional)"
                  aria-label="Stack levels"
                  className="w-32 font-mono"
                />
                <Button size="sm" variant="outline" onClick={refreshStack} disabled={busy !== null}>
                  {busy === 'stack' ? 'Loading…' : 'Refresh stack'}
                </Button>
              </div>
              {busy === 'threads' || busy === 'stack' ? <Skeleton className="h-12 w-full" /> : null}
              {threads.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {threads.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs"
                    >
                      <Badge variant="secondary">{t.id}</Badge>
                      <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {frames.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {frames.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setFrameId(String(f.id));
                          setScopeRef('');
                          setVariables([]);
                        }}
                        title={f.file ? `${f.file}:${f.line ?? ''}` : f.name}
                        className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-left text-xs hover:bg-[hsl(var(--muted))]"
                      >
                        <Badge variant={String(f.id) === frameId ? 'default' : 'outline'}>
                          {f.id}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                        {f.file && (
                          <span className="truncate font-mono text-[hsl(var(--muted-foreground))]">
                            {f.file}
                            {f.line !== undefined ? `:${f.line}` : ''}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {threads.length === 0 && frames.length === 0 && busy === null && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  No threads or frames loaded — refresh on demand.
                </p>
              )}
            </div>
          </section>

          <section
            aria-label="Scopes and variables"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Scopes & variables
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={frameId}
                  onChange={(e) => setFrameId(e.target.value)}
                  placeholder="frame id (optional)"
                  aria-label="Scope frame id"
                  className="font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshScopes}
                  disabled={busy !== null}
                >
                  {busy === 'scopes' ? 'Loading…' : 'Load scopes'}
                </Button>
              </div>
              {scopes.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {scopes.map((s) => (
                    <li key={s.ref}>
                      <button
                        type="button"
                        onClick={() => {
                          setScopeRef(String(s.ref));
                          setVariables([]);
                        }}
                        className="flex w-full items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-left text-xs hover:bg-[hsl(var(--muted))]"
                      >
                        <Badge variant={String(s.ref) === scopeRef ? 'default' : 'outline'}>
                          {s.ref}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  value={scopeRef}
                  onChange={(e) => setScopeRef(e.target.value)}
                  placeholder="scope ref"
                  aria-label="Variable scope ref"
                  className="font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={refreshVariables}
                  disabled={busy !== null}
                >
                  {busy === 'variables' ? 'Loading…' : 'Load variables'}
                </Button>
              </div>
              {busy === 'scopes' || busy === 'variables' ? (
                <Skeleton className="h-12 w-full" />
              ) : null}
              {variables.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {variables.map((v) => (
                    <li
                      key={v.name}
                      className="flex items-baseline gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs"
                    >
                      <span className="font-mono font-semibold">{v.name}</span>
                      <span className="min-w-0 flex-1 break-all font-mono text-[hsl(var(--muted-foreground))]">
                        {v.value}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section
            aria-label="Evaluate"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              <Play className="size-3.5" />
              Evaluate
            </header>
            <div className="flex flex-col gap-2 p-2">
              <div className="flex gap-2">
                <Input
                  value={evalExpr}
                  onChange={(e) => setEvalExpr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEvaluate();
                  }}
                  placeholder="expression"
                  aria-label="Expression to evaluate"
                  className="font-mono"
                />
                <Button size="sm" onClick={handleEvaluate} disabled={busy !== null}>
                  {busy === 'evaluate' ? 'Running…' : 'Run'}
                </Button>
              </div>
              {evalHistory.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">No evaluations yet.</p>
              ) : (
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {evalHistory.map((h) => (
                    <li
                      key={h.expr}
                      className="rounded-md border border-[hsl(var(--border))] px-2 py-1"
                    >
                      <p className="truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">
                        {h.expr}
                      </p>
                      <p className="break-all font-mono text-xs">{h.result}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section
            aria-label="Debug output"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Output
            </header>
            <div className="flex flex-col gap-2 p-2">
              <Button size="sm" variant="outline" onClick={refreshOutput} disabled={busy !== null}>
                {busy === 'output' ? 'Loading…' : 'Refresh output'}
              </Button>
              {busy === 'output' && <Skeleton className="h-16 w-full" />}
              {output !== null && busy !== 'output' && (
                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-2 font-mono text-xs">
                  {output || '(no output)'}
                </pre>
              )}
            </div>
          </section>

          <section
            aria-label="Debug sessions"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
          >
            <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Sessions ({sessions.length})
            </header>
            <div className="flex flex-col gap-2 p-2">
              <Button
                size="sm"
                variant="outline"
                onClick={refreshSessions}
                disabled={busy !== null}
              >
                {busy === 'sessions' ? 'Loading…' : 'Refresh sessions'}
              </Button>
              {sessions.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  No debug sessions reported.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs"
                    >
                      <Badge variant="outline">{s.id}</Badge>
                      <span className="min-w-0 flex-1 truncate">{s.state}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
