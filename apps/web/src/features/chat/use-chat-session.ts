import type { ChatMessage } from '@grove/core';
import type { AgentEventDto, PlanProposalDto, PromptImage } from '@grove/protocol';
import { loadSashWidth } from '@grove/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  useEphemeralAsk,
  useForkSession,
  useFreshSession,
  useGoal,
  useGoalAction,
  useGuidedGoal,
  useMessages,
  useModes,
  useMoveSession,
  useMoveToWorktree,
  usePlanDraft,
  usePrompt,
  useRenameSession,
  useRetryTurn,
  useSessions,
  useSetMode,
  useSetSessionThinking,
  useStartLoop,
  useStopLoop,
  useSwitchModel,
} from '../../lib/api-client/hooks';
import { type StreamStatus, useSessionEvents } from '../../lib/api-client/stream';
import { buildSessionActions } from './chat-commands';
import type { TurnTool } from './TurnTools';
import type { ToolTab } from './tool-tabs';
import { lastUserMessageId } from './turns';

/**
 * Everything the chat page needs to run a session turn: transcript state, live
 * stream state, composer plumbing, session ops and the command list. The JSX
 * consumes the returned object; nothing else should read these values.
 */
export function useChatSession(sessionId: string) {
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const [treeOpen, setTreeOpen] = useState(false);
  const [toolTab, setToolTab] = useState<ToolTab>('chat');
  const [openFile, setOpenFile] = useState<{ path: string; range?: string }>({ path: '' });
  const [panelWidth, setPanelWidth] = useState<number>(() =>
    loadSashWidth('grove-panel-w', 540, 320, 900),
  );
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const createSession = useCreateSession();
  const sessionsQuery = useSessions();
  const activeSession = sessionsQuery.data?.find((s) => s.id === sessionId);
  const sessionCwd = activeSession?.cwd;
  // The id alone is unfriendly; prefer the generated title, keep the id visible for `/resume`.
  const sessionTitle = activeSession?.title?.trim() || sessionId.slice(0, 8);
  const commandsQuery = useCommands(sessionCwd);
  const clearOp = useClearSession(sessionId);
  const freshOp = useFreshSession(sessionId);
  const compactOp = useCompactSession(sessionId);
  const retryOp = useRetryTurn(sessionId);
  const forkOp = useForkSession(sessionId);
  const branchOp = useBranchSession(sessionId);
  /** Branch at a transcript entry: new session, its text as the draft. */
  const branchFromMessage = (entryId: string) => {
    setAgentError(null);
    branchOp.mutate(entryId, {
      onSuccess: (data) => {
        setActiveSessionId(data.session.id);
        if (data.draft) setComposerDraft(data.draft);
        navigate(`/s/${data.session.id}`);
      },
      onError: (e) => setAgentError(e.message),
    });
  };
  const moveOp = useMoveSession(sessionId);
  const [goalOpen, setGoalOpen] = useState(false);
  const [composerDraft, setComposerDraft] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ id: string; prompt: string } | null>(null);
  const [planProposal, setPlanProposal] = useState<PlanProposalDto | null>(null);
  // `/btw`: side answer shown beside the transcript, never persisted.
  const [btw, setBtw] = useState<{ question: string; reply: string } | null>(null);
  // `/plan-review`: re-open the current draft without an agent proposal.
  const [planReview, setPlanReview] = useState<PlanProposalDto | null>(null);
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
  const planModeOn = modesQuery.data?.plan === true;
  const planDraftQuery = usePlanDraft(
    sessionId,
    (planReview !== null || planProposal !== null) && Boolean(sessionId),
  );
  const guidedGoalOp = useGuidedGoal(sessionId);
  const btwOp = useEphemeralAsk(sessionId);
  const worktreeOp = useMoveToWorktree(sessionId);
  const switchModelOp = useSwitchModel(sessionId);
  const openImport = useSessionStore((s) => s.openImport);
  const startLoopOp = useStartLoop(sessionId);
  const stopLoopOp = useStopLoop(sessionId);

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
          void queryClient.invalidateQueries({ queryKey: ['loop', sessionId] });
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
      case 'resume': {
        const arg = args.trim();
        if (arg === '@claude' || arg === '@codex') {
          // The TUI opens a picker for foreign sources; the dialog is the
          // picker here, and importing stays explicit.
          openImport(arg === '@claude' ? 'claude' : 'codex');
          return true;
        }
        if (arg === '') {
          fail('Usage: /resume <session id|@claude|@codex>');
          return true;
        }
        const target = (sessionsQuery.data ?? []).find(
          (session) =>
            session.id.startsWith(arg) || session.title.toLowerCase().includes(arg.toLowerCase()),
        );
        if (!target) {
          fail(`Session "${arg}" not found.`);
          return true;
        }
        setActiveSessionId(target.id);
        navigate(`/s/${target.id}`);
        return true;
      }
      case 'switch':
      case 'model': {
        const selector = args.trim();
        if (!selector) {
          fail('Usage: /switch <model|provider/id|@role>[:level]');
          return true;
        }
        switchModelOp.mutate(selector, {
          onSuccess: () => setAgentError(null),
          onError: (e: Error) => fail(e.message),
        });
        return true;
      }
      case 'wt':
      case 'worktree': {
        worktreeOp.mutate(args.trim() || undefined, {
          onSuccess: (result) => {
            setAgentError(null);
            void queryClient.invalidateQueries({ queryKey: ['session', sessionId, 'workspace'] });
            void queryClient.invalidateQueries({ queryKey: ['sessions'] });
            setBtw({
              question: 'worktree',
              reply: `Session moved to ${result.path} (branch ${result.branch}).`,
            });
          },
          onError: (e: Error) => fail(`Worktree failed: ${e.message}`),
        });
        return true;
      }
      case 'btw': {
        const question = args.trim();
        if (!question) {
          fail('Usage: /btw <question>');
          return true;
        }
        btwOp.mutate(question, {
          onSuccess: (data) => setBtw({ question, reply: data.reply }),
          onError: (e) => fail(e.message),
        });
        return true;
      }
      case 'guided-goal': {
        guidedGoalOp.mutate(args.trim() || undefined, { onError: (e) => fail(e.message) });
        return true;
      }
      case 'plan-review': {
        if (!planModeOn) {
          fail('Plan review needs plan mode; use /plan first.');
          return true;
        }
        void planDraftQuery.refetch().then((result) => {
          const draft = result.data;
          if (!draft?.planFilePath) {
            fail('No plan drafted yet — ask for a plan first.');
            return;
          }
          setPlanReview({
            title: draft.title,
            planFilePath: draft.planFilePath,
            planExists: draft.exists,
          });
        });
        return true;
      }
      case 'loop': {
        // TUI `/loop [count|duration] [prompt]`: re-submit the prompt after
        // every yield; bare `/loop` uses the last prompt or turns it off.
        const trimmed = args.trim();
        if (trimmed === '' || trimmed === 'off') {
          if (trimmed === 'off') {
            stopLoopOp.mutate(undefined, { onError: (e) => fail(e.message) });
            return true;
          }
          fail('Usage: /loop [count|duration] <prompt>');
          return true;
        }
        const limitMatch = /^([+-]?\d[^\s]*)(?:\s+([\s\S]*))?$/.exec(trimmed);
        const looksLikeLimit = limitMatch !== null && /^\d/.test(limitMatch[1] ?? '');
        const limit = looksLikeLimit ? limitMatch?.[1] : undefined;
        const prompt = (looksLikeLimit ? (limitMatch?.[2] ?? '') : trimmed).trim();
        if (!prompt) {
          fail('Usage: /loop [count|duration] <prompt>');
          return true;
        }
        startLoopOp.mutate(
          { prompt, ...(limit !== undefined ? { limit } : {}) },
          { onError: (e) => fail(e.message) },
        );
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

  const paletteSessionActions = buildSessionActions({
    clearOp,
    compactOp,
    freshOp,
    forkOp,
    retryOp,
    setAgentError,
    setGoalOpen,
    setModesOpen,
    setTreeOpen,
    lastUserMessageId: lastUserMessageId(messages),
    onRewind: branchFromMessage,
    navigate,
  });

  return {
    abort,
    agentError,
    approval,
    approvalOp,
    branchFromMessage,
    btw,
    btwOp,
    commandsQuery,
    composerDraft,
    createSession,
    decide,
    goalOpen,
    goalQuery,
    handleOpenFile,
    handleSend,
    liveText,
    liveThinking,
    messages,
    messagesQuery,
    modesOpen,
    modesQuery,
    navigate,
    openFile,
    paletteOpen,
    paletteSessionActions,
    panelWidth,
    planDraftQuery,
    planOp,
    planProposal,
    planReview,
    prompt,
    retryOp,
    sendPrompt,
    sessionCwd,
    sessionTitle,
    setActiveSessionId,
    setAgentError,
    setBtw,
    setComposerDraft,
    setGoalOpen,
    setModesOpen,
    setPaletteOpen,
    setPanelWidth,
    setPlanProposal,
    setPlanReview,
    setToolTab,
    setTreeOpen,
    streamStatus,
    streaming,
    toolTab,
    treeOpen,
    turnStartedAt,
    turnTools,
    waiting,
  };
}
