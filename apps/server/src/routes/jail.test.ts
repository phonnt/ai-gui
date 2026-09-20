import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpError } from './errors';
import { resolveSessionPath } from './jail';

describe('resolveSessionPath', () => {
  const cwd = join(tmpdir(), 'ai-gui-jail-test');

  test('keeps relative and in-cwd absolute paths', () => {
    expect(resolveSessionPath(cwd, 'src/a.ts')).toBe(join(cwd, 'src', 'a.ts'));
    expect(resolveSessionPath(cwd, join(cwd, 'b.ts'))).toBe(join(cwd, 'b.ts'));
    expect(resolveSessionPath(cwd, 'sub/../c.ts')).toBe(join(cwd, 'c.ts'));
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
    expect(resolveSessionPath(cwd, 'src/a.ts:10-20')).toBe(`${join(cwd, 'src', 'a.ts')}:10-20`);
    expect(resolveSessionPath(cwd, 'bundle.zip:inner/readme.md')).toBe(
      `${join(cwd, 'bundle.zip')}:${join('inner', 'readme.md')}`,
    );
  });

  test('admits paths under extra workspace roots', () => {
    const extra = join(tmpdir(), 'ai-gui-extra-root');
    const other = join(tmpdir(), 'ai-gui-other');
    const roots = [extra, other];
    expect(resolveSessionPath(cwd, join(extra, 'src', 'a.ts'), roots)).toBe(
      join(extra, 'src', 'a.ts'),
    );
    expect(resolveSessionPath(cwd, extra, roots)).toBe(extra);
    // Also reachable relative to cwd, since the root is absolute.
    expect(resolveSessionPath(cwd, '../ai-gui-extra-root/a.ts', roots)).toBe(join(extra, 'a.ts'));
  });

  test('a root does not widen the jail to its siblings or parents', () => {
    const extra = join(tmpdir(), 'ai-gui-extra-root');
    const roots = [extra];
    for (const attempt of [
      join(tmpdir(), 'ai-gui-extra-root-evil', 'a.ts'),
      join(extra, '..', 'secret'),
      join(tmpdir(), 'ai-gui'),
      '/etc/passwd',
    ]) {
      try {
        resolveSessionPath(cwd, attempt, roots);
        throw new Error(`expected 403 for ${attempt}`);
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
