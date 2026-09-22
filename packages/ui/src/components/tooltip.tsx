import * as React from 'react';
import { cn } from '../utils';

/**
 * Lightweight tooltip: keeps the native `title` (works without JS) and adds a
 * styled bubble on hover/focus for pointer users, wired through
 * `aria-describedby` so screen readers get the same text.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}) {
  const id = React.useId();
  return (
    <span className={cn('group relative inline-flex', className)}>
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-sm bg-popover px-1.5 py-[5px] text-meta text-foreground shadow-floating hairline group-hover:block group-focus-within:block"
      >
        {label}
      </span>
    </span>
  );
}
