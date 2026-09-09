import type { ChatMessage, DiffLine, ToolTodo } from '@ai-gui/core';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton, markdownComponents } from './CodeBlock';

const roleStyles: Record<ChatMessage['role'], string> = {
  user: 'bg-[hsl(var(--secondary)/0.35)]',
  assistant: 'bg-transparent',
  system: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  tool: 'border border-[hsl(var(--border))] bg-[hsl(var(--card))]',
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

const TODO_ICON: Record<ToolTodo['status'], string> = { done: '✔', active: '◼', todo: '◻' };

const TodoListView = memo(function TodoListView({ todos }: { todos: ToolTodo[] }) {
  const multiPhase = new Set(todos.map((t) => t.phase ?? '')).size > 1;
  return (
    <ol className="font-mono text-[13px] leading-[1.6]">
      {todos.map((todo, i) => {
        const showPhase = multiPhase && todos[i - 1]?.phase !== todo.phase;
        return (
          <li key={`${todo.phase ?? ''}:${todo.status}:${todo.label}`}>
            {showPhase && (
              <div
                aria-hidden="true"
                className="pt-1 text-xs font-semibold text-[hsl(var(--muted-foreground))]"
              >
                {todo.phase}
              </div>
            )}
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                aria-hidden="true"
                className={`shrink-0 ${
                  todo.status === 'done'
                    ? 'text-[hsl(var(--diff-add))]'
                    : todo.status === 'active'
                      ? 'text-[hsl(var(--primary))]'
                      : 'text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {TODO_ICON[todo.status]}
              </span>
              <span
                className={`min-w-0 flex-1 break-words ${
                  todo.status === 'done'
                    ? 'text-[hsl(var(--muted-foreground))] line-through'
                    : todo.status === 'active'
                      ? 'font-semibold text-[hsl(var(--foreground))]'
                      : 'text-[hsl(var(--foreground))]'
                }`}
              >
                {todo.label}
                <span className="sr-only">
                  {todo.status === 'done'
                    ? ' (completed)'
                    : todo.status === 'active'
                      ? ' (in progress)'
                      : ' (pending)'}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
});

const DiffView = memo(function DiffView({ diff }: { diff: DiffLine[] }) {
  const body = (
    <div className="overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] font-mono text-xs leading-relaxed">
      {diff.map((line) => (
        <div
          key={`${line.type}:${line.n ?? ''}:${line.text}`}
          className={`flex min-w-0 ${
            line.type === 'add'
              ? 'bg-[hsl(var(--diff-add)/0.1)]'
              : line.type === 'del'
                ? 'bg-[hsl(var(--diff-del)/0.12)]'
                : ''
          }`}
        >
          <span className="w-9 shrink-0 select-none pr-2 text-right text-[hsl(var(--muted-foreground))]">
            {line.n ?? ''}
          </span>
          <span
            aria-hidden="true"
            className={`w-3 shrink-0 select-none ${
              line.type === 'add'
                ? 'text-[hsl(var(--diff-add))]'
                : line.type === 'del'
                  ? 'text-[hsl(var(--diff-del))]'
                  : 'text-[hsl(var(--muted-foreground))]'
            }`}
          >
            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[hsl(var(--foreground))]">
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
  if (diff.length <= 30) return body;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-mono text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show diff ({diff.length} lines)…</span>
        <span className="hidden group-open:inline">Hide diff</span>
      </summary>
      <div className="mt-1">{body}</div>
    </details>
  );
});

const ToolMessage = memo(function ToolMessage({ message }: { message: ChatMessage }) {
  const name = message.tool?.name ?? 'tool';
  const summary = message.tool?.path ?? message.tool?.summary;
  const wall = message.tool?.wallTimeMs;
  const timeout = message.tool?.timeoutMs;
  const lineCount = useMemo(() => message.text.split('\n').length, [message.text]);
  const collapsed = lineCount > COLLAPSE_LINES || message.text.length > COLLAPSE_CHARS;

  return (
    <div className={`rounded-md px-4 py-2.5 ${roleStyles.tool}`}>
      <div className="mb-1 flex min-w-0 items-center gap-2">
        <span aria-hidden className="shrink-0 font-mono text-[13px] text-[hsl(var(--diff-add))]">
          ⏺
        </span>
        <span className="truncate text-[13px] font-medium text-[hsl(var(--foreground))]">
          {name}
        </span>
        {summary && (
          <span
            title={summary}
            className="min-w-0 flex-1 truncate font-mono text-xs text-[hsl(var(--muted-foreground))]"
          >
            {summary}
          </span>
        )}
        {(wall !== undefined || timeout !== undefined) && (
          <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {wall !== undefined ? `took ${formatDuration(wall)}` : ''}
            {wall !== undefined && timeout !== undefined ? ' · ' : ''}
            {timeout !== undefined ? `timeout ${formatDuration(timeout)}` : ''}
          </span>
        )}
        <CopyButton text={message.text} label={`Copy ${name} output`} />
      </div>
      {message.tool?.todos && message.tool.todos.length > 0 ? (
        <TodoListView todos={message.tool.todos} />
      ) : message.tool?.diff && message.tool.diff.length > 0 ? (
        <DiffView diff={message.tool.diff} />
      ) : collapsed ? (
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
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-md bg-[hsl(var(--secondary)/0.35)] px-4 py-2.5 text-[hsl(var(--foreground))]">
          <div className="whitespace-pre-wrap break-words leading-[1.6]">{message.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`rounded-md px-4 py-2.5 ${roleStyles[message.role]}`}>
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
