import { useEffect } from 'react';

/**
 * Escape closes the innermost open dialog.
 *
 * A stack, not one listener per dialog: the settings modal can open the model
 * picker on top of itself, and a plain `window` listener per dialog would close
 * both on a single Escape. Whoever registered last owns the key; the rest wait
 * their turn.
 */
const openDialogs: symbol[] = [];

/** Close on Escape while `open`; the most recently opened dialog wins. */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const token = Symbol('dialog');
    openDialogs.push(token);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openDialogs[openDialogs.length - 1] !== token) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      const at = openDialogs.indexOf(token);
      if (at !== -1) openDialogs.splice(at, 1);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);
}
