import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { HttpError } from './errors.js';

const URI_LIKE_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Resolve a client-supplied file path against the session cwd and reject
 * escapes with 403. Returns an absolute path guaranteed (lexically) under
 * `cwd`. Leading `~` is expanded before jailing; URI-like inputs
 * (`skill://`, `artifact://`, `file:`, …) are rejected outright because the
 * SDK would resolve them outside the cwd.
 */
export function resolveSessionPath(cwd: string, input: string): string {
  if (!input) throw new HttpError(400, 'path is required');
  if (URI_LIKE_RE.test(input)) {
    throw new HttpError(403, `path escapes the session directory: ${input}`);
  }
  const expanded =
    input === '~' || input.startsWith('~/') ? `${homedir()}${input.slice(1)}` : input;
  const abs = resolve(cwd, expanded);
  const rel = relative(cwd, abs);
  if (rel === '') return abs;
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new HttpError(403, `path escapes the session directory: ${input}`);
  }
  return abs;
}
