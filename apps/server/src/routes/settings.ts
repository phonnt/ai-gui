import {
  isSettingPath,
  type SettingEntry,
  settingsGet,
  settingsList,
  settingsReset,
  settingsSet,
  themesApply,
  themesList,
} from '@ai-gui/omp-adapter';
import { SettingResponseSchema, SettingUpdateSchema, ThemeApplySchema } from '@ai-gui/protocol';
import { HttpError } from './errors.js';

function toSettingResponse(entry: SettingEntry): {
  key: string;
  value?: unknown;
  masked?: boolean;
} {
  if (entry.masked) return { key: entry.key, masked: true };
  return { key: entry.key, value: entry.value };
}

/** GET /api/settings → { entries }. */
export async function listSettingsRoute(): Promise<{
  entries: { key: string; group: string; value?: unknown; masked: boolean }[];
}> {
  return { entries: await settingsList() };
}

/** GET /api/settings/:key → { key, value }. */
export async function getSettingRoute(
  key: string,
): Promise<{ key: string; value?: unknown; masked?: boolean }> {
  const name = decodeURIComponent(key);
  if (!isSettingPath(name)) throw new HttpError(404, `unknown setting: ${name}`);
  const parsed = SettingResponseSchema.safeParse(toSettingResponse(await settingsGet(name)));
  if (!parsed.success) throw new HttpError(500, parsed.error.message);
  return parsed.data;
}

/** PUT /api/settings/:key { value } → { key, value }. */
export async function setSettingRoute(
  key: string,
  body: unknown,
): Promise<{ key: string; value?: unknown; masked?: boolean }> {
  const name = decodeURIComponent(key);
  if (!isSettingPath(name)) throw new HttpError(404, `unknown setting: ${name}`);
  const parsedBody = SettingUpdateSchema.safeParse(body ?? {});
  if (!parsedBody.success) throw new HttpError(400, parsedBody.error.message);
  let entry: SettingEntry;
  try {
    entry = (await settingsSet(name, parsedBody.data.value)).entry;
  } catch (err) {
    throw new HttpError(500, err instanceof Error ? err.message : String(err));
  }
  const parsed = SettingResponseSchema.safeParse(toSettingResponse(entry));
  if (!parsed.success) throw new HttpError(500, parsed.error.message);
  return parsed.data;
}

/** DELETE /api/settings/:key → { key, value, reset: true }. */
export async function resetSettingRoute(
  key: string,
): Promise<{ key: string; value?: unknown; masked?: boolean; reset: true }> {
  const name = decodeURIComponent(key);
  if (!isSettingPath(name)) throw new HttpError(404, `unknown setting: ${name}`);
  const { entry } = await settingsReset(name);
  return { ...toSettingResponse(entry), reset: true as const };
}

/** GET /api/themes → { themes, current }. */
export async function listThemesRoute(): Promise<{ themes: { name: string }[]; current: string }> {
  return themesList();
}

/** POST /api/themes/apply { name } → { current }. */
export async function applyThemeRoute(body: unknown): Promise<{ current: string }> {
  const parsed = ThemeApplySchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.message);
  try {
    const { current } = await themesApply(parsed.data.name);
    return { current };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('unknown theme:')) throw new HttpError(404, message);
    throw new HttpError(500, message);
  }
}
