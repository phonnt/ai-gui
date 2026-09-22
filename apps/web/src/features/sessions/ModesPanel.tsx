import type { ModeActionDto, SessionModesDto } from '@grove/protocol';
import { Button, Dialog, useEscapeToClose } from '@grove/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useGoal, useModes, useSetMode } from '../../lib/api-client/hooks';

interface ModesPanelProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

const FLAG_MODES = [
  { mode: 'plan', label: 'Plan', hint: 'Agent plans before executing' },
  { mode: 'vibe', label: 'Vibe', hint: 'Persistent fast worker session' },
  { mode: 'advisor', label: 'Advisor', hint: 'Second model reviews each turn' },
  { mode: 'fast', label: 'Fast tier', hint: 'Priority service tier' },
] as const;

type FlagMode = (typeof FLAG_MODES)[number]['mode'];

/** Agent mode toggles. The runtime is SDK-only, so modes always load. */
export function ModesPanel({ sessionId, open, onClose }: ModesPanelProps) {
  useEscapeToClose(open, onClose);
  const modesQuery = useModes(sessionId);
  const goalQuery = useGoal(sessionId);
  const setMode = useSetMode(sessionId);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const run = (action: ModeActionDto) => {
    setError(null);
    setMode.mutate(action, {
      onError: (err) => setError(err instanceof Error ? err.message : 'Mode change failed'),
    });
  };

  const toggleFlag = (mode: FlagMode, current: boolean) => run({ mode, enabled: !current });

  const modes: SessionModesDto | undefined = modesQuery.data;
  // OMP keeps plan, vibe and goal mutually exclusive; a turn cannot be both a
  // planning turn and an autonomous goal/vibe turn. Mirror the TUI's blocker.
  const goalActive = goalQuery.data?.enabled === true;
  const blockedReason = (mode: FlagMode, on: boolean): string | null => {
    if (!modes || on) return null;
    if (mode === 'plan') {
      if (goalActive) return 'exit goal mode first';
      if (modes.vibe) return 'exit vibe mode first';
    }
    if (mode === 'vibe') {
      if (modes.plan) return 'exit plan mode first';
      if (goalActive) return 'exit goal mode first';
    }
    return null;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      label="Agent modes"
      align="top"
      className="relative flex w-full max-w-md flex-col gap-2 rounded-md panel-plain bg-popover p-3 shadow-floating"
    >
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="flex-1 text-body font-strong">Agent modes</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {modesQuery.isPending && <p className="text-small text-muted-foreground">Loading…</p>}
      {modesQuery.isError && <p className="text-small text-destructive">Failed to load modes.</p>}
      {modes && (
        <>
          <div className="flex flex-col gap-1">
            {FLAG_MODES.map(({ mode, label, hint }) => {
              const on = modes[mode];
              const blocked = blockedReason(mode, on);
              return (
                <div key={mode} className="flex items-center gap-2">
                  <Button
                    variant={on ? 'default' : 'outline'}
                    onClick={() => toggleFlag(mode, on)}
                    disabled={setMode.isPending || blocked !== null}
                    aria-pressed={on}
                    title={blocked ?? hint}
                    className="w-24"
                  >
                    {label}
                  </Button>
                  <span className="text-small text-muted-foreground">
                    {blocked ? `Blocked: ${blocked}` : hint}
                    {mode === 'fast' && modes.fastActive && on ? ' · active' : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-1 hairline-t pt-2">
            <QueueRow
              label="Steering"
              value={modes.steering}
              options={['all', 'one-at-a-time']}
              disabled={setMode.isPending}
              onPick={(value) => run({ mode: 'steering', value: value as 'all' | 'one-at-a-time' })}
            />
            <QueueRow
              label="Follow-up"
              value={modes.followUp}
              options={['all', 'one-at-a-time']}
              disabled={setMode.isPending}
              onPick={(value) => run({ mode: 'followUp', value: value as 'all' | 'one-at-a-time' })}
            />
            <QueueRow
              label="Interrupt"
              value={modes.interrupt}
              options={['immediate', 'wait']}
              disabled={setMode.isPending}
              onPick={(value) => run({ mode: 'interrupt', value: value as 'immediate' | 'wait' })}
            />
            {modes.prewalkArmed && (
              <p className="text-small text-muted-foreground">
                Prewalk armed — switches to the fast model at the first edit.
              </p>
            )}
          </div>
        </>
      )}
      {(error || setMode.isError) && (
        <p className="text-small text-destructive">{error ?? 'Mode change failed.'}</p>
      )}
    </Dialog>
  );
}

export function modesActive(modes: SessionModesDto | undefined): boolean {
  if (!modes) return false;
  return modes.plan || modes.vibe || modes.advisor || modes.fast;
}

function QueueRow({
  label,
  value,
  options,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-body">{label}</span>
      {options.map((option) => (
        <Button
          key={option}
          variant={value === option ? 'default' : 'ghost'}
          onClick={() => onPick(option)}
          disabled={disabled || value === option}
        >
          {option}
        </Button>
      ))}
    </div>
  );
}
