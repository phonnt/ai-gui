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
