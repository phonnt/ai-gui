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
}

const PINS_KEY = 'ai-gui-pins';

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
  sidebarOpen: window.localStorage.getItem('ai-gui-sidebar') !== 'closed',
  toggleSidebar: () =>
    set((s) => {
      const open = !s.sidebarOpen;
      try {
        window.localStorage.setItem('ai-gui-sidebar', open ? 'open' : 'closed');
      } catch {
        /* ignore */
      }
      return { sidebarOpen: open };
    }),
}));
