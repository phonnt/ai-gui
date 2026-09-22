import type * as React from 'react';
import { cn } from '../utils';

/**
 * oc-2 `menu-v2` item: 28px tall, 12px inline padding, 8px gap, 4px radius,
 * full-width, highlighted with the hover overlay.
 */
export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  selected?: boolean;
}

export function MenuItem({ icon, selected, className, children, ...props }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex h-7 w-full items-center gap-2 rounded-sm px-3 text-left text-body text-foreground transition-colors hover:bg-accent disabled:opacity-50',
        selected && 'font-strong text-link',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * oc-2 command-palette row: 36px tall, 12px inline padding, 6px radius, title at
 * 13/530 with a muted meta slot on the right.
 */
export interface PaletteRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  meta?: React.ReactNode;
}

export function PaletteRow({ active, meta, className, children, ...props }: PaletteRowProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-9 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-body transition-colors hover:bg-accent',
        active && 'bg-accent',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate font-strong">{children}</span>
      {meta ? <span className="shrink-0 text-meta text-muted-foreground">{meta}</span> : null}
    </button>
  );
}
