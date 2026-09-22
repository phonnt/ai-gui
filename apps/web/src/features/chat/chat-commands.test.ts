import { describe, expect, test } from 'bun:test';
import { buildSessionActions, type SessionActionDeps } from './chat-commands';

/** The palette only ever calls the deps a command actually uses. */
function deps(overrides: Partial<SessionActionDeps>): SessionActionDeps {
  return overrides as unknown as SessionActionDeps;
}

describe('rewind command', () => {
  test('branches from the newest user message', () => {
    const branched: string[] = [];
    const commands = buildSessionActions(
      deps({ lastUserMessageId: 'u2', onRewind: (id) => branched.push(id) }),
    );

    const rewind = commands.find((command) => command.id === 'session-rewind');
    expect(rewind).toBeDefined();
    rewind?.run();

    expect(branched).toEqual(['u2']);
  });

  test('does nothing when the transcript has no user message yet', () => {
    const branched: string[] = [];
    const commands = buildSessionActions(
      deps({ lastUserMessageId: null, onRewind: (id) => branched.push(id) }),
    );

    commands.find((command) => command.id === 'session-rewind')?.run();

    expect(branched).toEqual([]);
  });
});
