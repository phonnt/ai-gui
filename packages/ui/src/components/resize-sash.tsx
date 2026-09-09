import { useState } from 'react';

export interface ResizeSashProps {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string;
  /** Panel grows toward the left (right-side panel) or right (sidebar). */
  direction: 'left' | 'right';
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  storageKey: string;
  onChange: (width: number) => void;
  /** Positioning of the hit zone, e.g. "absolute inset-y-0 -left-[9px] w-2". */
  className?: string;
}

/** Read a persisted sash width, clamped. Exported for state initializers. */
export function loadSashWidth(
  storageKey: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const saved = Number(window.localStorage.getItem(storageKey));
  return Number.isFinite(saved) && saved >= min && saved <= max ? saved : defaultValue;
}

/**
 * VSCode-style drag sash: pointer drag, double-click reset, arrow keys.
 * The indicator line (child span) highlights on hover/focus and stays lit
 * while dragging. Uses a sized div — an hr collapses under preflight
 * height:0 and misses hit tests.
 */
export function ResizeSash({
  label,
  direction,
  value,
  min,
  max,
  defaultValue,
  storageKey,
  onChange,
  className,
}: ResizeSashProps) {
  const [dragging, setDragging] = useState(false);
  const clamp = (w: number) => Math.min(max, Math.max(min, w));
  const persist = (w: number) => window.localStorage.setItem(storageKey, String(Math.round(w)));

  return (
    /* biome-ignore lint/a11y/useSemanticElements: hr is void and collapses under preflight height:0; this separator needs size + keyboard */
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onDoubleClick={() => {
        onChange(defaultValue);
        persist(defaultValue);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const grow = direction === 'left' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
        const next = clamp(value + (grow ? 20 : -20));
        onChange(next);
        persist(next);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        // Anchor on the panel edge, not the sash: the edge stays fixed in
        // the layout while the sash moves with the pointer.
        const edge =
          direction === 'left'
            ? (target.parentElement?.getBoundingClientRect().right ?? rect.right)
            : (target.parentElement?.getBoundingClientRect().left ?? rect.left);
        setDragging(true);
        const move = (ev: PointerEvent) => {
          onChange(direction === 'left' ? clamp(edge - ev.clientX) : clamp(ev.clientX - edge));
        };
        const up = (ev: PointerEvent) => {
          persist(direction === 'left' ? clamp(edge - ev.clientX) : clamp(ev.clientX - edge));
          setDragging(false);
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      className={`cursor-col-resize touch-none focus-visible:outline-none [&:hover>span]:bg-[hsl(var(--primary))] [&:focus-visible>span]:bg-[hsl(var(--primary))] ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 ${dragging ? 'bg-[hsl(var(--primary))]' : ''}`}
      />
    </div>
  );
}
