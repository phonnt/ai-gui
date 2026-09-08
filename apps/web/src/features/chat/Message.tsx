import type { ChatMessage } from '@ai-gui/core';
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const roleStyles: Record<ChatMessage['role'], string> = {
  user: 'border border-[hsl(var(--primary)/0.35)] bg-[hsl(var(--primary)/0.08)] shadow-[0_0_24px_hsl(var(--primary)/0.08)]',
  assistant: 'bg-transparent',
  system: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  tool: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
};

const roleLabels: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

export const Message = memo(function Message({ message }: { message: ChatMessage }) {
  return (
    <div className={`rounded-xl px-4 py-2.5 ${roleStyles[message.role]}`}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {roleLabels[message.role]}
      </div>
      <div className="whitespace-pre-wrap break-words leading-[1.6]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
      </div>
    </div>
  );
});
