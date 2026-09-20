import { create } from 'zustand';

interface SessionStore {
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  /** Prompt typed on the landing page, consumed once by ChatPage on mount. */
  pendingPrompt: string | null;
  setPendingPrompt: (text: string | null) => void;
  /** Pinned session ids (localStorage, newest-first). */
  pins: string[];
  togglePin: (id: string) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** Foreign-session import dialog (sidebar button + `/resume @codex`). */
  importSource: 'claude' | 'codex' | null;
  openImport: (source: 'claude' | 'codex') => void;
  closeImport: () => void;
  lastCwd: string;
  setLastCwd: (cwd: string) => void;
}

const PINS_KEY = 'grove-pins';

function loadPins(): string[] {
  try {
    const raw = window.localStorage.getItem(PINS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export const useSessionStore = create<SessionStore>()((set) => ({
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  pendingPrompt: null,
  setPendingPrompt: (text) => set({ pendingPrompt: text }),
  pins: loadPins(),
  togglePin: (id) =>
    set((s) => {
      const pins = s.pins.includes(id) ? s.pins.filter((p) => p !== id) : [id, ...s.pins];
      try {
        window.localStorage.setItem(PINS_KEY, JSON.stringify(pins));
      } catch {
        /* private mode: pins stay in memory */
      }
      return { pins };
    }),
  importSource: null,
  openImport: (source) => set({ importSource: source }),
  closeImport: () => set({ importSource: null }),
  sidebarOpen: window.localStorage.getItem('grove-sidebar') !== 'closed',
  toggleSidebar: () =>
    set((s) => {
      const open = !s.sidebarOpen;
      try {
        window.localStorage.setItem('grove-sidebar', open ? 'open' : 'closed');
      } catch {
        /* ignore */
      }
      return { sidebarOpen: open };
    }),
  lastCwd: (() => {
    try {
      return window.localStorage.getItem('grove-cwd') ?? '';
    } catch {
      return '';
    }
  })(),
  setLastCwd: (cwd: string) => {
    try {
      window.localStorage.setItem('grove-cwd', cwd);
    } catch {
      /* ignore */
    }
    set({ lastCwd: cwd });
  },
}));
