import type { ChatMessage } from '@ai-gui/core';
import { ChevronRight } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { markdownComponents } from './CodeBlock';
import { Message } from './Message';
import { type TurnTool, TurnTools } from './TurnTools';
import { formatTurnStatus, summarizeTurn, type Turn, turnDurationMs } from './turns';

function ThinkingElapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span> · {Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

interface TurnBlockProps {
  turn: Turn;
  /** Active (streaming) turn renders open; completed turns render collapsed. */
  active?: boolean;
  liveText?: string;
  liveTools?: TurnTool[];
  thinking?: boolean;
  turnStartedAt?: number | null;
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
  liveTools,
  thinking,
  turnStartedAt,
}: TurnBlockProps) {
  const summary = summarizeTurn(turn);
  const liveRunning = (liveTools?.length ?? 0) > 0 || !!liveText;
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
      {turn.user && <Message message={turn.user} />}
      {hasProcess && (
        <details open={!!active} className="group [&_summary::-webkit-details-marker]:hidden">
          <summary className="cursor-pointer list-none rounded px-1 py-1.5 font-mono text-xs text-[hsl(var(--muted-foreground))] outline-none hover:bg-[hsl(var(--muted)/0.4)] hover:text-[hsl(var(--foreground))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring)/0.6)]">
            <span className="flex items-center gap-1.5">
              <span
                className={`min-w-0 truncate ${failed && !running ? 'text-[hsl(var(--diff-del))]' : ''}`}
              >
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
              <Message key={m.id} message={m} />
            ))}
            {liveTools && liveTools.length > 0 && <TurnTools tools={liveTools} />}
          </div>
        </details>
      )}
      {finalAssistant && <Message message={finalAssistant} />}
      {liveText && (
        <div className="rounded-md px-4 py-2.5">
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
      {thinking && !liveText && (
        <div
          role="status"
          className="px-3 py-1 font-mono text-xs text-[hsl(var(--muted-foreground))]"
        >
          <span className="motion-safe:animate-pulse">thinking</span>
          {turnStartedAt ? <ThinkingElapsed since={turnStartedAt} /> : null}
        </div>
      )}
    </div>
  );
});
