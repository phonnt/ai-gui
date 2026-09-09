import type { ChatMessage } from '@ai-gui/core';
import type { AgentEventDto } from '@ai-gui/protocol';
import { Badge, Button, Skeleton } from '@ai-gui/ui';
import {
  Bot,
  Boxes,
  Braces,
  Brain,
  Briefcase,
  Bug,
  Files,
  GitBranch,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  NotebookPen,
  Package,
  Palette,
  PencilLine,
  PlugZap,
  Settings,
  SquareTerminal,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { queryClient } from '../../app/query-client';
import { useSessionStore } from '../../app/store';
import {
  useAbort,
  useBranchSession,
  useClearSession,
  useCommands,
  useCreateSession,
  useForkSession,
  useFreshSession,
  useMessages,
  usePrompt,
  useRenameSession,
  useSessions,
} from '../../lib/api-client/hooks';
import { useSessionEvents } from '../../lib/api-client/stream';
import { ArtifactBrowser } from '../artifacts/ArtifactBrowser';
import { ExplorerPane } from '../explorer/ExplorerPane';
import { HubPanel } from '../hub/HubPanel';
import { JobsPanel } from '../hub/JobsPanel';
import { KnowledgePane } from '../knowledge/KnowledgePane';
import { LspPanel } from '../lsp/LspPanel';
import { McpPane } from '../mcp/McpPane';
import { CommandPalette } from '../palette/CommandPalette';
import { ProvidersPane } from '../providers/ProvidersPane';
import { OpsBar } from '../sessions/OpsBar';
import { SettingsPane } from '../settings/SettingsPane';
import { ThemePicker } from '../settings/ThemePicker';
import { TodoPanel } from '../todos/TodoPanel';
import { TreePanel } from '../tree/TreePanel';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import type { TurnTool } from './TurnTools';

// Heavy panes (xterm, CodeMirror, debug views) split into lazy chunks so the
// initial bundle stays lean; each suspends behind a skeleton while loading.
const DebugPanel = lazy(() =>
  import('../debug/DebugPanel').then((m) => ({ default: m.DebugPanel })),
);
const EditorPane = lazy(() =>
  import('../editor/EditorPane').then((m) => ({ default: m.EditorPane })),
);
const NotebookPane = lazy(() =>
  import('../notebook/NotebookPane').then((m) => ({ default: m.NotebookPane })),
);
const TerminalPane = lazy(() =>
  import('../terminal/TerminalPane').then((m) => ({ default: m.TerminalPane })),
);

type ToolTab =
  | 'chat'
  | 'explorer'
  | 'editor'
  | 'terminal'
  | 'notebook'
  | 'todos'
  | 'artifacts'
  | 'lsp'
  | 'debug'
  | 'hub'
  | 'jobs'
  | 'settings'
  | 'themes'
  | 'providers'
  | 'mcp'
  | 'knowledge';

const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Files }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'editor', label: 'Editor', icon: PencilLine },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { id: 'notebook', label: 'Notebook', icon: NotebookPen },
  { id: 'todos', label: 'Todos', icon: ListTodo },
  { id: 'artifacts', label: 'Artifacts', icon: Package },
  { id: 'lsp', label: 'LSP', icon: Braces },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'hub', label: 'Hub', icon: Bot },
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'providers', label: 'Providers', icon: Boxes },
  { id: 'mcp', label: 'MCP', icon: PlugZap },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
];
export function ChatPage() {
  const { id } = useParams();
  const sessionId = id ?? '';
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const [treeOpen, setTreeOpen] = useState(false);
  const [toolTab, setToolTab] = useState<ToolTab>('chat');
  const [openFile, setOpenFile] = useState<{ path: string; range?: string }>({ path: '' });
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem('ai-gui-panel-w'));
    return Number.isFinite(saved) && saved >= 320 && saved <= 900 ? saved : 540;
  });
  const [panelDragging, setPanelDragging] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const createSession = useCreateSession();
  const sessionsQuery = useSessions();
  const sessionCwd = sessionsQuery.data?.find((s) => s.id === sessionId)?.cwd;
  const commandsQuery = useCommands(sessionCwd);
  const clearOp = useClearSession(sessionId);
  const freshOp = useFreshSession(sessionId);
  const forkOp = useForkSession(sessionId);
  const branchOp = useBranchSession(sessionId);
  const renameOp = useRenameSession(sessionId);

  useEffect(() => {
    setActiveSessionId(sessionId || null);
  }, [sessionId, setActiveSessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        const target = e.target as HTMLElement | null;
        const editing =
          target instanceof HTMLElement &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable);
        setPaletteOpen(false);
        if (!editing) setToolTab('chat');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [liveText, setLiveText] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [turnTools, setTurnTools] = useState<TurnTool[]>([]);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const messagesQuery = useMessages(sessionId || undefined);
  const prompt = usePrompt(sessionId);
  const abort = useAbort(sessionId);

  const handleEvent = useCallback(
    (event: AgentEventDto) => {
      switch (event.kind) {
        case 'message-delta':
          // Empty leading boundary frames (e.g. an early message-end with no
          // text) must not clear `waiting` — otherwise the thinking phase
          // after them renders nothing until the turn completes.
          if (event.text) {
            setLiveText((t) => t + (event.text ?? ''));
            setWaiting(false);
          }
          break;
        case 'tool-start':
          setActiveTool(event.toolName ?? 'tool');
          setTurnTools((prev) => [...prev, { name: event.toolName ?? 'tool' }]);
          setWaiting(false);
          break;
        case 'tool-end':
          setActiveTool(null);
          setTurnTools((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i]?.result === undefined) {
                next[i] = { name: next[i]?.name ?? 'tool', result: event.text ?? '' };
                break;
              }
            }
            return next;
          });
          break;
        case 'message-end':
          // A message boundary is not turn end (agent-end is): resume the
          // thinking state until the next delta/tool or the terminal event.
          setLiveText('');
          setWaiting(true);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
        case 'agent-end':
          setLiveText('');
          setActiveTool(null);
          setTurnTools([]);
          setTurnStartedAt(null);
          setWaiting(false);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
        case 'error':
          setAgentError(event.message ?? 'Agent error');
          setLiveText('');
          setActiveTool(null);
          setTurnTools([]);
          setTurnStartedAt(null);
          setWaiting(false);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
      }
    },
    [sessionId],
  );

  const streamStatus = useSessionEvents(sessionId || undefined, handleEvent);

  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const [waiting, setWaiting] = useState(false);
  const messages: ChatMessage[] = useMemo(() => {
    const server = (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages);
    return optimistic.length > 0 ? [...server, ...optimistic] : server;
  }, [messagesQuery.data, optimistic]);

  // Drop optimistic bubbles once the server transcript confirms them (or
  // they age out) so a completed turn never flickers out before refetch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-way sync from server data
  useEffect(() => {
    if (optimistic.length === 0) return;
    const server = (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages);
    if (server.length === 0) return;
    const texts = new Set(server.filter((m) => m.role === 'user').map((m) => m.text));
    const cutoff = Date.now() - 120_000;
    const kept = optimistic.filter(
      (o) => !texts.has(o.text) && new Date(o.createdAt).getTime() > cutoff,
    );
    if (kept.length !== optimistic.length) setOptimistic(kept);
  }, [messagesQuery.data]);

  const streaming = liveText !== '' || activeTool !== null || prompt.isPending;

  /**
   * Local slash dispatch (mirrors TUI names). Returns true when the command
   * was consumed here; false falls through to the normal prompt path so the
   * agent (or RPC built-in dispatch) handles it as text.
   */
  const handleSlash = (text: string): boolean => {
    const match = /^\/([a-z0-9:_-]+)(?:\s+(.*))?$/i.exec(text.trim());
    if (!match) return false;
    const name = (match[1] ?? '').toLowerCase();
    const args = (match[2] ?? '').trim();
    const fail = (message: string) => {
      setAgentError(message);
    };
    switch (name) {
      case 'clear':
        clearOp.mutate(undefined, { onError: (e) => fail(e.message) });
        return true;
      case 'fresh':
        freshOp.mutate(undefined, { onError: (e) => fail(e.message) });
        return true;
      case 'fork':
        forkOp.mutate(undefined, {
          onSuccess: (session) => {
            setActiveSessionId(session.id);
            navigate(`/s/${session.id}`);
          },
          onError: (e) => fail(e.message),
        });
        return true;
      case 'branch':
        branchOp.mutate(args || undefined, {
          onSuccess: (session) => {
            setActiveSessionId(session.id);
            navigate(`/s/${session.id}`);
          },
          onError: (e) => fail(e.message),
        });
        return true;
      case 'rename':
        if (!args) {
          fail('Usage: /rename <title>');
          return true;
        }
        renameOp.mutate(args, { onError: (e) => fail(e.message) });
        return true;
      case 'tree':
        setTreeOpen(true);
        return true;
      case 'todo':
      case 'todos':
        setToolTab('todos');
        return true;
      case 'new':
        createSession.mutate(
          {},
          {
            onSuccess: (session) => {
              setActiveSessionId(session.id);
              navigate(`/s/${session.id}`);
            },
            onError: (e) => fail(e.message),
          },
        );
        return true;
      default:
        return false;
    }
  };
  const handleSend = (text: string) => {
    setAgentError(null);
    if (text.startsWith('/') && handleSlash(text)) return;
    setOptimistic((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      },
    ]);
    setWaiting(true);
    setTurnTools([]);
    setTurnStartedAt(Date.now());
    prompt.mutate(
      { text },
      {
        onError: (err) => {
          setOptimistic([]);
          setWaiting(false);
          const raw = err instanceof Error ? err.message : 'Send failed';
          setAgentError(
            /session not found/i.test(raw)
              ? 'Session no longer exists — pick another session from the sidebar.'
              : raw,
          );
        },
      },
    );
  };
  const pendingPrompt = useSessionStore((s) => s.pendingPrompt);
  const setPendingPrompt = useSessionStore((s) => s.setPendingPrompt);
  const consumedRef = useRef(false);

  // Prompt typed on the landing page: send once when the new session opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot consume on mount
  useEffect(() => {
    if (pendingPrompt && !consumedRef.current) {
      consumedRef.current = true;
      const text = pendingPrompt;
      setPendingPrompt(null);
      handleSend(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenFile = (path: string, range?: string) => {
    setOpenFile({ path, range });
    setToolTab('editor');
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 gap-2">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <OpsBar
          sessionId={sessionId}
          meta={
            <>
              <span
                className="max-w-32 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
                title={sessionId}
              >
                {sessionId.slice(0, 8)}
              </span>
              {sessionCwd && (
                <span
                  className="max-w-64 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
                  title={`Workspace: ${sessionCwd}`}
                >
                  {sessionCwd}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTreeOpen((v) => !v)}
                aria-label="Toggle tree panel"
              >
                <GitBranch />
                Tree
              </Button>
              {streamStatus !== 'open' && streamStatus !== 'idle' && (
                <Badge variant="secondary">
                  {streamStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
                </Badge>
              )}
            </>
          }
        />

        {messagesQuery.isPending && (
          <div className="flex flex-1 flex-col gap-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        )}

        {messagesQuery.isError && messages.length === 0 && !liveText && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            {/session not found/i.test(
              messagesQuery.error instanceof Error ? messagesQuery.error.message : '',
            ) ? (
              <>
                <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                  This session no longer exists (deleted or never saved).
                </p>
                <Button size="sm" variant="outline" onClick={() => navigate('/')}>
                  Back to sessions
                </Button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-[hsl(var(--destructive))]">
                  Failed to load messages.
                </p>
                <Button size="sm" variant="outline" onClick={() => messagesQuery.refetch()}>
                  Retry
                </Button>
              </>
            )}
          </div>
        )}
        {messagesQuery.isError && messages.length > 0 && (
          <p className="px-3 py-1 text-xs text-[hsl(var(--muted-foreground))]">
            Reconnecting transcript…
          </p>
        )}

        {messagesQuery.data && messages.length === 0 && !liveText && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <MessageSquarePlus className="size-6 text-[hsl(var(--muted-foreground))]" />
            <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
              No messages yet — send the first prompt below.
            </p>
          </div>
        )}

        {(messages.length > 0 || liveText) && (
          <Transcript
            messages={messages}
            liveText={liveText}
            waiting={waiting && !liveText}
            turnTools={turnTools}
            turnStartedAt={turnStartedAt}
          />
        )}

        {(agentError || prompt.isError) && (
          <p className="px-3 py-1 text-xs text-[hsl(var(--destructive))]">
            {agentError ?? 'Failed to send prompt.'}
          </p>
        )}

        <Composer
          sessionId={sessionId}
          streaming={streaming || waiting}
          sending={prompt.isPending}
          commands={commandsQuery.data ?? []}
          onSend={handleSend}
          onAbort={() => abort.mutate()}
          onManageProviders={() => setToolTab('providers')}
        />
      </div>
      {toolTab !== 'chat' && (
        <section
          ref={panelRef}
          aria-label={`${toolTab} panel`}
          style={{ width: panelWidth }}
          className="relative flex h-full min-h-0 shrink-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
        >
          {/* biome-ignore lint/a11y/useSemanticElements: hr is void and collapses under preflight height:0; this separator needs size + keyboard */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={Math.round(panelWidth)}
            aria-valuemin={320}
            aria-valuemax={900}
            tabIndex={0}
            onDoubleClick={() => {
              setPanelWidth(540);
              window.localStorage.setItem('ai-gui-panel-w', '540');
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const delta = e.key === 'ArrowLeft' ? 20 : -20;
              setPanelWidth((w) => {
                const next = Math.min(900, Math.max(320, w + delta));
                window.localStorage.setItem('ai-gui-panel-w', String(next));
                return next;
              });
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const el = panelRef.current;
              if (!el) return;
              setPanelDragging(true);
              const edge = el.getBoundingClientRect().right;
              const move = (ev: PointerEvent) => {
                const next = Math.min(900, Math.max(320, edge - ev.clientX));
                setPanelWidth(next);
              };
              const up = (ev: PointerEvent) => {
                const next = Math.min(900, Math.max(320, edge - ev.clientX));
                window.localStorage.setItem('ai-gui-panel-w', String(Math.round(next)));
                setPanelDragging(false);
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
              };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }}
            className="absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none focus-visible:outline-none [&:hover>span]:bg-[hsl(var(--primary))] [&:focus-visible>span]:bg-[hsl(var(--primary))]"
          >
            <span
              aria-hidden="true"
              className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 ${panelDragging ? 'bg-[hsl(var(--primary))]' : ''}`}
            />
          </div>
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {TOOL_TABS.find((t) => t.id === toolTab)?.label ?? toolTab}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setToolTab('chat')}
              aria-label="Close panel"
              title="Close panel (Esc)"
            >
              <X />
            </Button>
          </div>
          {toolTab === 'explorer' && <ExplorerPane sessionId={sessionId} onOpen={handleOpenFile} />}
          {toolTab === 'editor' && (
            <Suspense fallback={<Skeleton className="m-3 h-24" />}>
              <EditorPane
                sessionId={sessionId}
                path={openFile.path}
                range={openFile.range}
                onPathChange={(path, range) => setOpenFile({ path, range })}
              />
            </Suspense>
          )}
          {toolTab === 'terminal' && (
            <Suspense fallback={<Skeleton className="m-3 h-24" />}>
              <TerminalPane sessionId={sessionId} />
            </Suspense>
          )}
          {toolTab === 'notebook' && (
            <Suspense fallback={<Skeleton className="m-3 h-24" />}>
              <NotebookPane sessionId={sessionId} />
            </Suspense>
          )}
          {toolTab === 'todos' && <TodoPanel sessionId={sessionId} />}
          {toolTab === 'artifacts' && <ArtifactBrowser sessionId={sessionId} />}
          {toolTab === 'lsp' && <LspPanel sessionId={sessionId} onOpen={handleOpenFile} />}
          {toolTab === 'debug' && (
            <Suspense fallback={<Skeleton className="m-3 h-24" />}>
              <DebugPanel sessionId={sessionId} />
            </Suspense>
          )}
          {toolTab === 'hub' && <HubPanel sessionId={sessionId} />}
          {toolTab === 'jobs' && <JobsPanel />}
          {toolTab === 'settings' && <SettingsPane />}
          {toolTab === 'themes' && <ThemePicker />}
          {toolTab === 'providers' && <ProvidersPane />}
          {toolTab === 'mcp' && <McpPane />}
          {toolTab === 'knowledge' && <KnowledgePane />}
        </section>
      )}
      {treeOpen && <TreePanel sessionId={sessionId} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onTab={(tab) => {
          if ((TOOL_TABS as { id: string }[]).some((t) => t.id === tab)) {
            setToolTab(tab as ToolTab);
          }
        }}
        onHome={() => navigate('/')}
        onNewSession={() => {
          createSession.mutate(
            {},
            {
              onSuccess: (session) => navigate(`/s/${session.id}`),
            },
          );
        }}
      />
      <nav
        aria-label="Session tools"
        className="flex h-full w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2"
      >
        {TOOL_TABS.filter((tab) => tab.id !== 'chat').map((tab) => (
          <Button
            key={tab.id}
            size="sm"
            variant={toolTab === tab.id ? 'default' : 'ghost'}
            onClick={() => setToolTab((t) => (t === tab.id ? 'chat' : tab.id))}
            aria-pressed={toolTab === tab.id}
            aria-label={tab.label}
            title={`${tab.label} (toggle)`}
            className="shrink-0 px-2"
          >
            <tab.icon />
          </Button>
        ))}
      </nav>
    </div>
  );
}
