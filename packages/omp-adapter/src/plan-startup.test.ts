import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SdkAdapter } from './sdk.js';
import { settingsSet } from './settings.js';

/**
 * The TUI opens fresh interactive sessions in plan mode when
 * `plan.defaultOnStartup` is on (`src/modes/interactive-mode.ts`). The web runs
 * the SDK without a mode layer, so the adapter has to apply the setting itself.
 */
describe('plan.defaultOnStartup', () => {
  test('opens a fresh session in plan mode when the setting is on', async () => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-plan-agent-'));
    const cwd = mkdtempSync(join(tmpdir(), 'grove-plan-cwd-'));
    await settingsSet('plan.defaultOnStartup', true);

    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });
    const modes = await adapter.getSessionModes(session.id);
    await adapter.dispose();

    expect(modes.plan).toBe(true);
  });

  test('leaves a fresh session in normal mode when the setting is off', async () => {
    process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), 'grove-plan-agent-'));
    const cwd = mkdtempSync(join(tmpdir(), 'grove-plan-cwd-'));
    await settingsSet('plan.defaultOnStartup', false);

    const adapter = new SdkAdapter(cwd);
    const session = await adapter.createSession({ cwd });
    const modes = await adapter.getSessionModes(session.id);
    await adapter.dispose();

    expect(modes.plan).toBe(false);
  });
});
