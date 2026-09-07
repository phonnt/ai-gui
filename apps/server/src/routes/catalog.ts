import type { ProviderAuth } from '@ai-gui/omp-adapter';
import { modelsList, providersList } from '@ai-gui/omp-adapter';

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
