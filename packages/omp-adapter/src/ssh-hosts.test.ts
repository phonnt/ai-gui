import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSSHConfigPath } from '@oh-my-pi/pi-utils';
import { SdkAdapter } from './sdk.js';

/**
 * `/ssh` in the TUI manages the hosts the `ssh://` read path uses: one JSON
 * file per scope (`getSSHConfigPath`). Tests use the project scope against a
 * throwaway cwd, so the real agent dir is never touched.
 */
const newCwd = () => mkdtempSync(join(tmpdir(), 'grove-ssh-'));

describe('ssh hosts', () => {
  test('adds, lists and removes a host in an empty config', async () => {
    const cwd = newCwd();
    const adapter = new SdkAdapter(cwd);

    expect(await adapter.listSshHosts(cwd, 'project')).toEqual([]);

    await adapter.addSshHost({
      cwd,
      scope: 'project',
      name: 'probe',
      host: '10.0.0.5',
      user: 'root',
      port: 2222,
    });

    expect(await adapter.listSshHosts(cwd, 'project')).toEqual(['probe']);

    await adapter.removeSshHost({ cwd, scope: 'project', name: 'probe' });

    expect(await adapter.listSshHosts(cwd, 'project')).toEqual([]);
  });

  test('rejects an invalid name and a duplicate', async () => {
    const cwd = newCwd();
    const adapter = new SdkAdapter(cwd);

    await expect(
      adapter.addSshHost({ cwd, scope: 'project', name: 'bad name', host: 'h' }),
    ).rejects.toThrow();
    await adapter.addSshHost({ cwd, scope: 'project', name: 'dup', host: 'h1' });
    await expect(
      adapter.addSshHost({ cwd, scope: 'project', name: 'dup', host: 'h2' }),
    ).rejects.toThrow();
    expect(await adapter.listSshHosts(cwd, 'project')).toEqual(['dup']);
  });

  test('a corrupt config file does not throw on list', async () => {
    const cwd = newCwd();
    const path = getSSHConfigPath('project', cwd);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{not json');
    const adapter = new SdkAdapter(cwd);

    expect(await adapter.listSshHosts(cwd, 'project')).toEqual([]);
  });
});
