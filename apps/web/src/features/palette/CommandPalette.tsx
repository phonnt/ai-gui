import { Input } from '@ai-gui/ui';
import { useEffect, useMemo, useState } from 'react';
import { getTheme, nextTheme, setTheme } from '../../app/theme';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onTab: (tab: string) => void;
  onHome: () => void;
  onNewSession: () => void;
}

const TABS: { id: string; label: string }[] = [
  { id: 'chat', label: 'Go to Chat' },
  { id: 'explorer', label: 'Go to Explorer' },
  { id: 'editor', label: 'Go to Editor' },
  { id: 'terminal', label: 'Go to Terminal' },
  { id: 'notebook', label: 'Go to Notebook' },
  { id: 'todos', label: 'Go to Todos' },
  { id: 'artifacts', label: 'Go to Artifacts' },
  { id: 'lsp', label: 'Go to LSP' },
  { id: 'debug', label: 'Go to Debug' },
  { id: 'hub', label: 'Go to Hub' },
  { id: 'jobs', label: 'Go to Jobs' },
  { id: 'settings', label: 'Go to Settings' },
  { id: 'themes', label: 'Go to Themes' },
  { id: 'providers', label: 'Go to Providers' },
  { id: 'mcp', label: 'Go to MCP' },
  { id: 'knowledge', label: 'Go to Knowledge' },
];

export function CommandPalette({
  open,
  onClose,
  onTab,
  onHome,
  onNewSession,
}: CommandPaletteProps) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (open) setFilter('');
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...TABS.map((tab) => ({
        id: `tab-${tab.id}`,
        label: tab.label,
        run: () => onTab(tab.id),
      })),
      { id: 'new-session', label: 'New session', run: onNewSession },
      { id: 'home', label: 'Go home', run: onHome },
      {
        id: 'theme',
        label: `Theme: ${getTheme()} (toggle)`,
        hint: 'dark → light → system',
        run: () => setTheme(nextTheme(getTheme())),
      },
    ],
    [onTab, onHome, onNewSession],
  );

  const visible = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-24">
      <button
        type="button"
        aria-label="Close command palette"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label="Command palette"
        className="relative flex max-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg"
      >
        <div className="border-b border-[hsl(var(--border))] p-2">
          <Input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && visible[0]) {
                visible[0].run();
                onClose();
              }
            }}
            placeholder="Type a command… (Esc to close)"
            aria-label="Command filter"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1">
          {visible.length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
              No matching commands.
            </li>
          )}
          {visible.map((cmd) => (
            <li key={cmd.id}>
              <button
                type="button"
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))]"
              >
                <span>{cmd.label}</span>
                {cmd.hint && (
                  <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                    {cmd.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
