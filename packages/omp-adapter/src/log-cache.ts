/**
 * Cache for the supervised-process log tail.
 *
 * The SDK renders a log window per call (measured at 10-20s in the audit), and
 * the UI polls it while following a tail. Holding the rendered tail for a moment
 * and answering by cursor means a follow costs one render per window instead of
 * one per poll, and a cursor past the end answers empty instead of replaying.
 */
export interface LogCacheEntry {
  text: string;
  cursor: number;
}

export interface LogCache {
  put(key: string, text: string): void;
  /** `null` on a cold key or after the ttl; the caller renders again. */
  read(key: string, cursor: number | undefined): LogCacheEntry | null;
  clear(key: string): void;
}

export function createLogCache(options: { ttlMs: number; now?: () => number }): LogCache {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, { text: string; at: number }>();

  return {
    put(key, text) {
      entries.set(key, { text, at: now() });
    },
    read(key, cursor) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.at > options.ttlMs) {
        entries.delete(key);
        return null;
      }
      const text = cursor === undefined ? entry.text : entry.text.slice(cursor);
      return { text, cursor: entry.text.length };
    },
    clear(key) {
      entries.delete(key);
    },
  };
}
