import type { Dispatch, SetStateAction } from 'react';
import type {
  useClearSession,
  useCompactSession,
  useForkSession,
  useFreshSession,
  useRetryTurn,
} from '../../lib/api-client/hooks';
import type { PaletteCommand } from '../palette/CommandPalette';

/** Session actions for the command palette, with the hook's mutations injected. */
export interface SessionActionDeps {
  clearOp: ReturnType<typeof useClearSession>;
  compactOp: ReturnType<typeof useCompactSession>;
  freshOp: ReturnType<typeof useFreshSession>;
  forkOp: ReturnType<typeof useForkSession>;
  retryOp: ReturnType<typeof useRetryTurn>;
  setAgentError: Dispatch<SetStateAction<string | null>>;
  setGoalOpen: Dispatch<SetStateAction<boolean>>;
  setModesOpen: Dispatch<SetStateAction<boolean>>;
  setTreeOpen: Dispatch<SetStateAction<boolean>>;
  /** Newest user message, or null when the transcript has none yet. */
  lastUserMessageId: string | null;
  /** Branch from that message, keeping the old path as a branch. */
  onRewind: (entryId: string) => void;
  navigate: (to: string) => void;
}

export function buildSessionActions(deps: SessionActionDeps): PaletteCommand[] {
  const {
    clearOp,
    compactOp,
    freshOp,
    forkOp,
    retryOp,
    setAgentError,
    setGoalOpen,
    setModesOpen,
    setTreeOpen,
    lastUserMessageId: lastUserMessage,
    onRewind,
    navigate,
  } = deps;
  return [
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
      id: 'session-rewind',
      label: 'Rewind (branch from here)',
      hint: 'slash /rewind',
      run: () => {
        if (lastUserMessage) onRewind(lastUserMessage);
      },
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
}
