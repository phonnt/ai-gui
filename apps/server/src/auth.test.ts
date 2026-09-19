import { describe, expect, test } from 'bun:test';
import {
  isAuthorized,
  readRequestToken,
  TOKEN_COOKIE,
  TOKEN_HEADER,
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
