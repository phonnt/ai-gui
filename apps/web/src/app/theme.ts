export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'ai-gui-theme';

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getTheme(): ThemeMode {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

export function applyTheme(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(mode: ThemeMode): void {
  window.localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

/** Apply stored theme + follow OS changes while in system mode. */
export function initTheme(): void {
  applyTheme(getTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') applyTheme('system');
  });
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
}
