import { Button } from '@grove/ui';
import { Repeat, X } from 'lucide-react';
import { useLoop, usePauseLoop, useStopLoop } from '../../lib/api-client/hooks';

/** Token budget text: iterations left, or the time left on a duration limit. */
function limitText(limit: NonNullable<ReturnType<typeof useLoop>['data']>['limit']): string | null {
  if (!limit) return null;
  if (limit.kind === 'iterations') return `${limit.remaining ?? 0} left`;
  if (!limit.deadlineMs) return null;
  const leftMs = Math.max(0, limit.deadlineMs - Date.now());
  const minutes = Math.floor(leftMs / 60_000);
  const seconds = Math.floor((leftMs % 60_000) / 1000);
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s left` : `${seconds}s left`;
}

/**
 * Loop mode strip (TUI status-line segment): the prompt re-submits after every
 * yield until the limit runs out, the loop is paused, or it is stopped.
 */
export function LoopStrip({ sessionId }: { sessionId: string }) {
  const loopQuery = useLoop(sessionId);
  const stop = useStopLoop(sessionId);
  const pause = usePauseLoop(sessionId);
  const loop = loopQuery.data;
  if (!loop?.active) return null;

  const limit = limitText(loop.limit);
  return (
    <div
      role="status"
      aria-label="Loop mode"
      className="flex min-w-0 items-center gap-2 hairline-t bg-card px-3 py-1 text-xs"
    >
      <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">
        loop {loop.paused ? 'paused' : 'on'} · {loop.mode}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={loop.prompt ?? ''}>
        {loop.prompt}
      </span>
      {limit && <span className="shrink-0 font-mono text-muted-foreground">{limit}</span>}
      <Button
        variant="ghost"
        onClick={() => pause.mutate(!loop.paused)}
        disabled={pause.isPending}
        title={
          loop.paused ? 'Resume re-submitting' : 'Stop re-submitting (current turn keeps running)'
        }
      >
        {loop.paused ? 'Resume' : 'Pause'}
      </Button>
      <Button
        variant="ghost"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        aria-label="Stop loop"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
