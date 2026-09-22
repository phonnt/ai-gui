import type { ChatMessage } from '@grove/core';
import { ChevronRight } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from './CodeBlock';
import { Message } from './Message';
import { type TurnTool, TurnTools } from './TurnTools';
import { ThinkingElapsed } from './thinking-elapsed';
import { formatTurnStatus, summarizeTurn, type Turn, turnDurationMs } from './turns';

interface TurnBlockProps {
  turn: Turn;
  /** Active (streaming) turn renders open; completed turns render collapsed. */
  active?: boolean;
  liveText?: string;
  /** Streamed reasoning for this turn; rendered collapsed, TUI-style. */
  liveThinking?: string;
  liveTools?: TurnTool[];
  thinking?: boolean;
  turnStartedAt?: number | null;
  /** Branch this session at a message's journal entry (composer gets its text). */
  onBranchFrom?: (entryId: string) => void;
  /** Id of the newest user message in the whole transcript. */
  lastUserMessageId?: string | null;
}

/**
 * One user prompt + its whole response inside a single collapse.
 * The final assistant message stays visible below the collapse as the
 * output summary; everything before it (tools + intermediate texts)
 * folds into the `<details>`.
 */
export const TurnBlock = memo(function TurnBlock({
  turn,
  active,
  liveText,
  liveThinking,
  liveTools,
  thinking,
  turnStartedAt,
  onBranchFrom,
  lastUserMessageId,
}: TurnBlockProps) {
  const summary = summarizeTurn(turn);
  const liveRunning = (liveTools?.length ?? 0) > 0 || !!liveText || !!liveThinking;
  const running = active && (thinking || liveRunning);
  const failed = summary.errorCount > 0;
  const state = running ? 'working' : failed ? 'failed' : 'done';
  const steps = turn.items.length + (liveTools?.length ?? 0);
  const statusText = formatTurnStatus(state, steps, running ? null : turnDurationMs(turn));
  // Final assistant message is the output summary — always visible.
  const items = turn.items;
  let finalAssistant: ChatMessage | null = null;
  let intermediate: ChatMessage[] = items;
  if (!liveText) {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]?.role === 'assistant') {
        finalAssistant = items[i] as ChatMessage;
        intermediate = [...items.slice(0, i), ...items.slice(i + 1)];
        break;
      }
    }
  }
  const hasProcess = intermediate.length > 0 || (liveTools?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-2">
      {turn.user && (
        <Message
          message={turn.user}
          {...(onBranchFrom ? { onBranchFrom } : {})}
          {...(turn.user.id === lastUserMessageId ? { isLastUser: true } : {})}
        />
      )}
      {hasProcess && (
        <details open={!!active} className="group [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none rounded px-1 py-1.5 font-mono text-small text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring/60">
            <span className="flex items-center gap-1.5">
              <span className={`min-w-0 truncate ${failed && !running ? 'text-destructive' : ''}`}>
                {statusText}
                {running && turnStartedAt ? <ThinkingElapsed since={turnStartedAt} /> : null}
              </span>
              <ChevronRight
                aria-hidden
                className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
              />
            </span>
          </summary>
          <div className="flex flex-col gap-2 px-1 pb-2">
            {intermediate.map((m) => (
              <Message key={m.id} message={m} {...(onBranchFrom ? { onBranchFrom } : {})} />
            ))}
            {liveTools && liveTools.length > 0 && <TurnTools tools={liveTools} />}
          </div>
        </details>
      )}
      {finalAssistant && (
        <Message
          message={finalAssistant}
          {...(onBranchFrom ? { onBranchFrom } : {})}
          {...(finalAssistant.id === lastUserMessageId ? { isLastUser: true } : {})}
        />
      )}
      {liveThinking && (
        <details className="group rounded-md bg-card/40 hairline [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none px-3 py-1 font-mono text-meta uppercase text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring/60">
            reasoning
            <span className="ml-2 normal-case group-open:hidden">
              ({liveThinking.length} chars)
            </span>
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 pb-2 font-mono text-small leading-relaxed text-muted-foreground">
            {liveThinking}
          </pre>
        </details>
      )}
      {liveText && (
        <div className="rounded-md px-4 py-2.5">
          <div className="mb-1 section-label">assistant · streaming</div>
          <div className="flex flex-col gap-2 break-words leading-[1.6] [&>p]:m-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {liveText}
            </ReactMarkdown>
          </div>
        </div>
      )}
      {thinking && !liveText && (
        <div role="status" className="px-3 py-1 font-mono text-small text-muted-foreground">
          <span className="motion-safe:animate-pulse">thinking</span>
          {turnStartedAt ? <ThinkingElapsed since={turnStartedAt} /> : null}
        </div>
      )}
    </div>
  );
});
