import { Button } from '@ai-gui/ui';
import {
  Image as ImageIcon,
  ListPlus,
  Paperclip,
  SendHorizontal,
  Square,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PromptImage, SlashCommand } from '../../lib/api-client/rest';
import { ModelPicker } from '../model/ModelPicker';

interface ComposerProps {
  sessionId: string;
  streaming: boolean;
  sending: boolean;
  commands: SlashCommand[];
  /** Enter sends as steer; Ctrl+Enter queues a follow-up (TUI parity). */
  onSend: (text: string, behavior?: 'steer' | 'followUp', images?: PromptImage[]) => void;
  onAbort: () => void;
  onManageProviders: () => void;
  /** One-shot branch-point text applied to the editor (TUI rewind draft). */
  draft?: string | null;
  onDraftConsumed?: () => void;
}

const MAX_IMAGES = 8;

/** Attachment with a stable id so React keys survive removals. */
interface Attachment extends PromptImage {
  id: string;
}

/** Base64 payload without the `data:` prefix (wire format). */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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
  draft,
  onDraftConsumed,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [images, setImages] = useState<Attachment[]>([]);

  // Branch-point text lands in the editor without sending (TUI rewind draft).
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot apply on draft arrival
  useEffect(() => {
    if (draft) {
      setText(draft);
      onDraftConsumed?.();
    }
  }, [draft]);

  const query = slashPrefix(text);
  const matches = useMemo(() => {
    if (query === null) return [];
    const starts = commands.filter((c) => c.name.startsWith(query));
    const contains = commands.filter((c) => !c.name.startsWith(query) && c.name.includes(query));
    return [...starts, ...contains].slice(0, 8);
  }, [commands, query]);
  const open = query !== null && matches.length > 0;
  const clamped = active >= matches.length ? 0 : active;

  const submit = (behavior?: 'steer' | 'followUp') => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || sending) return;
    setText('');
    const attached = images;
    setImages([]);
    // Image-only prompts still need text for the transcript label.
    onSend(
      trimmed || '(image)',
      behavior,
      attached.length > 0 ? attached.map(({ data, mimeType }) => ({ data, mimeType })) : undefined,
    );
  };

  /** Read a pasted/dropped/picked file into a base64 attachment. */
  const attach = async (files: FileList | File[] | null) => {
    if (!files) return;
    const picked = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, MAX_IMAGES);
    if (picked.length === 0) return;
    const encoded = await Promise.all(
      picked.map(async (file, i) => ({
        id: `${Date.now()}-${i}-${file.name}`,
        data: await fileToBase64(file),
        mimeType: file.type,
      })),
    );
    setImages((prev) => [...prev, ...encoded].slice(0, MAX_IMAGES));
  };

  const complete = (name: string) => {
    setText(`/${name} `);
    setActive(0);
  };

  return (
    <div className="bg-transparent p-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[0_8px_24px_hsl(var(--foreground)/0.08)]">
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
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.some((file) => file.type.startsWith('image/'))) {
                e.preventDefault();
                void attach(files);
              }
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
              if (e.key === 'Escape') {
                // TUI parity: Esc is the abort gesture, never a draft wipe.
                e.preventDefault();
                if (streaming) onAbort();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // Ctrl/Cmd+Enter queues a follow-up; plain Enter steers.
                submit(e.ctrlKey || e.metaKey ? 'followUp' : 'steer');
              }
            }}
            rows={2}
            placeholder="Ask anything or write your request…"
            className="min-h-11 flex-1 resize-none bg-transparent py-1.5 text-[13px] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none"
          />
        </div>
        {images.length > 0 && (
          <ul className="flex flex-wrap gap-1 px-1" aria-label="Attached images">
            {images.map((image) => (
              <li
                key={image.id}
                className="flex items-center gap-1 rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--muted-foreground))]"
              >
                <ImageIcon className="size-3" />
                {image.mimeType.replace('image/', '')}
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => prev.filter((candidate) => candidate.id !== image.id))
                  }
                  aria-label="Remove attachment"
                  className="hover:text-[hsl(var(--foreground))]"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex min-w-0 items-center gap-1">
            <ModelPicker sessionId={sessionId} dropUp onManageProviders={onManageProviders} />
            <label
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              title="Attach images (or paste/drop them)"
            >
              <Paperclip className="size-3.5" />
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                aria-label="Attach images"
                onChange={(e) => {
                  void attach(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden font-mono text-[11px] text-[hsl(var(--muted-foreground))] sm:inline">
              {streaming ? 'Enter steer · Ctrl+Enter queue · Esc abort' : 'Enter send'}
            </span>
            {streaming ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => submit('followUp')}
                  disabled={(!text.trim() && images.length === 0) || sending}
                  title="Queue as follow-up (runs after the current turn)"
                  aria-label="Queue follow-up"
                >
                  <ListPlus />
                </Button>
                <Button variant="destructive" onClick={onAbort} title="Abort current turn (Esc)">
                  <Square />
                  Abort
                </Button>
              </>
            ) : (
              <Button
                onClick={() => submit('steer')}
                disabled={(!text.trim() && images.length === 0) || sending}
                title="Send prompt"
                aria-label="Send prompt"
              >
                <SendHorizontal />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
