export type ContextLevel = 'normal' | 'warning' | 'purple' | 'error';

interface Threshold {
  level: ContextLevel;
  percent: number;
  tokens: number;
}

/**
 * Escalation ladder, keyed on percentage *or* absolute tokens: a level is
 * reached at whichever bites first for the model's window, so a large window
 * and a small one escalate on comparable absolute pressure. Values mirror the
 * TUI status line; order is most severe first.
 */
const LADDER: readonly Threshold[] = [
  { level: 'error', percent: 90, tokens: 500_000 },
  { level: 'purple', percent: 70, tokens: 270_000 },
  { level: 'warning', percent: 50, tokens: 150_000 },
];

function reaches(percent: number, contextWindow: number, threshold: Threshold): boolean {
  if (!Number.isFinite(percent) || percent <= 0) return false;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return percent >= threshold.percent;
  }
  const tokenPercentThreshold = (threshold.tokens / contextWindow) * 100;
  return percent >= Math.min(threshold.percent, tokenPercentThreshold);
}

/**
 * Escalation level for context saturation. A window <= 0 (unknown) falls back
 * to percentage-only thresholds.
 */
export function contextLevel(percent: number, contextWindow: number): ContextLevel {
  for (const threshold of LADDER) {
    if (reaches(percent, contextWindow, threshold)) return threshold.level;
  }
  return 'normal';
}
