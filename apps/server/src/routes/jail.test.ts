import { describe, expect, test } from 'bun:test';
import { HttpError } from './errors';
import { resolveSessionPath } from './jail';

describe('resolveSessionPath', () => {
  const cwd = '/tmp/ai-gui-jail-test';

  test('keeps relative and in-cwd absolute paths', () => {
    expect(resolveSessionPath(cwd, 'src/a.ts')).toBe(`${cwd}/src/a.ts`);
    expect(resolveSessionPath(cwd, `${cwd}/b.ts`)).toBe(`${cwd}/b.ts`);
    expect(resolveSessionPath(cwd, 'sub/../c.ts')).toBe(`${cwd}/c.ts`);
  });

  test('rejects escapes with 403', () => {
    for (const attempt of ['../x', 'a/../../x', '/etc/passwd', '~', '~/secret']) {
      try {
        resolveSessionPath(cwd, attempt);
        throw new Error(`expected 403 for ${attempt}`);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(403);
      }
    }
  });

  test('rejects URI-like inputs the SDK would resolve outside the cwd', () => {
    for (const uri of ['skill://x', 'artifact://0', 'file:///etc/passwd']) {
      try {
        resolveSessionPath(cwd, uri);
        throw new Error(`expected 403 for ${uri}`);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(403);
      }
    }
  });

  test('rejects missing paths with 400', () => {
    try {
      resolveSessionPath(cwd, '');
      throw new Error('expected 400');
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
    }
  });
});
