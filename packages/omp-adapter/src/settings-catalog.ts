import { getAgentDir } from '@oh-my-pi/pi-coding-agent';
import { ModelRegistry } from '@oh-my-pi/pi-coding-agent/config/model-registry';
import { getKnownRoleIds, getRoleInfo } from '@oh-my-pi/pi-coding-agent/config/model-roles';
import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import { discoverAuthStorage } from '@oh-my-pi/pi-coding-agent/sdk';
import type { AuthStorage } from '@oh-my-pi/pi-coding-agent/session/auth-storage';
import { liveSettings } from './settings.js';

/**
 * P4 catalog plane (SDK-direct, out-of-turn): model catalog + provider status.
 *
 * One `ModelRegistry` per cwd, backed by the real `AuthStorage`
 * (`discoverAuthStorage`). Availability follows the registry's own predicate:
 * `hasConcreteAuth` (stored login, config/runtime key, or keyless local
 * endpoint — never ambient AWS/Vertex sentinels). Auth kinds are presence
 * only (`hasOAuth` / credential-origin classification) — key material is
 * never read.
 */

export interface CatalogScope {
  cwd: string;
  agentDir?: string;
}

export interface ModelEntry {
  id: string;
  provider: string;
  available: boolean;
  source: string;
}

/** One configured model role and the model it resolves to. */
export interface ModelRoleEntry {
  role: string;
  /** Display name (configured tag or built-in name). */
  name: string;
  /** Assigned model id, when the role is bound. */
  model: string | null;
}

export type ProviderAuth = 'key' | 'oauth' | 'keyless' | 'none';

export interface ProviderEntry {
  id: string;
  available: boolean;
  auth: ProviderAuth;
}

interface RegistryBundle {
  registry: ModelRegistry;
  authStorage: AuthStorage;
}

const bundles = new Map<string, Promise<RegistryBundle>>();

function scopeKey(scope: Required<CatalogScope>): string {
  return `${scope.cwd}	${scope.agentDir}`;
}

export function catalogScopeOf(options?: Partial<CatalogScope>): Required<CatalogScope> {
  return {
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? getAgentDir(),
  };
}

export function registryBundle(options?: Partial<CatalogScope>): Promise<RegistryBundle> {
  const scope = catalogScopeOf(options);
  const key = scopeKey(scope);
  let bundle = bundles.get(key);
  if (!bundle) {
    bundle = (async (): Promise<RegistryBundle> => {
      const settings = await Settings.loadIsolated({ cwd: scope.cwd, agentDir: scope.agentDir });
      const authStorage = await discoverAuthStorage(scope.agentDir);
      const registry = new ModelRegistry(authStorage, undefined, { settings });
      return { registry, authStorage };
    })();
    bundles.set(key, bundle);
  }
  return bundle;
}

/** Test-only: drop cached registries so credential/process state never leaks between runs. */
export function resetCatalogForTest(): void {
  bundles.clear();
}

/** Presence-only auth classification — never reads key material. */
export function classifyProviderAuth(
  registry: ModelRegistry,
  authStorage: AuthStorage,
  provider: string,
): ProviderAuth {
  if (authStorage.hasOAuth(provider)) return 'oauth';
  const origin = authStorage.getCredentialOrigin(provider);
  if (
    registry.hasCommandBackedApiKey(provider) ||
    (origin !== undefined &&
      (origin.kind === 'runtime' ||
        origin.kind === 'config' ||
        origin.kind === 'api_key' ||
        origin.kind === 'env' ||
        origin.kind === 'fallback'))
  ) {
    return 'key';
  }
  if (registry.hasConcreteAuth(provider)) return 'keyless';
  return 'none';
}

/** Full bundled + configured catalog; `source` is the model's upstream API family. */
export async function modelsList(options?: Partial<CatalogScope>): Promise<ModelEntry[]> {
  const { registry } = await registryBundle(options);
  return registry.getAll().map((model) => ({
    id: model.id,
    provider: model.provider,
    available: registry.hasConcreteAuth(model.provider),
    source: model.api,
  }));
}

/** Unique providers across the catalog + dynamic discovery configs. */
export async function providersList(options?: Partial<CatalogScope>): Promise<ProviderEntry[]> {
  const { registry, authStorage } = await registryBundle(options);
  const ids = new Set<string>();
  for (const model of registry.getAll()) ids.add(model.provider);
  for (const provider of registry.getDiscoverableProviders()) ids.add(provider);
  return [...ids]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      available: registry.hasConcreteAuth(id),
      auth: classifyProviderAuth(registry, authStorage, id),
    }));
}

/**
 * Model roles (`modelRoles`) with their display names — the TUI's
 * `@role` routing table. Roles without an assignment resolve through the
 * resolver's fallback chain, so `model` is null here.
 */
export async function modelRolesList(options?: Partial<CatalogScope>): Promise<ModelRoleEntry[]> {
  const { cwd, agentDir } = catalogScopeOf(options);
  const settings = await Settings.loadIsolated({ cwd, agentDir });
  const roles = getKnownRoleIds(settings);
  const assignments = settings.getModelRoles();
  return roles.map((role) => {
    const info = getRoleInfo(role, settings);
    const assigned = assignments[role];
    return {
      role,
      name: info.name,
      model: typeof assigned === 'string' && assigned ? assigned : null,
    };
  });
}

/** Bind a role to a model id (empty string clears the assignment). */
export async function modelRoleSet(
  role: string,
  modelId: string,
  options?: Partial<CatalogScope>,
): Promise<ModelRoleEntry[]> {
  const { cwd, agentDir } = catalogScopeOf(options);
  const settings = await liveSettings({ cwd, agentDir });
  settings.setModelRole(role, modelId === '' ? undefined : modelId);
  await settings.flush();
  return modelRolesList(options);
}
