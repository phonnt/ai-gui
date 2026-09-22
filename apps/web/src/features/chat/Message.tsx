import type { ChatMessage, DiffLine, ToolTodo } from '@grove/core';
import { GitBranch, Pencil } from 'lucide-react';
import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CopyButton, markdownComponents } from './CodeBlock';

const roleStyles: Record<ChatMessage['role'], string> = {
  user: 'bg-muted',
  assistant: 'bg-transparent',
  system: 'bg-muted text-muted-foreground',
  tool: 'border border-border bg-card',
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
    <ol className="font-mono text-body leading-[1.6]">
      {todos.map((todo, i) => {
        const showPhase = multiPhase && todos[i - 1]?.phase !== todo.phase;
        return (
          <li key={`${todo.phase ?? ''}:${todo.status}:${todo.label}`}>
            {showPhase && (
              <div aria-hidden="true" className="pt-1 text-small font-strong text-muted-foreground">
                {todo.phase}
              </div>
            )}
            <div className="flex min-w-0 items-baseline gap-2">
              <span
                aria-hidden="true"
                className={`shrink-0 ${
                  todo.status === 'done'
                    ? 'text-success'
                    : todo.status === 'active'
                      ? 'text-link'
                      : 'text-muted-foreground'
                }`}
              >
                {TODO_ICON[todo.status]}
              </span>
              <span
                className={`min-w-0 flex-1 break-words ${
                  todo.status === 'done'
                    ? 'text-muted-foreground line-through'
                    : todo.status === 'active'
                      ? 'font-strong text-foreground'
                      : 'text-foreground'
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
    <div className="overflow-x-auto rounded-md bg-card hairline font-mono text-small leading-relaxed">
      {diff.map((line) => (
        <div
          key={`${line.type}:${line.n ?? ''}:${line.text}`}
          className={`flex min-w-0 ${
            line.type === 'add' ? 'bg-diff-add/10' : line.type === 'del' ? 'bg-diff-del/12' : ''
          }`}
        >
          <span className="w-9 shrink-0 select-none pr-2 text-right text-muted-foreground">
            {line.n ?? ''}
          </span>
          <span
            aria-hidden="true"
            className={`w-3 shrink-0 select-none ${
              line.type === 'add'
                ? 'text-diff-add'
                : line.type === 'del'
                  ? 'text-diff-del'
                  : 'text-muted-foreground'
            }`}
          >
            {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
  if (diff.length <= 30) return body;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none font-mono text-small text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
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
        <span
          aria-hidden
          className={`shrink-0 font-mono text-body ${message.tool?.error ? 'text-destructive' : 'text-success'}`}
        >
          ⏺
        </span>
        <span className="truncate text-body font-strong text-foreground">
          {name}
          {message.tool?.error && (
            <span className="ml-2 font-mono text-meta font-normal text-destructive">failed</span>
          )}
        </span>
        {summary && (
          <span
            title={summary}
            className="min-w-0 flex-1 truncate font-mono text-small text-muted-foreground"
          >
            {summary}
          </span>
        )}
        {(wall !== undefined || timeout !== undefined) && (
          <span className="shrink-0 font-mono text-meta text-muted-foreground">
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
          <summary className="cursor-pointer list-none font-mono text-small text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show output ({lineCount} lines)…</span>
            <span className="hidden group-open:inline">Hide output</span>
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-small leading-relaxed text-foreground">
            {message.text}
          </pre>
        </details>
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-small leading-relaxed text-foreground">
          {message.text}
        </pre>
      )}
    </div>
  );
});

interface MessageProps {
  message: ChatMessage;
  /**
   * Branch the session at this message's journal entry and hand its text back
   * as the new session's draft (TUI rewind). Absent when the message has no
   * aligned entry, which is what disables the action.
   */
  onBranchFrom?: (entryId: string) => void;
  /** True for the newest user message, labelled as an edit-and-resend. */
  isLastUser?: boolean;
}

/** Copy + branch actions for a transcript row; hidden until hover/focus. */
function MessageActions({
  message,
  onBranchFrom,
  isLastUser,
}: {
  message: ChatMessage;
  onBranchFrom?: (entryId: string) => void;
  isLastUser?: boolean;
}) {
  // Only user messages are branch points (the runtime rejects the rest), so
  // the action never appears where it could not work.
  const entryId = message.role === 'user' ? message.entryId : undefined;
  const branchLabel = isLastUser ? 'Edit and resend' : 'Branch from here';
  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <CopyButton text={message.text} label="Copy message" />
      {onBranchFrom && entryId && (
        <button
          type="button"
          aria-label={branchLabel}
          title={`${branchLabel} (branches into a new session with this text as draft)`}
          onClick={() => onBranchFrom(entryId)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {isLastUser ? <Pencil className="size-3.5" /> : <GitBranch className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export const Message = memo(function Message({ message, onBranchFrom, isLastUser }: MessageProps) {
  if (message.role === 'tool') return <ToolMessage message={message} />;
  if (message.role === 'user') {
    return (
      <div className="group flex items-start justify-end gap-1">
        <MessageActions
          message={message}
          {...(onBranchFrom ? { onBranchFrom } : {})}
          {...(isLastUser ? { isLastUser } : {})}
        />
        <div className="max-w-[85%] rounded-md bg-muted px-4 py-2.5 text-foreground">
          <div className="whitespace-pre-wrap break-words leading-[1.6]">{message.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`group rounded-md px-4 py-2.5 ${roleStyles[message.role]}`}>
      <div className="mb-1 flex items-center gap-1">
        <span className="flex-1 text-meta font-strong uppercase text-muted-foreground">
          {roleLabels[message.role]}
        </span>
        <MessageActions
          message={message}
          {...(onBranchFrom ? { onBranchFrom } : {})}
          {...(isLastUser ? { isLastUser } : {})}
        />
      </div>
      <div className="flex flex-col gap-2 break-words leading-[1.6] [&>p]:m-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.text}
        </ReactMarkdown>
      </div>
    </div>
  );
});
