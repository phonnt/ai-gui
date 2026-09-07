/**
 * Pure helpers for the SDK-direct SessionTools surface (no SDK imports, so
 * this module stays unit-testable without the toolchain installed).
 */

/**
 * Derive a session's artifact directory from its journal file, mirroring the
 * SDK `artifactsDirectoryFor` rule: strip one trailing `.jsonl` suffix.
 * Returns null for anything else (e.g. a session with no journal yet).
 */
export function artifactsDirForSessionFile(sessionFile: string | null | undefined): string | null {
  if (!sessionFile?.endsWith('.jsonl')) return null;
  return sessionFile.slice(0, -'.jsonl'.length);
}

export interface ParsedArtifactFile {
  id: string;
  kind: string;
}

/**
 * Parse an SDK artifact filename (`<id>.<toolType>.log`, ids allocated
 * sequentially per session by `ArtifactManager`). Returns null for foreign
 * files sharing the directory. Mirrors the SDK `resolveArtifactFile` match
 * rule (`startsWith(`${id}.`)`) generalized to also recover the tool kind.
 */
export function parseArtifactFilename(filename: string): ParsedArtifactFile | null {
  const slash = filename.lastIndexOf('/');
  const base = slash >= 0 ? filename.slice(slash + 1) : filename;
  const match = /^(\d+)\.(.+)\.log$/.exec(base);
  if (!match) return null;
  const [, id, kind] = match;
  if (!id || !kind) return null;
  return { id, kind };
}

/**
 * Match one artifact id against directory filenames using the SDK rule
 * (first file whose name starts with `<id>.`).
 */
export function findArtifactFilename(filenames: string[], id: string): string | null {
  if (!/^\d+$/.test(id)) return null;
  return filenames.find((name) => name.startsWith(`${id}.`)) ?? null;
}

export interface LineSlice {
  content: string;
  truncated: boolean;
}

/**
 * Slice text to a `start-end` line window (1-based, inclusive both ends).
 * Supported forms: `N-M`, `N-` (open-ended), `-N` (last N lines), `N`
 * (single line). Unknown forms return the full text untruncated so callers
 * never lose content on a range typo — range validation belongs to schemas.
 */
export function sliceLinesByRange(text: string, range: string | undefined): LineSlice {
  if (!range) return { content: text, truncated: false };
  const lines = text.split('\n');
  const single = /^(\d+)$/.exec(range.trim());
  if (single) {
    const n = Number(single[1]);
    const line = lines[n - 1];
    return line === undefined
      ? { content: '', truncated: true }
      : { content: line, truncated: lines.length > 1 };
  }
  const window = /^(\d*)-(\d*)$/.exec(range.trim());
  if (!window) return { content: text, truncated: false };
  const [, startRaw, endRaw] = window;
  if (!startRaw) {
    const n = Number(endRaw);
    if (!Number.isSafeInteger(n) || n <= 0) return { content: text, truncated: false };
    const tail = lines.slice(Math.max(0, lines.length - n));
    return { content: tail.join('\n'), truncated: lines.length > n };
  }
  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start <= 0) return { content: text, truncated: false };
  const end = endRaw ? Number(endRaw) : Number.NaN;
  const sliced =
    endRaw && Number.isSafeInteger(end) && end >= start
      ? lines.slice(start - 1, end)
      : lines.slice(start - 1);
  return { content: sliced.join('\n'), truncated: lines.length > sliced.length };
}

const HASHLINE_HEADER_RE = /^\[([^\]\n]*)#([0-9A-Za-z]{4})\]\s*$/;

/**
 * Split the SDK hashline header (`[displayPath#tag]`, first line of a
 * hashline-mode read) off tool output. Returns the bare body plus the tag;
 * non-matching text passes through untouched with no tag.
 */
export function splitHashlineHeader(text: string): { body: string; tag?: string } {
  const newline = text.indexOf('\n');
  const first = newline < 0 ? text : text.slice(0, newline);
  const match = HASHLINE_HEADER_RE.exec(first);
  if (!match) return { body: text };
  const tag = match[2];
  if (!tag) return { body: text };
  return { body: newline < 0 ? '' : text.slice(newline + 1), tag };
}

/** True when hashline edit input already carries its own `[path#tag]` section. */
export function hasHashlineSection(input: string): boolean {
  return HASHLINE_HEADER_RE.test(input.split('\n')[0] ?? '');
}
