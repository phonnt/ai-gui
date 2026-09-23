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
  /** Live keys, so a dropped session can take its tails with it. */
  keys(): string[];
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
    keys() {
      return [...entries.keys()];
    },
  };
}

/**
 * Whether this action may be answered from the tail cache.
 *
 * A `follow` is the SDK's own long poll: it waits for output *after* a byte
 * offset the daemon owns. Answering it from our cache returns an empty slice
 * immediately (the client's cursor is that entry's length), which the pane
 * renders as "no output", and the follow loop then re-issues without delay. So
 * the cache serves plain reads only — and for the same reason it never rewrites
 * `details.cursor` on a follow.
 */
export function servesFromCache(op: string, params: Record<string, unknown>): boolean {
  return op === 'logs' && params.follow !== true;
}

/** One key builder: a read, an invalidation and a session drop must agree. */
export function logCacheKey(sessionId: string, name: unknown): string {
  return `${sessionId}:${String(name ?? '')}`;
}

/**
 * A stop or restart ends the run the cached tail belongs to; without this the
 * pane keeps showing the old run's output (with `cached: true`) for the ttl.
 */
export function invalidatesLogCache(op: string): boolean {
  return op === 'stop' || op === 'restart';
}
