import type { ChatMessage } from '@grove/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TurnBlock } from './TurnBlock';
import type { TurnTool } from './TurnTools';
import { ThinkingElapsed } from './thinking-elapsed';
import { groupTurns } from './turns';

interface TranscriptProps {
  messages: ChatMessage[];
  liveText?: string;
  /** Streamed reasoning for the live turn (rendered collapsed). */
  liveThinking?: string;
  waiting?: boolean;
  turnTools?: TurnTool[];
  turnStartedAt?: number | null;
  /** Branch the session at a message's journal entry. */
  onBranchFrom?: (entryId: string) => void;
}

export function Transcript({
  messages,
  liveText,
  liveThinking,
  waiting,
  turnTools,
  turnStartedAt,
  onBranchFrom,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const turns = useMemo(() => groupTurns(messages), [messages]);
  // The newest user message offers "edit and resend" instead of a plain branch.
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return messages[i]?.id ?? null;
    }
    return null;
  }, [messages]);

  // Windowed rendering: turns are immutable once completed, so measured
  // sizes stay valid; only the visible window pays markdown costs.
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 280,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const liveActive =
    !!liveText || !!liveThinking || !!waiting || (turnTools && turnTools.length > 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stick-to-bottom intentionally follows new turns/live text
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    if (liveActive) {
      el.scrollTop = el.scrollHeight;
    } else if (turns.length > 0) {
      virtualizer.scrollToIndex(turns.length - 1, { align: 'end' });
    }
  }, [messages, liveText, turnTools, waiting]);

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-label="Conversation transcript"
      className="flex-1 overflow-y-auto scroll-area p-3"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div
          className="relative flex w-full flex-col gap-4"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {items.map((row) => {
            const turn = turns[row.index];
            if (!turn) return null;
            const isLast = row.index === turns.length - 1;
            const isLive = isLast && liveActive;
            return (
              <div
                key={turn.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full pb-2"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <TurnBlock
                  turn={turn}
                  lastUserMessageId={lastUserMessageId}
                  {...(onBranchFrom ? { onBranchFrom } : {})}
                  active={isLive}
                  liveText={isLive ? liveText : undefined}
                  liveThinking={isLive ? liveThinking : undefined}
                  liveTools={isLive ? turnTools : undefined}
                  thinking={isLive ? !!waiting && !liveText : undefined}
                  turnStartedAt={isLive ? turnStartedAt : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
      {waiting && turns.length === 0 && (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
          <div role="status" className="motion-safe:animate-pulse rounded-md px-3 py-2">
            <div className="mb-1 text-meta font-strong uppercase text-muted-foreground">
              assistant · thinking
              {turnStartedAt ? <ThinkingElapsed since={turnStartedAt} /> : null}
            </div>
            <div className="flex gap-1 py-1" aria-hidden="true">
              <span className="size-1.5 motion-safe:animate-bounce rounded-full bg-muted-foreground" />
              <span
                className="size-1.5 motion-safe:animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="size-1.5 motion-safe:animate-bounce rounded-full bg-muted-foreground"
                style={{ animationDelay: '300ms' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
