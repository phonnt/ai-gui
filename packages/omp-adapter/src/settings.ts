import { getAgentDir } from '@oh-my-pi/pi-coding-agent';
import { Settings } from '@oh-my-pi/pi-coding-agent/config/settings';
import {
  getDefault,
  isCredential,
  SETTINGS_SCHEMA,
  type SettingPath,
} from '@oh-my-pi/pi-coding-agent/config/settings-schema';
import {
  getAvailableThemes,
  getCurrentThemeName,
  setTheme,
} from '@oh-my-pi/pi-coding-agent/modes/theme/theme';

/**
 * P4 settings plane (SDK-direct, out-of-turn).
 *
 * Effective scope is the server process cwd: every op loads an isolated
 * `Settings` for that cwd (`Settings.loadIsolated`), so global
 * (`~/.omp/config`) + project (cwd-local) layers merge exactly as the SDK
 * resolves them. Per-session cwd scoping is deferred — these routes carry no
 * session context, and `loadIsolated({ cwd })` already scopes per cwd, so a
 * future session-scoped variant only needs to thread the session cwd through.
 *
 * Writes persist to the user (global) config via `set` + `flush`, mirroring
 * the SDK `config set`/`config reset` CLI handlers.
 */

export interface SettingsScope {
  cwd: string;
  agentDir?: string;
}

export interface SettingEntry {
  key: string;
  group: string;
  value?: unknown;
  masked: boolean;
}

function scopeOf(options?: Partial<SettingsScope>): Required<SettingsScope> {
  return {
    cwd: options?.cwd ?? process.cwd(),
    agentDir: options?.agentDir ?? getAgentDir(),
  };
}

async function loadSettings(options?: Partial<SettingsScope>): Promise<Settings> {
  const scope = scopeOf(options);
  return Settings.loadIsolated({ cwd: scope.cwd, agentDir: scope.agentDir });
}

/** Credential-ish keys never leave the server: schema credential flag or key/token/secret/auth substrings. */
export function isMaskedSetting(key: string): boolean {
  if (/key|token|secret|auth/i.test(key)) return true;
  try {
    return isCredential(key as SettingPath);
  } catch {
    return false;
  }
}

export function isSettingPath(key: string): key is SettingPath {
  return key in SETTINGS_SCHEMA;
}

function groupOf(key: SettingPath): string {
  const def = SETTINGS_SCHEMA[key] as { ui?: { group?: string; tab?: string } };
  return def.ui?.group ?? def.ui?.tab ?? 'general';
}

function toEntry(settings: Settings, key: SettingPath): SettingEntry {
  const masked = isMaskedSetting(key);
  if (masked) return { key, group: groupOf(key), masked: true };
  return { key, group: groupOf(key), value: settings.get(key), masked: false };
}

/** Every known setting with its effective (global+project merged) value; secrets omitted. */
export async function settingsList(options?: Partial<SettingsScope>): Promise<SettingEntry[]> {
  const settings = await loadSettings(options);
  return (Object.keys(SETTINGS_SCHEMA) as SettingPath[]).map((key) => toEntry(settings, key));
}

/** Effective value for one key; secrets omitted. Throws `unknown setting: <key>` for bad keys. */
export async function settingsGet(
  key: string,
  options?: Partial<SettingsScope>,
): Promise<SettingEntry> {
  if (!isSettingPath(key)) throw new Error(`unknown setting: ${key}`);
  const settings = await loadSettings(options);
  return toEntry(settings, key);
}

/**
 * Persist `value` to the user (global) config. Returns the effective value
 * (omitted for credential-ish keys). Throws `unknown setting: <key>`.
 */
export async function settingsSet(
  key: string,
  value: unknown,
  options?: Partial<SettingsScope>,
): Promise<{ entry: SettingEntry; scope: 'global' }> {
  if (!isSettingPath(key)) throw new Error(`unknown setting: ${key}`);
  const settings = await loadSettings(options);
  settings.set(key, value as never);
  await settings.flush();
  return { entry: toEntry(settings, key), scope: 'global' };
}

/**
 * Reset a key to its schema default (SDK `config reset` semantics: set to
 * `getDefault` + flush to global config). Throws `unknown setting: <key>`.
 */
export async function settingsReset(
  key: string,
  options?: Partial<SettingsScope>,
): Promise<{ entry: SettingEntry; scope: 'global'; reset: true }> {
  if (!isSettingPath(key)) throw new Error(`unknown setting: ${key}`);
  const settings = await loadSettings(options);
  settings.set(key, getDefault(key) as never);
  await settings.flush();
  return { entry: toEntry(settings, key), scope: 'global', reset: true as const };
}

export interface ThemeInfo {
  name: string;
}

/** Built-in + custom themes via the SDK loader; current falls back to the `theme.dark` setting headless. */
export async function themesList(
  options?: Partial<SettingsScope>,
): Promise<{ themes: ThemeInfo[]; current: string }> {
  const settings = await loadSettings(options);
  const names = await getAvailableThemes();
  const current = getCurrentThemeName() ?? (settings.get('theme.dark') as string);
  return { themes: names.map((name) => ({ name })), current };
}

/**
 * Apply a theme: real SDK `setTheme` (loads + activates) persisted through
 * the `theme.dark` setting to global config. Throws `unknown theme: <name>`.
 */
export async function themesApply(
  name: string,
  options?: Partial<SettingsScope>,
): Promise<{ current: string; scope: 'global' }> {
  const names = await getAvailableThemes();
  if (!names.includes(name)) throw new Error(`unknown theme: ${name}`);
  const applied = await setTheme(name);
  if (!applied.success) throw new Error(applied.error ?? `failed to apply theme: ${name}`);
  const settings = await loadSettings(options);
  settings.set('theme.dark', name);
  await settings.flush();
  return { current: getCurrentThemeName() ?? name, scope: 'global' };
}
