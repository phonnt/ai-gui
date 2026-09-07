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
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { queryClient } from '../../app/query-client';
import { useSessionStore } from '../../app/store';
import { useAbort, useCreateSession, useMessages, usePrompt } from '../../lib/api-client/hooks';
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
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const createSession = useCreateSession();

  useEffect(() => {
    setActiveSessionId(sessionId || null);
  }, [sessionId, setActiveSessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [liveText, setLiveText] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const messagesQuery = useMessages(sessionId || undefined);
  const prompt = usePrompt(sessionId);
  const abort = useAbort(sessionId);

  const handleEvent = useCallback(
    (event: AgentEventDto) => {
      switch (event.kind) {
        case 'message-delta':
          setLiveText((t) => t + (event.text ?? ''));
          break;
        case 'tool-start':
          setActiveTool(event.toolName ?? 'tool');
          break;
        case 'tool-end':
          setActiveTool(null);
          break;
        case 'message-end':
        case 'agent-end':
          setLiveText('');
          setActiveTool(null);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
        case 'error':
          setAgentError(event.message ?? 'Agent error');
          setLiveText('');
          setActiveTool(null);
          break;
      }
    },
    [sessionId],
  );

  const streamStatus = useSessionEvents(sessionId || undefined, handleEvent);

  const messages: ChatMessage[] = useMemo(() => {
    return (messagesQuery.data?.pages ?? []).flatMap((page) => page.messages);
  }, [messagesQuery.data]);

  const streaming = liveText !== '' || activeTool !== null || prompt.isPending;

  const handleSend = (text: string) => {
    setAgentError(null);
    prompt.mutate(
      { text },
      { onError: (err) => setAgentError(err instanceof Error ? err.message : 'Send failed') },
    );
  };

  const handleOpenFile = (path: string, range?: string) => {
    setOpenFile({ path, range });
    setToolTab('editor');
  };

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <OpsBar sessionId={sessionId} />
        <header className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-3 py-2">
          <span className="truncate text-[13px] font-semibold">{sessionId}</span>
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
          {activeTool && <Badge variant="outline">running: {activeTool}</Badge>}
        </header>
        <nav
          aria-label="Session tools"
          className="flex items-center gap-1 overflow-x-auto border-b border-[hsl(var(--border))] px-2 py-1"
        >
          {TOOL_TABS.map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={toolTab === tab.id ? 'default' : 'ghost'}
              onClick={() => setToolTab(tab.id)}
              aria-pressed={toolTab === tab.id}
            >
              <tab.icon />
              {tab.label}
            </Button>
          ))}
        </nav>

        {messagesQuery.isPending && (
          <div className="flex flex-1 flex-col gap-2 p-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-12 w-2/3" />
          </div>
        )}

        {messagesQuery.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-[13px] text-[hsl(var(--destructive))]">Failed to load messages.</p>
            <Button size="sm" variant="outline" onClick={() => messagesQuery.refetch()}>
              Retry
            </Button>
          </div>
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
          <Transcript messages={messages} liveText={liveText} />
        )}

        {(agentError || prompt.isError) && (
          <p className="px-3 py-1 text-xs text-[hsl(var(--destructive))]">
            {agentError ?? 'Failed to send prompt.'}
          </p>
        )}

        <Composer
          streaming={streaming}
          sending={prompt.isPending}
          onSend={handleSend}
          onAbort={() => abort.mutate()}
        />
      </div>
      {toolTab !== 'chat' && (
        <section
          aria-label={`${toolTab} panel`}
          className="flex h-full w-[540px] min-h-0 shrink-0 flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--background))]"
        >
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
    </div>
  );
}
