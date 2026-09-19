import { extname, resolve, sep } from 'node:path';

export type StaticTarget =
  | { kind: 'asset'; filePath: string }
  | { kind: 'spa' }
  | { kind: 'blocked' };

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function isImmutableAsset(filePath: string): boolean {
  return resolve(filePath).includes(`${sep}assets${sep}`);
}

/**
 * CSP served with static responses (spec §9). `'unsafe-inline'` styles and
 * `blob:` workers are required by Tailwind/CodeMirror/highlight; never relax
 * `script-src`.
 */
export const STATIC_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/**
 * Resolve a static request against the built web dist. `blocked` means the
 * path escaped the dist root or was not decodable — the caller answers 404 so
 * traversal attempts never reach the filesystem. Extensionless paths fall
 * back to the SPA entry (client-side router routes like /s/:id).
 */
export function classifyStaticPath(distDir: string, urlPath: string): StaticTarget {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return { kind: 'blocked' };
  }
  const root = resolve(distDir);
  const candidate = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return { kind: 'blocked' };
  if (extname(candidate) === '') return { kind: 'spa' };
  return { kind: 'asset', filePath: candidate };
}
