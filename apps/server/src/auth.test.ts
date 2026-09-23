import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isAuthorized,
  isLoopbackHost,
  readRequestToken,
  TOKEN_COOKIE,
  TOKEN_HEADER,
  takeTokenFromEnv,
  takeTokenFromFile,
  tokenCookieHeader,
} from './auth';

const token = 's3cr3t';

describe('readRequestToken', () => {
  test('reads the header', () => {
    const req = new Request('http://x/api/health', { headers: { [TOKEN_HEADER]: token } });
    expect(readRequestToken(req)).toBe(token);
  });

  test('reads the cookie among others', () => {
    const req = new Request('http://x/api/health', {
      headers: { cookie: `a=1; ${TOKEN_COOKIE}=${token}; b=2` },
    });
    expect(readRequestToken(req)).toBe(token);
  });

  test('returns null when absent', () => {
    expect(readRequestToken(new Request('http://x/api/health'))).toBeNull();
  });
});

describe('isAuthorized', () => {
  test('auth disabled when token undefined', () => {
    expect(isAuthorized(new Request('http://x/'), undefined)).toBe(true);
  });
  test('rejects wrong or missing token', () => {
    expect(isAuthorized(new Request('http://x/'), token)).toBe(false);
    const bad = new Request('http://x/', { headers: { [TOKEN_HEADER]: 'nope' } });
    expect(isAuthorized(bad, token)).toBe(false);
  });
  test('accepts matching header', () => {
    const ok = new Request('http://x/', { headers: { [TOKEN_HEADER]: token } });
    expect(isAuthorized(ok, token)).toBe(true);
  });
});

describe('tokenCookieHeader', () => {
  test('is HttpOnly, SameSite=Strict, root path', () => {
    expect(tokenCookieHeader(token)).toBe(
      `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`,
    );
  });
});

describe('isLoopbackHost', () => {
  test('accepts the loopback names the app uses', () => {
    expect(isLoopbackHost('127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHost('localhost:5173')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('[::1]:8787')).toBe(true);
  });

  test('rejects everything else, including lookalikes', () => {
    expect(isLoopbackHost('10.0.0.5:8787')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });
});

describe('takeTokenFromEnv', () => {
  test('returns the token and removes it from the environment', () => {
    const env: Record<string, string | undefined> = {
      GROVE_TOKEN: 'secret',
      PATH: '/usr/bin',
    };
    expect(takeTokenFromEnv(env)).toBe('secret');
    expect('GROVE_TOKEN' in env).toBe(false);
    expect(env.PATH).toBe('/usr/bin');
  });

  test('is a no-op without the variable', () => {
    const env: Record<string, string | undefined> = { PATH: '/usr/bin' };
    expect(takeTokenFromEnv(env)).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });
});

describe('takeTokenFromFile', () => {
  test('reads the token and deletes the file', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'grove-token-')), 'gateway-token');
    writeFileSync(path, 'file-secret\n', { mode: 0o600 });

    expect(takeTokenFromFile(path)).toBe('file-secret');
    expect(existsSync(path)).toBe(false);
  });

  test('an unreadable or empty file fails loudly instead of disabling auth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grove-token-'));
    expect(() => takeTokenFromFile(join(dir, 'missing'))).toThrow(/unreadable/);

    const empty = join(dir, 'empty');
    writeFileSync(empty, '   \n');
    expect(() => takeTokenFromFile(empty)).toThrow(/empty/);
  });
});
