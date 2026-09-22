import type * as React from 'react';
import { cn } from '../utils';
import { Button } from './button';

/**
 * The one shape every pane uses for a failed fetch: centred box, hairline edge,
 * red copy, optional retry. Replaces the twelve hand-rolled copies.
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Retry',
  className,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2 rounded-md p-3 text-center hairline',
        className,
      )}
    >
      <p className="text-small text-destructive">{message}</p>
      {onRetry ? (
        <Button variant="neutral" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** Neutral counterpart for "nothing here yet" panes. */
export function EmptyState({
  message,
  action,
  className,
}: {
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-md p-3 text-center hairline',
        className,
      )}
    >
      <p className="text-small text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

const DOT_TONES = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
  muted: 'bg-muted-foreground',
} as const;

/** Status dot shared by the session list, providers and job rows. */
export function StatusDot({
  tone,
  size = 'default',
  label,
  className,
  style,
}: {
  tone: keyof typeof DOT_TONES;
  size?: 'sm' | 'default';
  /** Provide when the dot is the only carrier of the state; omit for decoration. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
      style={style}
      className={cn(
        'shrink-0 rounded-full',
        size === 'sm' ? 'size-1.5' : 'size-2',
        DOT_TONES[tone],
        className,
      )}
    />
  );
}
