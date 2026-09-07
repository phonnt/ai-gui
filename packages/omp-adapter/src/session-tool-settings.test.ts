import { describe, expect, test } from 'bun:test';
import { sessionToolSettingOverrides } from './session-tool-settings';

describe('sessionToolSettingOverrides', () => {
  test('enables the tool-surface backends, disables lsp/xdev, pins hashline edits', () => {
    expect(sessionToolSettingOverrides()).toEqual({
      'bash.enabled': true,
      'todo.enabled': true,
      'eval.js': true,
      'eval.py': true,
      'lsp.enabled': false,
      'tools.xdev': false,
      'edit.mode': 'hashline',
    });
  });

  test('returns a fresh object per call', () => {
    expect(sessionToolSettingOverrides()).not.toBe(sessionToolSettingOverrides());
  });
});
