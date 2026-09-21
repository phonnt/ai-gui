export const TOKEN_HEADER = 'x-grove-token';
export const TOKEN_COOKIE = 'grove_token';

/** Bearer token from the dedicated header, else the same-origin cookie. */
export function readRequestToken(req: Request): string | null {
  const header = req.headers.get(TOKEN_HEADER);
  if (header) return header;
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === TOKEN_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Loopback API guard. An undefined token disables auth (dev), matching the
 * server's current no-auth flow. The webview receives the cookie when the
 * server serves index.html, so same-origin fetch and WS carry it implicitly.
 */
export function isAuthorized(req: Request, token: string | undefined): boolean {
  if (!token) return true;
  return readRequestToken(req) === token;
}

/**
 * The API surface: bare `/api` (no route of its own) and everything under
 * `/api/`. Shared by the auth guard and the static exclusion so the two can
 * never disagree and let a bare `/api` slip past the guard into the SPA.
 */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Hostnames allowed to reach this server. The server binds 127.0.0.1 and hands
 * its token cookie to any anonymous `GET /`, so the Host header — not the token
 * — is what stops a page that rebinds a hostname to the loopback address from
 * talking to the API as if it were the desktop webview.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** True when the Host header names the loopback interface (port ignored). */
export function isLoopbackHost(header: string | null | undefined): boolean {
  if (!header) return false;
  const trimmed = header.trim().toLowerCase();
  const host = trimmed.startsWith('[')
    ? trimmed.slice(0, trimmed.indexOf(']') + 1)
    : (trimmed.split(':')[0] ?? '');
  return LOOPBACK_HOSTS.has(host);
}

export function tokenCookieHeader(token: string): string {
  return `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

/**
 * Read the gateway token and remove it from the environment it came from.
 *
 * The server keeps the value in a local for its own comparisons, but any child
 * process it spawns — our detached bash *and* the SDK's own bash tool, which
 * builds its environment from `Bun.env` — would otherwise inherit the secret and
 * could echo it back to the model. Re-injection from a project `.env` in the
 * session cwd is the user's own choice, not ours.
 */
export function takeTokenFromEnv(env: Record<string, string | undefined>): string | undefined {
  const token = env.GROVE_TOKEN;
  delete env.GROVE_TOKEN;
  return token;
}
