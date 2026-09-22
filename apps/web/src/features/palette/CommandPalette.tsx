import { Button, Dialog, Input, useEscapeToClose } from '@grove/ui';
import { X } from 'lucide-react';
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
  /** Session-scoped actions; omitted when no session is open. */
  sessionActions?: PaletteCommand[];
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
  sessionActions,
}: CommandPaletteProps) {
  const [filter, setFilter] = useState('');
  const [themeName, setThemeName] = useState(() => getTheme());
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setFilter('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...(sessionActions ?? []),
      ...TABS.map((tab) => ({
        id: `tab-${tab.id}`,
        label: tab.label,
        run: () => onTab(tab.id),
      })),
      { id: 'new-session', label: 'New session', run: onNewSession },
      { id: 'home', label: 'Go home', run: onHome },
      {
        id: 'theme',
        label: `Theme: ${themeName} (toggle)`,
        hint: 'dark → light → system',
        run: () => {
          const next = nextTheme(getTheme());
          setTheme(next);
          setThemeName(next);
        },
      },
    ],
    [onTab, onHome, onNewSession, themeName, sessionActions],
  );

  const visible = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const clamped = visible.length === 0 ? 0 : Math.min(active, visible.length - 1);
  const runActive = (index: number) => {
    const cmd = visible[index];
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  if (!open) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      label="Command palette"
      align="top"
      className="h-auto max-h-[60vh] w-full max-w-md flex-col"
    >
      <div className="flex items-center gap-1 hairline-b p-2">
        <Input
          autoFocus
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(0, visible.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              runActive(clamped);
            }
          }}
          placeholder="Type a command… (Esc to close)"
          aria-label="Command filter"
          role="combobox"
          aria-expanded={visible.length > 0}
          aria-controls="palette-listbox"
          aria-activedescendant={visible[clamped] ? `palette-${visible[clamped]?.id}` : undefined}
        />
        <Button variant="ghost" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      <div
        id="palette-listbox"
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto scroll-area p-1"
      >
        {visible.length === 0 && (
          <div className="px-2 py-3 text-center text-small text-muted-foreground">
            No matching commands.
          </div>
        )}
        {visible.map((cmd, i) => (
          <div
            key={cmd.id}
            id={`palette-${cmd.id}`}
            role="option"
            aria-selected={i === clamped}
            tabIndex={-1}
          >
            <button
              type="button"
              onClick={() => {
                cmd.run();
                onClose();
              }}
              onMouseMove={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-body hover:bg-accent ${
                i === clamped ? 'bg-accent' : ''
              }`}
            >
              <span>{cmd.label}</span>
              {cmd.hint && <span className="text-meta text-muted-foreground">{cmd.hint}</span>}
            </button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
