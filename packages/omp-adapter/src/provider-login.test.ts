import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOAuthProvider, unregisterOAuthProvider } from '@oh-my-pi/pi-ai/oauth';
import {
  providerLoginCancel,
  providerLoginInput,
  providerLoginSettled,
  providerLoginStart,
  providerLoginState,
  providerLogout,
} from './provider-login.js';
import { type CatalogScope, providersList } from './settings-catalog.js';

const PROVIDER = 'probe-oauth';

/**
 * Set by `expectPrompt()` before a login starts and consumed by the next
 * `login()` call, so a test waits on the flow itself rather than on a clock.
 */
let promptSignal: (() => void) | undefined;

/** Resolves once the provider's login has asked the adapter for pasted input. */
function expectPrompt(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  promptSignal = resolve;
  return promise;
}

/**
 * Stands in for a real provider: hands out an auth URL, then waits for the
 * pasted code before minting credentials — the two-step shape every OAuth
 * provider in the registry uses.
 */
function registerProbeProvider(): void {
  registerOAuthProvider({
    id: PROVIDER,
    name: 'Probe OAuth',
    async login(callbacks) {
      callbacks.onAuth({ url: 'https://probe.test/authorize?state=abc' });
      callbacks.onProgress?.('waiting for the pasted code');
      const asked = callbacks.onPrompt({ message: 'Paste the code' });
      const signal = promptSignal;
      promptSignal = undefined;
      signal?.();
      const code = await asked;
      return {
        refresh: 'refresh-token',
        access: `access-${code}`,
        expires: Date.now() + 3_600_000,
        email: 'probe@example.test',
      };
    },
  });
}

/**
 * Each test gets its own scope: the SDK resolves its agent dir once per process,
 * so an isolated credential store has to come from an explicit `agentDir`, not
 * from the environment.
 */
function freshScope(): Required<CatalogScope> {
  return {
    cwd: mkdtempSync(join(tmpdir(), 'grove-login-cwd-')),
    agentDir: mkdtempSync(join(tmpdir(), 'grove-login-agent-')),
  };
}

async function authOf(
  scope: Required<CatalogScope>,
  providerId: string,
): Promise<string | undefined> {
  return (await providersList(scope)).find((provider) => provider.id === providerId)?.auth;
}

beforeAll(registerProbeProvider);
afterAll(() => unregisterOAuthProvider(PROVIDER));

describe('provider login attempts', () => {
  test('surfaces the auth URL, then the prompt, then the stored credential', async () => {
    const scope = freshScope();
    const prompted = expectPrompt();
    const started = await providerLoginStart(PROVIDER, scope);
    expect(started.providerId).toBe(PROVIDER);

    await prompted;
    const waiting = providerLoginState(started.attemptId);
    expect(waiting.status).toBe('needs-input');
    expect(waiting.auth?.url).toContain('probe.test');
    expect(waiting.prompt?.message).toBe('Paste the code');
    expect(waiting.progress).toBe('waiting for the pasted code');

    await providerLoginInput(started.attemptId, 'xyz');
    const done = await providerLoginSettled(started.attemptId);
    expect(done.status).toBe('complete');
    expect(done.identity?.email).toBe('probe@example.test');
    expect(done.prompt).toBeUndefined();

    expect(await authOf(scope, PROVIDER)).toBe('oauth');
    const entry = (await providersList(scope)).find((provider) => provider.id === PROVIDER);
    expect(entry?.login).toBe(true);
  });

  test('cancelling mid-flow settles without storing a credential', async () => {
    const scope = freshScope();
    const prompted = expectPrompt();
    const started = await providerLoginStart(PROVIDER, scope);
    await prompted;

    expect(providerLoginCancel(started.attemptId).status).toBe('cancelled');
    // Settled proves the aborted flow finished; a credential written after the
    // cancel would show up in the provider list below.
    expect((await providerLoginSettled(started.attemptId)).status).toBe('cancelled');
    expect(await authOf(scope, PROVIDER)).not.toBe('oauth');
  });

  test('logout drops the stored credential and settles a live attempt', async () => {
    const scope = freshScope();
    const firstPrompt = expectPrompt();
    const first = await providerLoginStart(PROVIDER, scope);
    await firstPrompt;
    await providerLoginInput(first.attemptId, 'xyz');
    await providerLoginSettled(first.attemptId);
    expect(await authOf(scope, PROVIDER)).toBe('oauth');

    // A second sign-in is still waiting for its code when the user logs out.
    const secondPrompt = expectPrompt();
    const second = await providerLoginStart(PROVIDER, scope);
    await secondPrompt;
    await providerLogout(PROVIDER, scope);

    expect((await providerLoginSettled(second.attemptId)).status).toBe('cancelled');
    expect(await authOf(scope, PROVIDER)).not.toBe('oauth');
  });

  test('an unknown provider and an unknown attempt are request errors', async () => {
    const scope = freshScope();
    await expect(providerLoginStart('not-a-provider', scope)).rejects.toThrow();

    const started = await providerLoginStart(PROVIDER, scope);
    expect(() => providerLoginState('does-not-exist')).toThrow();
    expect(() => providerLoginCancel('does-not-exist')).toThrow();
    await expect(providerLoginInput('does-not-exist', 'code')).rejects.toThrow();
    providerLoginCancel(started.attemptId);
    await providerLoginSettled(started.attemptId);
  });
});
