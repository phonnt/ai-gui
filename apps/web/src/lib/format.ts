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
