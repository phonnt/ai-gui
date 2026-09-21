import { InvalidRequestError, PathNotFoundError } from '@grove/agent-runtime';

/**
 * SDK failures that describe the *caller's* input rather than a server fault.
 *
 * The SDK throws plain `Error`s for these (there is no typed error to catch),
 * so the boundary has to recognise the message and rethrow
 * {@link InvalidRequestError}. Without it every precondition failure reaches the
 * web client as `500`, which reads as a Grove outage: a stale `edit` tag, a
 * branch with nothing to branch from, a language server that is not configured.
 *
 * Keep each pattern tied to an observed message; do not generalise to bare
 * "not found"/"invalid", which the SDK also uses for real faults.
 */
const CLIENT_CONDITION_PATTERNS: RegExp[] = [
  // edit: the file changed since the client read it (tag mismatch).
  /Edit rejected for/,
  /is not from this session/,
  // tree/branch preconditions.
  /branch requires a user message/,
  /tree node not found/,
  // compaction preconditions.
  /Nothing to compact/,
  // language servers are resolved per session/cwd.
  /No language server/,
  /not found for this action/,
  // memory ops that need a backend the session does not run.
  /is not active for this session/,
  // supervised processes: unknown daemon name.
  /Unknown daemon/,
  // debug: no DAP session attached yet.
  /No active debug session/,
];

/** `InvalidRequestError` when the message is a known caller condition, else null. */
export function toInvalidRequestError(err: unknown): InvalidRequestError | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!CLIENT_CONDITION_PATTERNS.some((pattern) => pattern.test(message))) return null;
  return new InvalidRequestError(message);
}

/**
 * File tool failures for a path the caller named but that does not exist. These
 * patterns match the *raw* SDK message, before the tool wrapper prefixes it with
 * the tool name (`read: …`), because classification happens inside that wrapper.
 * A missing file is a different class than the preconditions above: the resource
 * is missing (404), not the request malformed (400).
 */
const MISSING_PATH_PATTERNS: RegExp[] = [/^Path .* not found/, /^File not found/];

/** `PathNotFoundError` when the message reports a missing file, else null. */
export function toPathNotFoundError(err: unknown): PathNotFoundError | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!MISSING_PATH_PATTERNS.some((pattern) => pattern.test(message))) return null;
  return new PathNotFoundError(message);
}
