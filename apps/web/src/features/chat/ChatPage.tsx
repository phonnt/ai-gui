import type { ChatMessage } from '@ai-gui/core';
import type { AgentEventDto, PlanProposalDto, PromptImage } from '@ai-gui/protocol';
import { Badge, Button, loadSashWidth, ResizeSash, Skeleton } from '@ai-gui/ui';
import {
  AtSign,
  Bot,
  Boxes,
  Braces,
  Brain,
  Briefcase,
  Bug,
  Crosshair,
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
  RotateCcw,
  Settings,
  SlidersHorizontal,
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
  useCompactSession,
  useCreateSession,
  useDecideApproval,
  useDecidePlan,
  useForkSession,
  useFreshSession,
  useGoal,
  useGoalAction,
  useMessages,
  useModes,
  useMoveSession,
  usePrompt,
  useRenameSession,
  useRetryTurn,
  useSessions,
  useSetMode,
  useSetSessionThinking,
} from '../../lib/api-client/hooks';
import { type StreamStatus, useSessionEvents } from '../../lib/api-client/stream';
import { ArtifactBrowser } from '../artifacts/ArtifactBrowser';
import { ExplorerPane } from '../explorer/ExplorerPane';
import { AgentKnobsPane } from '../hub/AgentKnobsPane';
import { HubPanel } from '../hub/HubPanel';
import { JobsPanel } from '../hub/JobsPanel';
import { KnowledgePane } from '../knowledge/KnowledgePane';
import { LspPanel } from '../lsp/LspPanel';
import { McpPane } from '../mcp/McpPane';
import { ModelRolesPane } from '../model/ModelRolesPane';
import { CommandPalette, type PaletteCommand } from '../palette/CommandPalette';
import { ProvidersPane } from '../providers/ProvidersPane';
import { GoalStrip } from '../sessions/GoalStrip';
import { ModesPanel, modesActive } from '../sessions/ModesPanel';
import { OpsBar } from '../sessions/OpsBar';
import { SettingsPane } from '../settings/SettingsPane';
import { ThemePicker } from '../settings/ThemePicker';
import { TodoPanel } from '../todos/TodoPanel';
import { TreePanel } from '../tree/TreePanel';
import { Composer } from './Composer';
import { SessionFooter } from './SessionFooter';
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
  | 'roles'
  | 'agents'
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
  { id: 'roles', label: 'Roles', icon: AtSign },
  { id: 'agents', label: 'Agent knobs', icon: Bot },
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
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    loadSashWidth('ai-gui-panel-w', 540, 320, 900),
  );
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const createSession = useCreateSession();
  const sessionsQuery = useSessions();
  const sessionCwd = sessionsQuery.data?.find((s) => s.id === sessionId)?.cwd;
  const commandsQuery = useCommands(sessionCwd);
  const clearOp = useClearSession(sessionId);
  const freshOp = useFreshSession(sessionId);
  const compactOp = useCompactSession(sessionId);
  const retryOp = useRetryTurn(sessionId);
  const forkOp = useForkSession(sessionId);
  const branchOp = useBranchSession(sessionId);
  const moveOp = useMoveSession(sessionId);
  const [goalOpen, setGoalOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ id: string; prompt: string } | null>(null);
  const [planProposal, setPlanProposal] = useState<PlanProposalDto | null>(null);
  const renameOp = useRenameSession(sessionId);
  const goalQuery = useGoal(sessionId || undefined);
  const goalOp = useGoalAction(sessionId);
  const modesQuery = useModes(sessionId || undefined);
  const modeOp = useSetMode(sessionId);
  const thinkingOp = useSetSessionThinking(sessionId);
  const [modesOpen, setModesOpen] = useState(false);

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
  const [liveThinking, setLiveThinking] = useState('');
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [turnTools, setTurnTools] = useState<TurnTool[]>([]);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

  const messagesQuery = useMessages(sessionId || undefined);
  const prompt = usePrompt(sessionId);
  const abort = useAbort(sessionId);
  const approvalOp = useDecideApproval(sessionId);
  const planOp = useDecidePlan(sessionId);

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
        case 'thinking-delta':
          // Reasoning streams on its own channel: it never joins answer text.
          if (event.text) {
            setLiveThinking((t) => t + (event.text ?? ''));
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
          setLiveThinking('');
          setWaiting(true);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
        case 'agent-end':
          setLiveText('');
          setLiveThinking('');
          setActiveTool(null);
          setTurnTools([]);
          setTurnStartedAt(null);
          setWaiting(false);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          void queryClient.invalidateQueries({ queryKey: ['goal', sessionId] });
          void queryClient.invalidateQueries({ queryKey: ['modes', sessionId] });
          break;
        case 'goal':
          // OMP pushes goal state on every mutation/accounting flush, so
          // budget-limited and paused-on-interrupt land without a refetch.
          if (event.goal) {
            queryClient.setQueryData(['goal', sessionId], event.goal);
          }
          break;
        case 'error':
          setAgentError(event.message ?? 'Agent error');
          setLiveText('');
          setLiveThinking('');
          setActiveTool(null);
          setTurnTools([]);
          setTurnStartedAt(null);
          setWaiting(false);
          void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
          break;
        case 'plan-proposal':
          if (event.plan) setPlanProposal(event.plan);
          break;
        case 'approval-request':
          if (event.approvalId) {
            setApproval({
              id: event.approvalId,
              prompt: event.prompt ?? 'Tool call needs approval',
            });
          }
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
  // Event handlers read the live flag without re-subscribing the socket.
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  const decide = (approved: boolean) => {
    if (!approval) return;
    const id = approval.id;
    setApproval(null);
    approvalOp.mutate({ approvalId: id, approved }, { onError: (e) => setAgentError(e.message) });
  };
  const prevStreamRef = useRef<StreamStatus>('idle');
  // Reconnecting mid-turn drops live deltas: resync the transcript the moment
  // the socket is back while output is still expected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: edge-trigger on status flip
  useEffect(() => {
    const prev = prevStreamRef.current;
    prevStreamRef.current = streamStatus;
    if (prev !== 'open' && streamStatus === 'open' && (waiting || streaming)) {
      void queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
    }
  }, [streamStatus]);

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
      case 'compact':
        compactOp.mutate(args || undefined, { onError: (e) => fail(e.message) });
        return true;
      case 'queue':
        if (!args) {
          fail('Usage: /queue <text> (delivered after the current turn)');
          return true;
        }
        sendPrompt(args, 'followUp');
        return true;
      case 'retry':
        retryOp.mutate(undefined, {
          onSuccess: (data) => {
            if (!data.retried) fail('Nothing to retry.');
          },
          onError: (e) => fail(e.message),
        });
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
          onSuccess: (data) => {
            setActiveSessionId(data.session.id);
            if (data.draft) setComposerDraft(data.draft);
            navigate(`/s/${data.session.id}`);
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
      case 'move':
        if (!args) {
          fail('Usage: /move <directory>');
          return true;
        }
        moveOp.mutate(args, { onError: (e) => fail(e.message) });
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
      case 'goal': {
        const [sub, ...rest] = args.split(/\s+/).filter(Boolean);
        const restText = rest.join(' ');
        const op = (sub ?? 'show').toLowerCase();
        if (op === 'show' || op === '') {
          setGoalOpen(true);
          return true;
        }
        if (op === 'set') {
          if (!restText) {
            fail('Usage: /goal set <objective>');
            return true;
          }
          goalOp.mutate(
            { action: 'set', objective: restText },
            {
              onError: (e) => fail(e.message),
              // Steered into the running turn server-side; only start a new
              // turn when idle, mirroring the TUI streaming branch.
              onSuccess: () => {
                if (!streaming && !waiting) sendPrompt(restText);
              },
            },
          );
          return true;
        }
        if (op === 'pause' || op === 'resume' || op === 'drop') {
          goalOp.mutate({ action: op }, { onError: (e) => fail(e.message) });
          return true;
        }
        if (op === 'budget') {
          const n = Number(restText.replace(/k$/, '000'));
          const goal = goalQuery.data?.goal;
          if (!goal) {
            fail('No goal set; use /goal set <objective> first.');
            return true;
          }
          if (goal.status === 'complete') {
            fail('Goal is already complete.');
            return true;
          }
          const off = restText.toLowerCase() === 'off';
          if (!off && (!Number.isInteger(n) || n <= 0)) {
            fail('Usage: /goal budget <tokens|off>');
            return true;
          }
          goalOp.mutate(
            { action: 'budget', tokenBudget: off ? null : n },
            { onError: (e) => fail(e.message) },
          );
          return true;
        }
        fail('Usage: /goal [set <objective>|show|pause|resume|drop|budget <tokens|off>]');
        return true;
      }
      case 'plan':
      case 'vibe':
      case 'advisor':
      case 'fast': {
        // Reached only for these four literals, so the cast is sound.
        const mode = name as 'plan' | 'vibe' | 'advisor' | 'fast';
        const current = modesQuery.data?.[mode] ?? false;
        const want =
          args.toLowerCase() === 'on' ? true : args.toLowerCase() === 'off' ? false : !current;
        modeOp.mutate({ mode, enabled: want }, { onError: (e) => fail(e.message) });
        return true;
      }
      case 'thinking': {
        // Current level stays visible in the composer ModelPicker; slash sets it.
        const level = args.toLowerCase();
        if (!['off', 'low', 'medium', 'high', 'max'].includes(level)) {
          fail('Usage: /thinking [off|low|medium|high|max]');
          return true;
        }
        thinkingOp.mutate(level, { onError: (e) => fail(e.message) });
        return true;
      }
      default:
        return false;
    }
  };
  // Direct prompt send without slash dispatch (goal objectives are literal
  // text even when they start with `/` — mirrors TUI local submission).
  const sendPrompt = (text: string, behavior?: 'steer' | 'followUp', images?: PromptImage[]) => {
    setAgentError(null);
    // Mid-turn steers join the running turn: no optimistic row reset, so the
    // live tool list and elapsed clock of that turn survive (TUI behaviour).
    const joinsLiveTurn = streamingRef.current && behavior === 'steer';
    if (!joinsLiveTurn) {
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
    }
    prompt.mutate(
      { text, ...(behavior ? { behavior } : {}), ...(images ? { images } : {}) },
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
  const handleSend = (text: string, behavior?: 'steer' | 'followUp', images?: PromptImage[]) => {
    // TUI shorthands: `-> text` / `=> text` queue as a follow-up.
    const shorthand = /^(?:->|=>)\s*([\s\S]+)$/.exec(text);
    if (shorthand?.[1]) {
      sendPrompt(shorthand[1], 'followUp', images);
      return;
    }
    if (text.startsWith('/') && handleSlash(text)) return;
    sendPrompt(text, behavior, images);
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

  // Session ops surfaced in the palette (TUI slash parity for the common set).
  const paletteSessionActions: PaletteCommand[] = [
    {
      id: 'session-clear',
      label: 'Clear context',
      hint: 'slash /clear',
      run: () => clearOp.mutate(undefined, { onError: (e) => setAgentError(e.message) }),
    },
    {
      id: 'session-compact',
      label: 'Compact history',
      hint: 'slash /compact',
      run: () => compactOp.mutate(undefined, { onError: (e) => setAgentError(e.message) }),
    },
    {
      id: 'session-retry',
      label: 'Retry last turn',
      hint: 'slash /retry',
      run: () =>
        retryOp.mutate(undefined, {
          onSuccess: (data) => {
            if (!data.retried) setAgentError('Nothing to retry.');
          },
          onError: (e) => setAgentError(e.message),
        }),
    },
    {
      id: 'session-fresh',
      label: 'Fresh stream',
      hint: 'slash /fresh',
      run: () => freshOp.mutate(undefined, { onError: (e) => setAgentError(e.message) }),
    },
    {
      id: 'session-fork',
      label: 'Fork session',
      hint: 'slash /fork',
      run: () =>
        forkOp.mutate(undefined, {
          onSuccess: (session) => navigate(`/s/${session.id}`),
          onError: (e) => setAgentError(e.message),
        }),
    },
    {
      id: 'session-tree',
      label: 'Toggle tree panel',
      hint: 'slash /tree',
      run: () => setTreeOpen((v) => !v),
    },
    {
      id: 'session-goal',
      label: 'Goal setter',
      hint: 'slash /goal',
      run: () => setGoalOpen((v) => !v),
    },
    {
      id: 'session-modes',
      label: 'Agent modes',
      hint: 'plan/vibe/advisor/fast',
      run: () => setModesOpen(true),
    },
  ];

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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setGoalOpen((v) => !v)}
                aria-label="Goal mode"
                title={
                  goalQuery.data?.goal ? `Goal: ${goalQuery.data.goal.objective}` : 'Goal mode'
                }
              >
                <Crosshair />
                Goal
                {goalQuery.data?.goal && goalQuery.data.enabled && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-[hsl(var(--diff-add))]"
                  />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setModesOpen(true)}
                aria-label="Agent modes"
                title="Plan, vibe, advisor, fast, queue modes"
              >
                <SlidersHorizontal />
                Modes
                {modesActive(modesQuery.data) && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-[hsl(var(--diff-add))]"
                  />
                )}
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

        {(messages.length > 0 || liveText || liveThinking) && (
          <Transcript
            messages={messages}
            liveText={liveText}
            liveThinking={liveThinking}
            waiting={waiting && !liveText}
            turnTools={turnTools}
            turnStartedAt={turnStartedAt}
          />
        )}

        {(agentError || prompt.isError) && (
          <div className="flex items-center gap-2 px-3 py-1">
            <p className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--destructive))]">
              {agentError ?? 'Failed to send prompt.'}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                retryOp.mutate(undefined, {
                  onSuccess: (data) => {
                    if (!data.retried) setAgentError('Nothing to retry.');
                    else setAgentError(null);
                  },
                  onError: (e) => setAgentError(e.message),
                })
              }
              disabled={retryOp.isPending}
              title="Re-run the last failed turn"
            >
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        )}

        {planProposal && (
          <div
            role="alertdialog"
            aria-label="Plan review"
            className="mx-3 mb-1 rounded-md border border-[hsl(var(--primary))] bg-[hsl(var(--card))] p-2"
          >
            <p className="mb-1 text-xs font-medium text-[hsl(var(--primary))]">
              Plan ready for review: {planProposal.title}
            </p>
            <p className="mb-2 break-all font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
              {planProposal.planFilePath}
              {planProposal.planExists ? '' : ' (no file written)'}
            </p>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                onClick={() =>
                  planOp.mutate('execute', {
                    onSuccess: () => setPlanProposal(null),
                    onError: (e) => setAgentError(e.message),
                  })
                }
                disabled={planOp.isPending}
              >
                Approve and execute
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  planOp.mutate('keep', {
                    onSuccess: () => setPlanProposal(null),
                    onError: (e) => setAgentError(e.message),
                  })
                }
                disabled={planOp.isPending}
              >
                Approve and keep
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlanProposal(null)}>
                Refine (stay in plan mode)
              </Button>
            </div>
          </div>
        )}

        {approval && (
          <div
            role="alertdialog"
            aria-label="Tool approval"
            className="mx-3 mb-1 rounded-md border border-[hsl(var(--amber))] bg-[hsl(var(--card))] p-2"
          >
            <p className="mb-1 text-xs font-medium text-[hsl(var(--amber))]">
              Tool approval needed
            </p>
            <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[hsl(var(--foreground))]">
              {approval.prompt}
            </pre>
            <div className="flex gap-1">
              <Button size="sm" onClick={() => decide(true)} disabled={approvalOp.isPending}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide(false)}
                disabled={approvalOp.isPending}
              >
                Deny
              </Button>
            </div>
          </div>
        )}

        <GoalStrip
          sessionId={sessionId}
          open={goalOpen}
          onClose={() => setGoalOpen(false)}
          onGoalSet={(text) => {
            if (!streaming && !waiting) sendPrompt(text);
          }}
        />
        <Composer
          sessionId={sessionId}
          streaming={streaming || waiting}
          sending={prompt.isPending}
          commands={commandsQuery.data ?? []}
          onSend={handleSend}
          onAbort={() => abort.mutate()}
          onManageProviders={() => setToolTab('providers')}
          draft={composerDraft}
          onDraftConsumed={() => setComposerDraft(null)}
        />
        <SessionFooter sessionId={sessionId} />
      </div>
      {toolTab !== 'chat' && (
        <section
          aria-label={`${toolTab} panel`}
          style={{ width: panelWidth }}
          className="relative flex h-full min-h-0 shrink-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
        >
          <ResizeSash
            label="Resize panel"
            direction="left"
            value={panelWidth}
            min={320}
            max={900}
            defaultValue={540}
            storageKey="ai-gui-panel-w"
            onChange={setPanelWidth}
            className="absolute inset-y-0 -left-[9px] z-10 w-2"
          />
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
          {toolTab === 'roles' && <ModelRolesPane />}
          {toolTab === 'agents' && <AgentKnobsPane />}
          {toolTab === 'mcp' && <McpPane />}
          {toolTab === 'knowledge' && <KnowledgePane sessionId={sessionId} />}
        </section>
      )}
      {treeOpen && (
        <TreePanel
          sessionId={sessionId}
          onBranched={(id, draft) => {
            setActiveSessionId(id);
            if (draft) setComposerDraft(draft);
            navigate(`/s/${id}`);
          }}
        />
      )}
      <ModesPanel sessionId={sessionId} open={modesOpen} onClose={() => setModesOpen(false)} />
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
        sessionActions={paletteSessionActions}
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
