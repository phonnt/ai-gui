import type { ChatMessage } from '@ai-gui/core';
import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message } from './Message';

interface TranscriptProps {
  messages: ChatMessage[];
  liveText?: string;
}

export function Transcript({ messages, liveText }: TranscriptProps) {
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
            <div className="whitespace-pre-wrap break-words leading-[1.6]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{liveText}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
