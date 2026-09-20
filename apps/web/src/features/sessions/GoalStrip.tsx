import { Button, Input } from '@grove/ui';

/** 90 → 1m30s, 45 → 45s; empty when the goal has not run yet. */
function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '';
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  return `${minutes}m${String(whole % 60).padStart(2, '0')}s`;
}

import { Crosshair, X } from 'lucide-react';
import { useState } from 'react';
import { useGoal, useGoalAction } from '../../lib/api-client/hooks';

interface GoalStripProps {
  sessionId: string;
  /** Setter row visible (Goal button or `/goal show`). Status row shows whenever a goal exists. */
  open: boolean;
  onClose: () => void;
  /** Fired after a set succeeds so the objective runs as a prompt, TUI-style. */
  onGoalSet?: (objective: string) => void;
}

/**
 * Inline goal mode strip living in the session column, TUI-style: status is
 * always visible while a goal exists, the setter expands in place. The
 * runtime is SDK-only, so the goal query always loads.
 */
export function GoalStrip({ sessionId, open, onClose, onGoalSet }: GoalStripProps) {
  const goalQuery = useGoal(sessionId);
  const action = useGoalAction(sessionId);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetEdit, setBudgetEdit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const state = goalQuery.data ?? null;
  const goal = state?.goal ?? null;
  if (!goal && !open) return null;

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  const run = (input: Parameters<typeof action.mutate>[0], onSuccess?: () => void) => {
    setError(null);
    action.mutate(input, {
      onError: (err) => fail(err, 'Goal action failed'),
      ...(onSuccess ? { onSuccess } : {}),
    });
  };

  const parseBudget = (): number | undefined => {
    const trimmed = budget.trim().toLowerCase();
    if (!trimmed || trimmed === 'off') return undefined;
    const n = Number(trimmed.replace(/k$/, '000'));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const handleSet = () => {
    const text = objective.trim();
    if (!text) {
      setError('Usage: describe the objective, e.g. /goal set Refactor auth');
      return;
    }
    const tokenBudget = parseBudget();
    if (budget.trim() && tokenBudget === undefined && budget.trim().toLowerCase() !== 'off') {
      setError('Budget must be a positive token count or off.');
      return;
    }
    setObjective('');
    const input = {
      action: 'set' as const,
      objective: text,
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    };
    run(input, () => {
      onClose();
      onGoalSet?.(text);
    });
  };
  const applyBudget = () => {
    const trimmed = budgetEdit.trim().toLowerCase();
    const off = trimmed === 'off';
    const n = Number(trimmed.replace(/k$/, '000'));
    if (!off && (!Number.isInteger(n) || n <= 0)) {
      setError('Budget must be a positive token count or off.');
      return;
    }
    run({ action: 'budget', tokenBudget: off ? null : n }, () => setBudgetEdit(''));
  };

  const usedK = goal ? goal.tokensUsed / 1000 : 0;
  const elapsed = formatElapsed(goal?.timeUsedSeconds ?? 0);
  const budgetK = goal?.tokenBudget !== undefined ? goal.tokenBudget / 1000 : null;
  const progress = goal?.tokenBudget
    ? Math.min(100, (goal.tokensUsed / goal.tokenBudget) * 100)
    : 0;
  const overBudget = goal?.status === 'budget-limited';

  return (
    <section
      aria-label="Goal mode"
      className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5"
    >
      {goal && (
        <div className="flex min-w-0 items-center gap-2">
          <Crosshair className="size-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{goal.objective}</span>
          <span className="shrink-0 font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {goal.status}
            {budgetK !== null
              ? ` · ${usedK.toFixed(1)}k / ${budgetK.toFixed(1)}k tokens`
              : ` · ${usedK.toFixed(1)}k tokens`}
            {elapsed ? ` · ${elapsed}` : ''}
          </span>
          <Button
            size="sm"
            variant="ghost"
            title="Adjust the token budget (keeps usage)"
            aria-label="Adjust goal budget"
            disabled={action.isPending}
            onClick={() => setBudgetEdit((v) => (v === '' ? ' ' : ''))}
          >
            Budget
          </Button>
          {goal.status === 'active' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run({ action: 'pause' })}
              disabled={action.isPending}
              aria-label="Pause goal"
            >
              Pause
            </Button>
          ) : goal.status === 'paused' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run({ action: 'resume' })}
              disabled={action.isPending}
              aria-label="Resume goal"
            >
              Resume
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run({ action: 'drop' })}
            disabled={action.isPending}
            aria-label="Drop goal"
          >
            Drop
          </Button>
        </div>
      )}
      {goal && budgetK !== null && (
        <div
          role="progressbar"
          aria-label="Token budget usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="mt-1 h-1 overflow-hidden rounded-full bg-[hsl(var(--muted))]"
        >
          <div
            className={`h-full rounded-full ${overBudget ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary))]'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {!goal && (
        <p className="flex min-w-0 items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Crosshair className="size-3.5 shrink-0" />
          No goal set for this session.
        </p>
      )}
      {goal && budgetEdit !== '' && (
        <div className="mt-1.5 flex items-center gap-1">
          <Input
            value={budgetEdit.trim()}
            onChange={(e) => setBudgetEdit(e.target.value)}
            placeholder="New budget (tokens or off)"
            aria-label="Adjust goal budget"
            className="h-7 w-48 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyBudget();
            }}
          />
          <Button size="sm" onClick={applyBudget} disabled={action.isPending}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBudgetEdit('')}>
            Cancel
          </Button>
        </div>
      )}
      {open && (
        <div className="mt-1.5 flex gap-1">
          <Input
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={
              goal
                ? 'New objective (replaces current goal)'
                : 'Objective, e.g. Refactor auth to OAuth2'
            }
            aria-label="Goal objective"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSet();
            }}
          />
          <Input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Budget"
            aria-label="Token budget (number or off)"
            className="h-7 w-24 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSet();
            }}
          />
          <Button size="sm" onClick={handleSet} disabled={action.isPending}>
            Set
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close goal setter">
            <X className="size-3.5" />
          </Button>
        </div>
      )}
      {(error || action.isError) && (
        <p className="pt-1 text-xs text-[hsl(var(--destructive))]">
          {error ?? 'Goal action failed.'}
        </p>
      )}
    </section>
  );
}
