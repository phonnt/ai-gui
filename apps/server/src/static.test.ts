import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyStaticPath, contentTypeFor, isImmutableAsset, STATIC_CSP } from './static';

const dist = join(tmpdir(), 'ai-gui-dist');

describe('classifyStaticPath', () => {
  test('serves hashed assets by extension', () => {
    expect(classifyStaticPath(dist, '/assets/index-abc123.js')).toEqual({
      kind: 'asset',
      filePath: join(dist, 'assets', 'index-abc123.js'),
    });
    expect(classifyStaticPath(dist, '/favicon.ico')).toEqual({
      kind: 'asset',
      filePath: join(dist, 'favicon.ico'),
    });
  });

  test('falls back to the SPA for extensionless routes', () => {
    expect(classifyStaticPath(dist, '/')).toEqual({ kind: 'spa' });
    expect(classifyStaticPath(dist, '/s/01a0b7d9')).toEqual({ kind: 'spa' });
  });

  test('blocks traversal and encoded escapes', () => {
    expect(classifyStaticPath(dist, '/../../etc/passwd')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/%2e%2e/%2e%2e/etc/passwd')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/a/../../../x.txt')).toEqual({ kind: 'blocked' });
    expect(classifyStaticPath(dist, '/%')).toEqual({ kind: 'blocked' });
  });
});

describe('asset headers', () => {
  test('immutable only for hashed asset dir', () => {
    expect(isImmutableAsset(`${dist}/assets/x-abc.js`)).toBe(true);
    expect(isImmutableAsset(`${dist}/index.html`)).toBe(false);
  });

  test('content types cover the build output', () => {
    expect(contentTypeFor('a.html')).toContain('text/html');
    expect(contentTypeFor('a.js')).toContain('text/javascript');
    expect(contentTypeFor('a.css')).toContain('text/css');
    expect(contentTypeFor('a.woff2')).toBe('font/woff2');
    expect(contentTypeFor('a.unknown')).toBe('application/octet-stream');
  });

  test('CSP keeps script-src strict', () => {
    expect(STATIC_CSP).toContain("script-src 'self'");
    expect(STATIC_CSP).toContain("frame-ancestors 'none'");
    expect(STATIC_CSP).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
