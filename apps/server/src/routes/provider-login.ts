import type { ProviderEntry, ProviderLoginState } from '@grove/omp-adapter';
import {
  providerLoginCancel,
  providerLoginInput,
  providerLoginStart,
  providerLoginState,
  providerLogout,
  providersList,
} from '@grove/omp-adapter';
import { ProviderLoginInputSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/**
 * Provider OAuth login over HTTP: the gateway runs the flow (the SDK's
 * `AuthStorage.login`) and the client polls the attempt, answers its prompts,
 * and can cancel it. Credential material stays inside the adapter.
 */

/** POST /api/providers/:id/login → { attempt }. */
export async function startProviderLoginRoute(
  providerId: string,
): Promise<{ attempt: ProviderLoginState }> {
  return { attempt: await providerLoginStart(decodeURIComponent(providerId)) };
}

/** GET /api/providers/logins/:attemptId → { attempt }. */
export async function getProviderLoginRoute(
  attemptId: string,
): Promise<{ attempt: ProviderLoginState }> {
  return { attempt: providerLoginState(decodeURIComponent(attemptId)) };
}

/** POST /api/providers/logins/:attemptId/input { value } → { attempt }. */
export async function submitProviderLoginInputRoute(
  attemptId: string,
  body: unknown,
): Promise<{ attempt: ProviderLoginState }> {
  const parsed = ProviderLoginInputSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return { attempt: await providerLoginInput(decodeURIComponent(attemptId), parsed.data.value) };
}

/** POST /api/providers/logins/:attemptId/cancel → { attempt }. */
export function cancelProviderLoginRoute(attemptId: string): { attempt: ProviderLoginState } {
  return { attempt: providerLoginCancel(decodeURIComponent(attemptId)) };
}

/** DELETE /api/providers/:id → { providers } after the sign-out. */
export async function logoutProviderRoute(
  providerId: string,
): Promise<{ providers: ProviderEntry[] }> {
  await providerLogout(decodeURIComponent(providerId));
  return { providers: await providersList() };
}
