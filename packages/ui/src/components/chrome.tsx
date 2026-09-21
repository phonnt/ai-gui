import type * as React from 'react';
import { cn } from '../utils';

/** Panel card: oc-2 `layer-01` surface with a 0.5px hairline edge. */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md bg-card hairline', className)} {...props} />;
}

/**
 * Pane header: 40px tall by default with a hairline rule under it, matching the
 * app's pane chrome (title 13/530, muted meta).
 */
export function PaneHeader({
  title,
  icon,
  meta,
  actions,
  className,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header
      className={cn('flex h-10 shrink-0 items-center gap-2 px-3 text-body hairline-b', className)}
    >
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      {title ? <h2 className="shrink-0 font-strong text-foreground">{title}</h2> : null}
      {meta ? <span className="min-w-0 flex-1 truncate text-muted-foreground">{meta}</span> : null}
      {children}
      {actions ? <span className="ml-auto flex shrink-0 items-center gap-1">{actions}</span> : null}
    </header>
  );
}

/** Uppercase group label used above lists and inside settings pages. */
export function SectionLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return (
    <p
      className={cn('px-2 pt-2 pb-1 font-strong text-meta text-muted-foreground', className)}
      {...props}
    />
  );
}
