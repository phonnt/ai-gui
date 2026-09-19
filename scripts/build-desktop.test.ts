import { describe, expect, test } from 'bun:test';
import { platformTarget } from './build-desktop';

describe('platformTarget', () => {
  test('maps darwin arm64', () => {
    expect(platformTarget('darwin', 'arm64')).toEqual({
      triple: 'aarch64-apple-darwin',
      addonPattern: 'pi_natives.darwin-arm64.node',
      exeSuffix: '',
    });
  });
  test('maps win32 x64 with exe suffix', () => {
    expect(platformTarget('win32', 'x64')).toEqual({
      triple: 'x86_64-pc-windows-msvc',
      addonPattern: 'pi_natives.win32-x64*.node',
      exeSuffix: '.exe',
    });
  });
  test('rejects unsupported', () => {
    expect(() => platformTarget('linux', 'x64')).toThrow(/unsupported platform/);
  });
});
