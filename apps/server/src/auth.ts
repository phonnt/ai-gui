export const TOKEN_HEADER = 'x-ai-gui-token';
export const TOKEN_COOKIE = 'ai_gui_token';

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

export function tokenCookieHeader(token: string): string {
  return `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}
