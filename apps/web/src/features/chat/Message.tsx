import type { ChatMessage } from '@ai-gui/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const roleStyles: Record<ChatMessage['role'], string> = {
  user: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
  assistant: 'bg-transparent',
  system: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  tool: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
};

export function Message({ message }: { message: ChatMessage }) {
  return (
    <div className={`rounded-md px-3 py-2 ${roleStyles[message.role]}`}>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
        {message.role}
      </div>
      <div className="whitespace-pre-wrap break-words leading-[1.6]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
      </div>
    </div>
  );
}
