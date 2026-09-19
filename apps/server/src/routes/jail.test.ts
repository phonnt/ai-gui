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

  test('passes internal-scheme URIs through for the SDK to resolve', () => {
    for (const uri of [
      'skill://shadcn',
      'artifact://ab12',
      'memory://learned.md',
      'agent://AuditTools',
      'conflict://3',
    ]) {
      expect(resolveSessionPath(cwd, uri)).toBe(uri);
    }
  });

  test('rejects external URI-like inputs', () => {
    for (const uri of ['file:///etc/passwd', 'http://example.com/x', 'ssh://host/path']) {
      try {
        resolveSessionPath(cwd, uri);
        throw new Error(`expected 403 for ${uri}`);
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(403);
      }
    }
  });

  test('keeps selector suffixes on cwd-relative paths', () => {
    expect(resolveSessionPath(cwd, 'src/a.ts:10-20')).toBe(`${cwd}/src/a.ts:10-20`);
    expect(resolveSessionPath(cwd, 'bundle.zip:inner/readme.md')).toBe(
      `${cwd}/bundle.zip:inner/readme.md`,
    );
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
