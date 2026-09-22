import type * as React from 'react';
import { cn } from '../utils';

/**
 * oc-2 `field-v2`: a 12px/530 label over an optional 11px muted description,
 * with the control under it and 12px of vertical padding.
 */
export interface FieldProps {
  label: string;
  description?: string;
  /** Rendered on the right of the label row (e.g. the current value). */
  trailing?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function Field({ label, description, trailing, className, children }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-3 py-3', className)}>
      <div className="flex items-baseline gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-small font-strong text-foreground">{label}</span>
          {description ? (
            <span className="text-meta text-muted-foreground">{description}</span>
          ) : null}
        </div>
        {trailing}
      </div>
      {children}
    </div>
  );
}
