import type { ChatMessage } from '@ai-gui/core';
import { useEffect, useRef } from 'react';
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
}

export function Transcript({ messages, liveText, waiting, turnTools }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: stick-to-bottom intentionally follows new messages/live text
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, liveText]);

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
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
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <div role="status" className="motion-safe:animate-pulse rounded-md px-3 py-2">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              assistant · thinking
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
