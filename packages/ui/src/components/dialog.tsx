import type * as React from 'react';
import { useEscapeToClose } from '../hooks/use-escape-close';
import { cn } from '../utils';
import { IconButton } from './icon-button';

/**
 * OpenCode Desktop dialog recipe (oc-2 `dialog-v2`): `layer-01` surface,
 * `--elevation-overlay`, 6px radius, 16px header/footer insets, scrim that
 * follows the colour scheme (`--overlay` at `--overlay-alpha`), Escape closes
 * the innermost dialog.
 */
const sizes = {
  md: 'w-[480px] max-w-[calc(100vw-32px)] h-[368px]',
  lg: 'w-[640px] max-w-[calc(100vw-32px)] h-[480px]',
  xl: 'w-[min(100vw-32px,980px)] h-[min(100vh-92px,600px)]',
  fit: 'w-[440px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-92px)]',
} as const;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name; also used for the scrim's close label. */
  label: string;
  size?: keyof typeof sizes;
  align?: 'center' | 'top';
  /** Command-palette style dialogs use the 10px radius. */
  radius?: 'md' | 'xl';
  className?: string;
  children: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  label,
  size = 'fit',
  align = 'center',
  radius = 'md',
  className,
  children,
}: DialogProps) {
  useEscapeToClose(open, onClose);
  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center p-4',
        align === 'top' ? 'items-start pt-24' : 'items-center',
      )}
    >
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default outline-none scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          'relative flex flex-col overflow-hidden bg-popover shadow-overlay',
          radius === 'xl' ? 'rounded-xl' : 'rounded-md',
          sizes[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  title,
  description,
  icon,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
      {icon ? <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-title text-foreground">{title}</h2>
        {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      {onClose ? <IconButton label="Close" onClick={onClose} variant="ghost" /> : null}
    </header>
  );
}

export function DialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-2', className)} {...props} />;
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 items-center justify-end gap-2 px-4 pt-2 pb-4', className)}
      {...props}
    />
  );
}
