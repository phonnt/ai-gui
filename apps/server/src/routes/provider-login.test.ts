import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerLoginSettled } from '@grove/omp-adapter';
import { registerOAuthProvider, unregisterOAuthProvider } from '@oh-my-pi/pi-ai/oauth';
import { getAgentDir, setAgentDir } from '@oh-my-pi/pi-utils/dirs';
import { errorToStatus, HttpError } from './errors.js';
import {
  cancelProviderLoginRoute,
  getProviderLoginRoute,
  logoutProviderRoute,
  startProviderLoginRoute,
  submitProviderLoginInputRoute,
} from './provider-login.js';

const PROVIDER = 'probe-route-oauth';

/**
 * The routes resolve their catalog scope from the process agent dir, which the
 * SDK freezes at import time — point it at a scratch dir so a sign-in here can
 * never touch the real credential store.
 */
const realAgentDir = getAgentDir();

/** Resolves when the provider's login asks for pasted input. */
let promptSignal: (() => void) | undefined;

function expectPrompt(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  promptSignal = resolve;
  return promise;
}

function registerProbeProvider(): void {
  registerOAuthProvider({
    id: PROVIDER,
    name: 'Probe Route OAuth',
    async login(callbacks) {
      callbacks.onAuth({ url: 'https://route-probe.test/authorize' });
      const asked = callbacks.onPrompt({ message: 'Paste the code' });
      const signal = promptSignal;
      promptSignal = undefined;
      signal?.();
      const code = await asked;
      return {
        refresh: 'refresh-token',
        access: `access-${code}`,
        expires: Date.now() + 3_600_000,
        email: 'route-probe@example.test',
      };
    },
  });
}

beforeAll(() => {
  setAgentDir(mkdtempSync(join(tmpdir(), 'grove-login-route-agent-')));
  registerProbeProvider();
});
afterAll(() => {
  unregisterOAuthProvider(PROVIDER);
  setAgentDir(realAgentDir);
});

describe('provider login routes', () => {
  test('start → needs-input → input completes the flow', async () => {
    const prompted = expectPrompt();
    const started = await startProviderLoginRoute(PROVIDER);
    expect(started.attempt.providerId).toBe(PROVIDER);

    await prompted;
    const waiting = await getProviderLoginRoute(started.attempt.attemptId);
    expect(waiting.attempt.status).toBe('needs-input');
    expect(waiting.attempt.prompt?.message).toBe('Paste the code');

    await submitProviderLoginInputRoute(started.attempt.attemptId, { value: 'code-1' });
    const done = await providerLoginSettled(started.attempt.attemptId);
    expect(done.status).toBe('complete');
    expect(done.identity?.email).toBe('route-probe@example.test');
  });

  test('unknown attempt is 404 and a bad body is 400', async () => {
    // Adapter errors bubble as typed errors; the server's classifier is what
    // turns them into statuses, so assert through it.
    const missing: unknown = await getProviderLoginRoute('nope').catch((error) => error);
    expect(errorToStatus(missing)).toBe(404);

    const bad: unknown = await submitProviderLoginInputRoute('nope', {}).catch((error) => error);
    expect(bad).toBeInstanceOf(HttpError);
    expect((bad as HttpError).status).toBe(400);

    const unknownCancel: unknown = await (async () => cancelProviderLoginRoute('nope'))().catch(
      (error) => error,
    );
    expect(errorToStatus(unknownCancel)).toBe(404);
  });

  test('a provider without OAuth login is 400 and cancel is reported', async () => {
    const refused: unknown = await startProviderLoginRoute('not-a-provider').catch(
      (error) => error,
    );
    expect(errorToStatus(refused)).toBe(400);

    const started = await startProviderLoginRoute(PROVIDER);
    expect(cancelProviderLoginRoute(started.attempt.attemptId).attempt.status).toBe('cancelled');
    expect((await providerLoginSettled(started.attempt.attemptId)).status).toBe('cancelled');
  });

  test('logout answers with the provider list that no longer has the credential', async () => {
    const prompted = expectPrompt();
    const started = await startProviderLoginRoute(PROVIDER);
    await prompted;
    await submitProviderLoginInputRoute(started.attempt.attemptId, { value: 'code-2' });
    await providerLoginSettled(started.attempt.attemptId);

    const body = await logoutProviderRoute(PROVIDER);
    const entry = body.providers.find((provider) => provider.id === PROVIDER);
    expect(entry?.auth).not.toBe('oauth');
    expect(entry?.login).toBe(true);
  });
});
