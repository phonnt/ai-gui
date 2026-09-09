import { Button } from '@ai-gui/ui';
import { SendHorizontal, Square, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SlashCommand } from '../../lib/api-client/rest';
import { ModelPicker } from '../model/ModelPicker';

interface ComposerProps {
  sessionId: string;
  streaming: boolean;
  sending: boolean;
  commands: SlashCommand[];
  onSend: (text: string) => void;
  onAbort: () => void;
  onManageProviders: () => void;
}

function slashPrefix(text: string): string | null {
  if (!text.startsWith('/')) return null;
  const space = text.indexOf(' ');
  const query = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase();
  if (!/^[a-z0-9:_-]*$/.test(query)) return null;
  return query;
}
export function Composer({
  sessionId,
  streaming,
  sending,
  commands,
  onSend,
  onAbort,
  onManageProviders,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);

  const query = slashPrefix(text);
  const matches = useMemo(() => {
    if (query === null) return [];
    const starts = commands.filter((c) => c.name.startsWith(query));
    const contains = commands.filter((c) => !c.name.startsWith(query) && c.name.includes(query));
    return [...starts, ...contains].slice(0, 8);
  }, [commands, query]);
  const open = query !== null && matches.length > 0;
  const clamped = active >= matches.length ? 0 : active;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setText('');
    onSend(trimmed);
  };

  const complete = (name: string) => {
    setText(`/${name} `);
    setActive(0);
  };

  return (
    <div className="bg-transparent p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[0_8px_24px_hsl(var(--foreground)/0.08)]">
        {open && (
          <ul
            aria-label="Slash commands"
            className="max-h-48 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]"
          >
            {matches.map((cmd, i) => (
              <li key={cmd.name}>
                <button
                  type="button"
                  onClick={() => complete(cmd.name)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-[13px] ${
                    i === clamped ? 'bg-[hsl(var(--accent))]' : ''
                  }`}
                >
                  <span className="font-mono font-medium">/{cmd.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {cmd.hint ?? cmd.description}
                  </span>
                  {cmd.localOnly && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      local
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-start gap-2 px-1 pt-1">
          <WandSparkles className="mt-2 size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                setActive((a) =>
                  e.key === 'ArrowDown'
                    ? (a + 1) % matches.length
                    : (a - 1 + matches.length) % matches.length,
                );
                return;
              }
              if (open && e.key === 'Tab' && matches[clamped]) {
                e.preventDefault();
                complete(matches[clamped].name);
                return;
              }
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                setText('');
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Ask anything or write your request…"
            className="min-h-11 flex-1 resize-none bg-transparent py-1.5 text-[13px] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex min-w-0 items-center gap-1">
            <ModelPicker sessionId={sessionId} dropUp onManageProviders={onManageProviders} />
          </div>
          {streaming ? (
            <Button variant="destructive" onClick={onAbort} title="Abort current turn">
              <Square />
              Abort
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={!text.trim() || sending}
              title="Send prompt"
              aria-label="Send prompt"
              className="bg-[hsl(var(--primary)/0.3)] hover:bg-[hsl(var(--primary)/0.45)]"
            >
              <SendHorizontal />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
