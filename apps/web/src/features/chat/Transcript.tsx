import type { ChatMessage } from '@ai-gui/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from './CodeBlock';
import { Message } from './Message';
import { type TurnTool, TurnTools } from './TurnTools';

interface TranscriptProps {
  messages: ChatMessage[];
  liveText?: string;
  waiting?: boolean;
  turnTools?: TurnTool[];
  turnStartedAt?: number | null;
}

/** Honest aliveness signal for the model's silent thinking phase. */
function ThinkingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span> · {Math.max(0, Math.round((now - since) / 1000))}s</span>;
}
export function Transcript({
  messages,
  liveText,
  waiting,
  turnTools,
  turnStartedAt,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Windowed rendering: history items are immutable, so measured sizes stay
  // valid; only the visible window pays markdown + highlight costs.
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: stick-to-bottom intentionally follows new messages/live text
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    if (liveText || waiting || (turnTools && turnTools.length > 0)) {
      el.scrollTop = el.scrollHeight;
    } else if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
    }
  }, [messages, liveText]);

  const items = virtualizer.getVirtualItems();

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3">
      <div className="mx-auto w-full max-w-5xl">
        <div
          className="relative flex w-full flex-col gap-2"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((row) => {
            const message = messages[row.index];
            if (!message) return null;
            return (
              <div
                key={message.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <Message message={message} />
              </div>
            );
          })}
        </div>
        {liveText && (
          <div className="rounded-md px-3 py-2">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              assistant · streaming
            </div>
            <div className="flex flex-col gap-2 break-words leading-[1.6] [&>p]:m-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {liveText}
              </ReactMarkdown>
            </div>
          </div>
        )}
        {turnTools && turnTools.length > 0 && <TurnTools tools={turnTools} />}
      </div>
      {waiting && (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
          <div role="status" className="motion-safe:animate-pulse rounded-md px-3 py-2">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              assistant · thinking
              {turnStartedAt ? <ThinkingElapsed since={turnStartedAt} /> : null}
            </div>
            <div className="flex gap-1 py-1" aria-hidden="true">
              <span className="size-1.5 motion-safe:animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]" />
              <span
                className="size-1.5 motion-safe:animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="size-1.5 motion-safe:animate-bounce rounded-full bg-[hsl(var(--muted-foreground))]"
                style={{ animationDelay: '300ms' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
