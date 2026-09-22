/**
 * Compact number formatting for the app's narrow UI surfaces (session rows,
 * roster columns, footer stats). One implementation, shared by the features —
 * the sidebar, hub roster and stats panel each carried a near-identical copy.
 */

/** 850 → 850, 12_400 → 12.4k, 2_500_000 → 2.50M. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 512 → 512 B, 12_400 → 12.1 KB, 3_000_000 → 2.9 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 45 → 45ms, 1500 → 1.5s, 90_000 → 1m30s (the transcript and job rows). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  return `${minutes}m${seconds}s`;
}

/** Web-side error text: the UI wants the message, never the stack. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed.';
}
