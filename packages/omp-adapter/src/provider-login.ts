import { InvalidRequestError, PathNotFoundError } from '@grove/agent-runtime';
import type { ModelRegistry } from '@oh-my-pi/pi-coding-agent/config/model-registry';
import type { AuthStorage } from '@oh-my-pi/pi-coding-agent/session/auth-storage';
import { type CatalogScope, oauthLoginProviderIds, registryBundle } from './settings-catalog.js';

/**
 * Provider OAuth login as a pollable attempt (TUI `/login`, web Providers pane).
 *
 * The flow itself is the SDK's: `AuthStorage.login(provider, ctrl)` runs it and
 * calls back for the authorization URL, progress lines, and any input it needs
 * (pasted code, workspace picker). A web client cannot answer a callback, so
 * each callback is turned into state a client can read and reply to: the attempt
 * lives here, `providerLoginState` is the read, `providerLoginInput` is the
 * reply. No credential material ever leaves this module — clients see the auth
 * URL, prompt text and status only.
 */

export type ProviderLoginStatus = 'running' | 'needs-input' | 'complete' | 'failed' | 'cancelled';

export interface ProviderLoginAuth {
  url: string;
  /** Loopback URL that 302s to `url`, when the flow hosts a callback server. */
  launchUrl?: string;
  instructions?: string;
}

export interface ProviderLoginPrompt {
  message: string;
  placeholder?: string;
}

export interface ProviderLoginIdentity {
  email?: string;
  accountId?: string;
  orgName?: string;
}

export interface ProviderLoginState {
  attemptId: string;
  providerId: string;
  status: ProviderLoginStatus;
  auth?: ProviderLoginAuth;
  prompt?: ProviderLoginPrompt;
  progress?: string;
  identity?: ProviderLoginIdentity;
  error?: string;
}

interface PendingInput {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface Attempt {
  state: ProviderLoginState;
  controller: AbortController;
  pending?: PendingInput;
  startedAt: number;
  /** Resolves when the attempt reaches a terminal status. */
  settled: Promise<void>;
  settle: () => void;
}

/**
 * An abandoned attempt must not hold a provider flow open forever, and a client
 * that lost its tab has no way to cancel one.
 */
const ATTEMPT_TTL_MS = 10 * 60_000;

const attempts = new Map<string, Attempt>();

function snapshot(attempt: Attempt): ProviderLoginState {
  return { ...attempt.state };
}

function finish(attempt: Attempt, state: ProviderLoginState): void {
  attempt.state = state;
  attempt.pending = undefined;
  attempt.settle();
}

function pruneExpired(now: number): void {
  for (const [id, attempt] of attempts) {
    if (now - attempt.startedAt < ATTEMPT_TTL_MS) continue;
    attempt.controller.abort();
    attempt.pending?.reject(new Error('login attempt expired'));
    finish(attempt, {
      ...attempt.state,
      status: 'failed',
      prompt: undefined,
      error: 'login attempt expired',
    });
    attempts.delete(id);
  }
}

function requireAttempt(attemptId: string): Attempt {
  pruneExpired(Date.now());
  const attempt = attempts.get(attemptId);
  if (!attempt) throw new PathNotFoundError(`unknown login attempt: ${attemptId}`);
  return attempt;
}

/** Stop a live attempt for one provider, resolving its waiters as cancelled. */
function cancelAttempt(attempt: Attempt, reason: string): void {
  if (attempt.state.status === 'complete' || attempt.state.status === 'cancelled') return;
  const pending = attempt.pending;
  finish(attempt, { ...attempt.state, status: 'cancelled', prompt: undefined, error: undefined });
  attempt.controller.abort();
  pending?.reject(new Error(reason));
}

export function providerLoginState(attemptId: string): ProviderLoginState {
  return snapshot(requireAttempt(attemptId));
}

/** Resolves when the attempt reaches a terminal status (complete/failed/cancelled). */
export async function providerLoginSettled(attemptId: string): Promise<ProviderLoginState> {
  const attempt = requireAttempt(attemptId);
  await attempt.settled;
  return snapshot(attempt);
}

export async function providerLoginStart(
  providerId: string,
  options?: Partial<CatalogScope>,
): Promise<ProviderLoginState> {
  pruneExpired(Date.now());
  if (!oauthLoginProviderIds().has(providerId)) {
    throw new InvalidRequestError(`provider ${providerId} does not support OAuth login`);
  }
  // One live attempt per provider: a second click replaces the first instead of
  // leaving two browser flows racing for the same credential row.
  for (const [id, existing] of attempts) {
    if (existing.state.providerId !== providerId) continue;
    cancelAttempt(existing, 'login restarted');
    attempts.delete(id);
  }

  // Resolve the registry before the attempt exists: a bundle failure must
  // reject the call, not leave an attempt stuck at `running`.
  const { registry, authStorage } = await registryBundle(options);
  const settled = Promise.withResolvers<void>();
  const attempt: Attempt = {
    state: { attemptId: crypto.randomUUID(), providerId, status: 'running' },
    controller: new AbortController(),
    startedAt: Date.now(),
    settled: settled.promise,
    settle: settled.resolve,
  };
  attempts.set(attempt.state.attemptId, attempt);
  void runLogin(attempt, registry, authStorage);
  return snapshot(attempt);
}

async function runLogin(
  attempt: Attempt,
  registry: ModelRegistry,
  authStorage: AuthStorage,
): Promise<void> {
  const providerId = attempt.state.providerId;
  try {
    const identity = await authStorage.login(providerId, {
      onAuth: (info) => {
        attempt.state = {
          ...attempt.state,
          status: 'running',
          auth: {
            url: info.url,
            ...(info.launchUrl ? { launchUrl: info.launchUrl } : {}),
            ...(info.instructions ? { instructions: info.instructions } : {}),
          },
        };
      },
      onProgress: (message) => {
        attempt.state = { ...attempt.state, progress: message };
      },
      // Providers that need the code pasted, a workspace chosen, or an
      // account confirmed all arrive here; answering is the client's job.
      onPrompt: (prompt) => {
        attempt.state = {
          ...attempt.state,
          status: 'needs-input',
          prompt: {
            message: prompt.message,
            ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
          },
        };
        const { promise, resolve, reject } = Promise.withResolvers<string>();
        const onAbort = (): void => reject(new Error('login cancelled'));
        attempt.controller.signal.addEventListener('abort', onAbort, { once: true });
        attempt.pending = {
          resolve: (value) => {
            attempt.controller.signal.removeEventListener('abort', onAbort);
            resolve(value);
          },
          reject: (error) => {
            attempt.controller.signal.removeEventListener('abort', onAbort);
            reject(error);
          },
        };
        return promise;
      },
      signal: attempt.controller.signal,
    });
    if (attempt.state.status === 'cancelled') return;
    attempt.state = {
      ...attempt.state,
      status: 'complete',
      prompt: undefined,
      identity: identity
        ? { email: identity.email, accountId: identity.accountId, orgName: identity.orgName }
        : undefined,
    };
    // Discovery needs the fresh credential; a failed refresh must not turn a
    // successful sign-in into a failure (offline machine, provider hiccup).
    try {
      await registry.refreshProvider(providerId, 'online');
    } catch (error) {
      attempt.state = {
        ...attempt.state,
        progress: `signed in; model discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } catch (error) {
    if (attempt.state.status === 'cancelled') return;
    attempt.state = {
      ...attempt.state,
      status: 'failed',
      prompt: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    finish(attempt, attempt.state);
  }
}

export async function providerLoginInput(
  attemptId: string,
  value: string,
): Promise<ProviderLoginState> {
  const attempt = requireAttempt(attemptId);
  const pending = attempt.pending;
  if (attempt.state.status !== 'needs-input' || !pending) {
    throw new InvalidRequestError(`login attempt ${attemptId} is not waiting for input`);
  }
  attempt.pending = undefined;
  attempt.state = { ...attempt.state, status: 'running', prompt: undefined };
  pending.resolve(value);
  return snapshot(attempt);
}

export function providerLoginCancel(attemptId: string): ProviderLoginState {
  const attempt = requireAttempt(attemptId);
  cancelAttempt(attempt, 'login cancelled');
  return snapshot(attempt);
}

export async function providerLogout(
  providerId: string,
  options?: Partial<CatalogScope>,
): Promise<void> {
  pruneExpired(Date.now());
  // A sign-in still waiting for input would otherwise write the credential back
  // right after the user logged out.
  for (const attempt of attempts.values()) {
    if (attempt.state.providerId === providerId) cancelAttempt(attempt, 'logged out');
  }
  const { authStorage } = await registryBundle(options);
  await authStorage.logout(providerId);
}
