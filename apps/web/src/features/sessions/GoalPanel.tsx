import { Button, Input } from '@ai-gui/ui';
import { Crosshair } from 'lucide-react';
import { useState } from 'react';
import { useGoal, useGoalAction } from '../../lib/api-client/hooks';
import { useServerHealth } from './useServerHealth';

interface GoalPanelProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

/** Goal mode status + controls. Real behavior needs the SDK runtime. */
export function GoalPanel({ sessionId, open, onClose }: GoalPanelProps) {
  const health = useServerHealth();
  const sdk = health.data?.runtime === 'sdk';
  const goalQuery = useGoal(sdk ? sessionId : undefined);
  const action = useGoalAction(sessionId);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  const run = (input: Parameters<typeof action.mutate>[0]) => {
    setError(null);
    action.mutate(input, { onError: (err) => fail(err, 'Goal action failed') });
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
    run({ action: 'set', objective: text, ...(tokenBudget !== undefined ? { tokenBudget } : {}) });
  };

  const state = goalQuery.data ?? null;
  const goal = state?.goal ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Goal mode"
    >
      <button
        type="button"
        aria-label="Close goal panel"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-md flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-3 shadow-lg">
        <div className="flex items-center gap-2">
          <Crosshair className="size-4 shrink-0 text-[hsl(var(--primary))]" />
          <h2 className="flex-1 text-[13px] font-semibold">Goal mode</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {!sdk && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Goal mode needs the SDK runtime — set AI_GUI_RUNTIME=sdk and restart the server. RPC
            sessions show this panel read-only.
          </p>
        )}
        {sdk && goalQuery.isPending && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading…</p>
        )}
        {goal && (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2">
            <p className="text-[13px] font-medium">{goal.objective}</p>
            <p className="pt-0.5 font-mono text-xs text-[hsl(var(--muted-foreground))]">
              {goal.status}
              {typeof goal.tokenBudget === 'number'
                ? ` · ${(goal.tokensUsed / 1000).toFixed(1)}k / ${(goal.tokenBudget / 1000).toFixed(1)}k tokens`
                : ` · ${(goal.tokensUsed / 1000).toFixed(1)}k tokens`}
            </p>
          </div>
        )}
        {state && !goal && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            No goal set for this session.
          </p>
        )}
        {sdk && (
          <>
            <div className="flex gap-1">
              <Input
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Objective, e.g. Refactor auth to OAuth2"
                aria-label="Goal objective"
                className="text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSet();
                }}
              />
              <Input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="Budget"
                aria-label="Token budget (number or off)"
                className="w-24 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSet();
                }}
              />
              <Button size="sm" onClick={handleSet} disabled={action.isPending}>
                Set
              </Button>
            </div>
            {goal && (
              <div className="flex gap-1">
                {goal.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run({ action: 'pause' })}
                    disabled={action.isPending}
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => run({ action: 'resume' })}
                    disabled={action.isPending}
                  >
                    Resume
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run({ action: 'drop' })}
                  disabled={action.isPending}
                >
                  Drop
                </Button>
              </div>
            )}
          </>
        )}
        {(error || action.isError) && (
          <p className="text-xs text-[hsl(var(--destructive))]">{error ?? 'Goal action failed.'}</p>
        )}
      </div>
    </div>
  );
}
