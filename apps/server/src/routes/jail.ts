import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { HttpError } from './errors.js';

/**
 * Schemes the SDK resolves inside the session itself (skills, artifacts,
 * memory, agent output, conflict markers). These are NOT cwd-relative, so the
 * jail passes them through untouched; the adapter's tool layer resolves them.
 */
const INTERNAL_SCHEMES = new Set(['skill', 'artifact', 'memory', 'agent', 'conflict']);

/**
 * External schemes that always resolve outside the session (absolute file
 * paths, network fetches). Selectors such as `archive.zip:member` or
 * `db.sqlite:table` are NOT schemes: they carry a cwd-relative file whose
 * suffix the SDK parses, so they pass the containment check below.
 */
const EXTERNAL_SCHEME_RE = /^(?:file|https?|ssh|ftps?|data|wss?):/i;

/** Windows drive-absolute path (`C:\…`), which `path.resolve` would not catch on POSIX. */
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;

/**
 * Resolve a client-supplied file path against the session workspace and reject
 * escapes with 403. Returns an absolute path guaranteed (lexically) to sit
 * under `cwd` or one of `roots` (the session's extra workspace directories).
 * Leading `~` is expanded before jailing; internal-scheme URIs are passed
 * through for the SDK to resolve; other URI-like inputs (`file:`, `http:`, …)
 * are rejected because they resolve outside the workspace.
 */
export function resolveSessionPath(
  cwd: string,
  input: string,
  roots: readonly string[] = [],
): string {
  if (!input) throw new HttpError(400, 'path is required');
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(input)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (INTERNAL_SCHEMES.has(scheme)) return input;
    throw new HttpError(403, `path escapes the session directory: ${input}`);
  }
  if (EXTERNAL_SCHEME_RE.test(input) || WINDOWS_ABS_RE.test(input)) {
    throw new HttpError(403, `path escapes the session directory: ${input}`);
  }
  const expanded =
    input === '~' || input.startsWith('~/') ? `${homedir()}${input.slice(1)}` : input;
  const abs = resolve(cwd, expanded);
  if (isWithin(cwd, abs)) return abs;
  for (const root of roots) {
    if (isWithin(root, abs)) return abs;
  }
  throw new HttpError(403, `path escapes the session directory: ${input}`);
}

/** True when `target` is `root` itself or lexically inside it. */
function isWithin(root: string, target: string): boolean {
  const rel = relative(resolve(root), target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
