import type { ContextLevel } from '@grove/core';

/**
 * Saturation colour per context level, reusing existing tokens: amber → ember
 * (the accent, one step hotter) → destructive for the terminal state.
 *
 * Lives here rather than in a feature: both the stats panel (which computes the
 * level) and the chat footer (which renders it) need it, and features must not
 * import each other.
 */
export const CONTEXT_LEVEL_CLASS: Record<ContextLevel, string> = {
  normal: '',
  warning: 'text-[hsl(var(--warning-strong))]',
  purple: 'text-[hsl(var(--syntax-keyword))]',
  error: 'text-[hsl(var(--destructive))]',
};
