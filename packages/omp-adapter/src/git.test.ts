import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdkAdapter } from './sdk.js';

function gitRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'grove-git-'));
  execFileSync('git', ['init', '-q'], { cwd });
  writeFileSync(join(cwd, 'a.txt'), 'one\n');
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], {
    cwd,
  });
  writeFileSync(join(cwd, 'a.txt'), 'one\ntwo\n');
  return cwd;
}

describe('git surface', () => {
  test('reports branch, changed files and line counts in a repo', async () => {
    const cwd = gitRepo();
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const status = await adapter.gitStatus(session.id);

    expect(status.detached).toBe(false);
    expect(status.branch.length).toBeGreaterThan(0);
    expect(status.entries.map((entry) => entry.path)).toContain('a.txt');
    expect(status.insertions).toBe(1);

    const diff = await adapter.gitDiff(session.id, 'a.txt');
    expect(diff.text).toContain('+two');

    await adapter.dispose();
  }, 30_000);

  test('a directory outside any repo degrades instead of throwing', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-nogit-'));
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const status = await adapter.gitStatus(session.id);

    expect(status).toEqual({
      branch: '',
      detached: false,
      entries: [],
      insertions: 0,
      deletions: 0,
    });

    await adapter.dispose();
  }, 30_000);
});

describe('git diff quoting', () => {
  test('a path that looks like a command substitution is passed literally', async () => {
    const cwd = gitRepo();
    const hostile = 'pwned$(echo INJECTED >&2).txt';
    writeFileSync(join(cwd, hostile), 'x\n');
    execFileSync('git', ['add', '.'], { cwd });
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const diff = await adapter.gitDiff(session.id, hostile);

    // The file is new, so the diff is empty — what must not happen is the shell
    // running `echo INJECTED`, or the path being silently replaced.
    expect(diff.text).not.toContain('INJECTED');
    const status = await adapter.gitStatus(session.id);
    expect(status.entries.some((entry) => entry.path.includes('pwned'))).toBe(true);

    await adapter.dispose();
  }, 30_000);

  test('a path with a single quote still resolves', async () => {
    const cwd = gitRepo();
    const awkward = "it's a file.txt";
    writeFileSync(join(cwd, awkward), 'one\n');
    execFileSync('git', ['add', '.'], { cwd });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add'], {
      cwd,
    });
    writeFileSync(join(cwd, awkward), 'one\ntwo\n');
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const diff = await adapter.gitDiff(session.id, awkward);

    expect(diff.text).toContain('+two');

    await adapter.dispose();
  }, 30_000);
});

describe('branch name parsing', () => {
  test('keeps a dotted branch whole instead of cutting at the first dot', async () => {
    const cwd = gitRepo();
    execFileSync('git', ['checkout', '-q', '-b', 'release/2.0'], { cwd });
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const status = await adapter.gitStatus(session.id);

    expect(status.branch).toBe('release/2.0');

    await adapter.dispose();
  }, 30_000);

  test('an unborn HEAD reports its branch rather than the sentence', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'grove-unborn-'));
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });

    const status = await adapter.gitStatus(session.id);

    expect(status.branch).toBe('main');

    await adapter.dispose();
  }, 30_000);
});
