import type * as React from 'react';
import { useEscapeToClose } from '../hooks/use-escape-close';
import { cn } from '../utils';

/**
 * Anchored dropdown surface (oc-2 `menu-v2` chrome): `layer-01` panel, floating
 * elevation, hairline edge. Non-modal — it does not trap focus, only closes on
 * Escape, so the control that opened it keeps focus.
 */
interface PopoverProps {
  open: boolean;
  label: string;
  onClose: () => void;
  /** Positioning classes from the caller (e.g. `absolute left-0 top-full mt-1`). */
  className?: string;
  listbox?: boolean;
  children: React.ReactNode;
}

export function Popover({ open, label, onClose, className, listbox, children }: PopoverProps) {
  useEscapeToClose(open, onClose);
  if (!open) return null;

  const surface = cn(
    'z-50 flex flex-col overflow-hidden rounded-md bg-popover shadow-floating hairline',
    className,
  );

  if (listbox) {
    return (
      <div role="listbox" aria-label={label} className={surface}>
        {children}
      </div>
    );
  }

  return (
    <div role="menu" aria-label={label} className={surface}>
      {children}
    </div>
  );
}
