import { Button } from '@grove/ui';
import {
  Image as ImageIcon,
  ListPlus,
  Paperclip,
  SendHorizontal,
  Square,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGlobFiles } from '../../lib/api-client/hooks';
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

/**
 * Trailing `@mention` token before the caret: the query is the text after the
 * last `@` that starts a word and contains no whitespace. Null when the caret
 * is not inside such a token.
 */
function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  return query;
}

/**
 * Command being typed: `/` plus a command-shaped token with no space yet.
 * Once a space lands the command is committed and the menu closes, so
 * accepting a suggestion does not leave the list open over the arguments.
 */
function slashPrefix(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.includes(' ')) return null;
  const query = text.slice(1).toLowerCase();
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
  const [caret, setCaret] = useState(0);
  const [mention, setMention] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Debounce the glob so typing does not fire a request per keystroke.
  useEffect(() => {
    if (mention === null) return;
    const timer = setTimeout(() => setGlobQuery(mention), 140);
    return () => clearTimeout(timer);
  }, [mention]);
  const [globQuery, setGlobQuery] = useState<string | null>(null);
  const pattern = globQuery === null ? null : `**/*${globQuery}*`;
  const glob = useGlobFiles(sessionId, pattern);
  const pathMatches = useMemo(() => (glob.data?.paths ?? []).slice(0, 8), [glob.data]);

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
  const slashOpen = query !== null && matches.length > 0;
  // Mentions only show once the query is non-empty: a bare `@` would list the
  // first eight files of the repo, which is noise, not a suggestion.
  const mentionOpen = mention !== null && mention.length > 0 && pathMatches.length > 0;
  const open = slashOpen || mentionOpen;
  const optionCount = slashOpen ? matches.length : pathMatches.length;
  const clamped = active >= optionCount ? 0 : active;

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

  /** Replace the in-progress `@token` with the chosen path. */
  const completePath = (path: string) => {
    const at = text.slice(0, caret).lastIndexOf('@');
    if (at === -1) return;
    const next = `${text.slice(0, at)}@${path} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    setGlobQuery(null);
    setActive(0);
  };

  /** Accept whichever suggestion list is open (Enter with the menu up commits). */
  const acceptSuggestion = () => {
    if (slashOpen && matches[clamped]) complete(matches[clamped].name);
    else if (mentionOpen && pathMatches[clamped]) completePath(pathMatches[clamped]);
  };

  return (
    <div className="bg-transparent p-3">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 rounded-md bg-card hairline p-2 shadow-floating">
        {mentionOpen && (
          <ul
            aria-label="File suggestions"
            className="max-h-48 overflow-y-auto scroll-area rounded-md bg-background hairline"
          >
            {pathMatches.map((path, i) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => completePath(path)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-2 py-1 text-left font-mono text-small ${
                    i === clamped ? 'bg-accent' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{path}</span>
                  {glob.isFetching && i === 0 && (
                    <span className="shrink-0 text-meta text-muted-foreground">searching…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {slashOpen && (
          <ul
            aria-label="Slash commands"
            className="max-h-48 overflow-y-auto scroll-area rounded-md bg-background hairline"
          >
            {matches.map((cmd, i) => (
              <li key={cmd.name}>
                <button
                  type="button"
                  onClick={() => complete(cmd.name)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline gap-2 px-2 py-1 text-left text-body ${
                    i === clamped ? 'bg-accent' : ''
                  }`}
                >
                  <span className="font-mono font-strong">/{cmd.name}</span>
                  <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">
                    {cmd.hint ?? cmd.description}
                  </span>
                  {cmd.localOnly && (
                    <span className="shrink-0 text-meta uppercase text-muted-foreground">
                      local
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-start gap-2 px-1 pt-1">
          <WandSparkles className="mt-2 size-4 shrink-0 text-muted-foreground" />
          <textarea
            value={text}
            ref={textareaRef}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setMention(mentionQuery(e.target.value, e.target.selectionStart ?? 0));
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
                    ? (a + 1) % optionCount
                    : (a - 1 + optionCount) % optionCount,
                );
                return;
              }
              if (open && (e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
                // TUI parity: Tab/Enter accept the highlighted suggestion
                // instead of sending the half-typed command.
                e.preventDefault();
                acceptSuggestion();
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                if (open) {
                  // First Esc closes the suggestion list, like the TUI.
                  setMention(null);
                  setGlobQuery(null);
                  setActive(0);
                  return;
                }
                // TUI parity: Esc is the abort gesture, never a draft wipe.
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
            aria-label="Message"
            className="min-h-11 flex-1 resize-none bg-transparent py-1.5 text-body placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring rounded-sm"
          />
        </div>
        {images.length > 0 && (
          <ul className="flex flex-wrap gap-1 px-1" aria-label="Attached images">
            {images.map((image) => (
              <li
                key={image.id}
                className="flex items-center gap-1 rounded-md hairline px-1.5 py-0.5 font-mono text-meta text-muted-foreground"
              >
                <ImageIcon className="size-3" />
                {image.mimeType.replace('image/', '')}
                <button
                  type="button"
                  onClick={() =>
                    setImages((prev) => prev.filter((candidate) => candidate.id !== image.id))
                  }
                  aria-label="Remove attachment"
                  className="hover:text-foreground"
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
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-meta text-muted-foreground hover:text-foreground"
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
            <span className="hidden font-mono text-meta text-muted-foreground sm:inline">
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
