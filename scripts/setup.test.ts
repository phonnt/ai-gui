import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bunInstallCommand,
  chromiumInstalledIn,
  desktopFixes,
  meetsMinimum,
  playwrightCommand,
} from './setup';

describe('meetsMinimum', () => {
  test('compares numerically, not lexically', () => {
    expect(meetsMinimum('1.3.14')).toBe(true);
    expect(meetsMinimum('1.3.9')).toBe(false);
    expect(meetsMinimum('1.10.0')).toBe(true);
    expect(meetsMinimum('2.0.0')).toBe(true);
    expect(meetsMinimum('0.9.0')).toBe(false);
  });

  test('tolerates a leading v and prerelease suffixes', () => {
    expect(meetsMinimum('v1.3.14')).toBe(true);
    expect(meetsMinimum('1.4.0-canary.7')).toBe(true);
  });
});

describe('bunInstallCommand', () => {
  test('is a single line per platform', () => {
    expect(bunInstallCommand('win32')).toContain('install.ps1');
    expect(bunInstallCommand('darwin')).toBe('curl -fsSL https://bun.sh/install | bash');
    expect(bunInstallCommand('linux')).toBe(bunInstallCommand('darwin'));
  });
});

describe('desktopFixes', () => {
  test('returns the fixable hosts only', () => {
    expect(desktopFixes('darwin', 'arm64')).toHaveLength(2);
    expect(desktopFixes('win32', 'x64').join(' ')).toContain('Rustlang.Rustup');
    // Same hosts scripts/build-desktop.ts can package.
    expect(desktopFixes('darwin', 'x64')).toEqual([]);
    expect(desktopFixes('win32', 'arm64')).toEqual([]);
    expect(desktopFixes('linux', 'x64')).toEqual([]);
  });

  test('every fix is one runnable line', () => {
    for (const os of ['darwin', 'win32']) {
      for (const line of desktopFixes(os, os === 'darwin' ? 'arm64' : 'x64')) {
        expect(line.split('\n')).toHaveLength(1);
      }
    }
  });
});

describe('playwrightCommand', () => {
  test('needs --with-deps on Linux only', () => {
    expect(playwrightCommand('linux')).toContain('--with-deps');
    expect(playwrightCommand('darwin')).not.toContain('--with-deps');
    expect(playwrightCommand('win32')).not.toContain('--with-deps');
  });
});

describe('chromiumInstalledIn', () => {
  test('finds a versioned browser directory and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'grove-setup-'));
    try {
      expect(chromiumInstalledIn(dir)).toBe(false);
      mkdirSync(join(dir, 'chromium-1234'));
      expect(chromiumInstalledIn(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a missing cache dir is not an error', () => {
    expect(chromiumInstalledIn(join(tmpdir(), 'grove-setup-does-not-exist'))).toBe(false);
  });
});
