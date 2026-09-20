import type { ModelRoleEntry, ProviderAuth } from '@grove/omp-adapter';
import { modelRoleSet, modelRolesList, modelsList, providersList } from '@grove/omp-adapter';
import { ModelRoleUpdateSchema } from '@grove/protocol';
import { HttpError } from './errors.js';

/** GET /api/models → { models }. */
export async function listModelsRoute(): Promise<{
  models: { id: string; provider: string; available: boolean; source: string }[];
}> {
  return { models: await modelsList() };
}

/** GET /api/providers → { providers }. */
export async function listProvidersRoute(): Promise<{
  providers: { id: string; available: boolean; auth: ProviderAuth }[];
}> {
  return { providers: await providersList() };
}

/** GET /api/model-roles → { roles }. */
export async function listModelRolesRoute(): Promise<{ roles: ModelRoleEntry[] }> {
  return { roles: await modelRolesList() };
}

/** PUT /api/model-roles/:role { model } → { roles } (empty model clears it). */
export async function setModelRoleRoute(
  role: string,
  body: unknown,
): Promise<{ roles: ModelRoleEntry[] }> {
  const parsed = ModelRoleUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  return { roles: await modelRoleSet(decodeURIComponent(role), parsed.data.model) };
}
