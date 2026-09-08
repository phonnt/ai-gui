import type { ChatMessage } from '@ai-gui/core';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton, markdownComponents } from './CodeBlock';

const roleStyles: Record<ChatMessage['role'], string> = {
  user: 'border border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.08)] shadow-[0_0_24px_hsl(var(--primary)/0.08)]',
  assistant: 'bg-transparent',
  system: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  tool: 'border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)]',
};

const roleLabels: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

const COLLAPSE_LINES = 15;
const COLLAPSE_CHARS = 1500;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

const ToolMessage = memo(function ToolMessage({ message }: { message: ChatMessage }) {
  const name = message.tool?.name ?? 'tool';
  const summary = message.tool?.summary;
  const wall = message.tool?.wallTimeMs;
  const lineCount = useMemo(() => message.text.split('\n').length, [message.text]);
  const collapsed = lineCount > COLLAPSE_LINES || message.text.length > COLLAPSE_CHARS;

  return (
    <div className={`rounded-xl px-4 py-2.5 ${roleStyles.tool}`}>
      <div className="mb-1 flex min-w-0 items-center gap-2">
        <span aria-hidden className="shrink-0 font-mono text-[13px] text-[hsl(var(--diff-add))]">
          ⏺
        </span>
        <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
          {name}
        </span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {summary}
          </span>
        )}
        {wall !== undefined && (
          <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            took {formatDuration(wall)}
          </span>
        )}
        <CopyButton text={message.text} label={`Copy ${name} output`} />
      </div>
      {collapsed ? (
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show output ({lineCount} lines)…</span>
            <span className="hidden group-open:inline">Hide output</span>
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed text-[hsl(var(--foreground))]">
            {message.text}
          </pre>
        </details>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[hsl(var(--foreground))]">
          {message.text}
        </pre>
      )}
    </div>
  );
});

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'tool') return <ToolMessage message={message} />;
  return (
    <div className={`rounded-xl px-4 py-2.5 ${roleStyles[message.role]}`}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {roleLabels[message.role]}
      </div>
      <div className="flex flex-col gap-2 break-words leading-[1.6] [&>p]:m-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.text}
        </ReactMarkdown>
      </div>
    </div>
  );
});
