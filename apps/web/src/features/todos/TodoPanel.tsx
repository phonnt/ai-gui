import { Badge, Button, ErrorState, Input, Skeleton } from '@grove/ui';
import { Ban, CheckCheck, ListTodo, OctagonPause, Play, Plus, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useApplyTodoOp, useTodos } from '../../lib/api-client/hooks';
import type { P2aTodoTask } from '../../lib/api-client/rest';

interface TodoPanelProps {
  sessionId: string;
}

const OPS = ['init', 'start', 'done', 'block', 'unblock', 'append'] as const;

function statusVariant(status: string): 'neutral' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s.includes('complet') || s.includes('done')) return 'neutral';
  if (s.includes('progress') || s.includes('active') || s.includes('start')) return 'secondary';
  if (s.includes('block') || s.includes('abandon')) return 'destructive';
  return 'outline';
}

function TaskRow({ task, onSelect }: { task: P2aTodoTask; onSelect: () => void }) {
  return (
    <li className="rounded-md hairline px-2 py-1.5">
      <button
        type="button"
        onClick={onSelect}
        title="Fill form with this task"
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.content}</span>
        <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
      </button>
      {task.blocker && (
        <p className="mt-1 flex items-center gap-1 text-small text-destructive">
          <OctagonPause className="size-3.5 shrink-0" />
          Blocked: {task.blocker}
        </p>
      )}
    </li>
  );
}

export function TodoPanel({ sessionId }: TodoPanelProps) {
  const todosQuery = useTodos(sessionId);
  const applyOp = useApplyTodoOp(sessionId);
  const [op, setOp] = useState<(typeof OPS)[number]>('append');
  const [phase, setPhase] = useState('');
  const [content, setContent] = useState('');
  const [blocker, setBlocker] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleApply = () => {
    setFormError(null);
    const payload: Record<string, string> = {};
    if (phase.trim()) payload.phase = phase.trim();
    if (content.trim()) payload.content = content.trim();
    // Blocker text belongs to block/unblock only; never leak it into
    // unrelated ops when switching tabs with text still typed.
    if ((op === 'block' || op === 'unblock') && blocker.trim()) {
      payload.blocker = blocker.trim();
    }
    if (op !== 'init' && Object.keys(payload).length === 0) {
      setFormError('Provide at least a phase, content, or blocker for this op.');
      return;
    }
    applyOp.mutate(
      { op, payload },
      {
        onSuccess: () => {
          setPhase('');
          setContent('');
          setBlocker('');
        },
      },
    );
  };

  const opIcon = (name: string) => {
    switch (name) {
      case 'init':
        return <Rocket className="size-3.5" />;
      case 'start':
        return <Play className="size-3.5" />;
      case 'done':
        return <CheckCheck className="size-3.5" />;
      case 'block':
        return <Ban className="size-3.5" />;
      case 'append':
        return <Plus className="size-3.5" />;
      default:
        return <OctagonPause className="size-3.5" />;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 hairline-b p-3">
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Todo operations">
          {OPS.map((name) => (
            <Button
              key={name}
              variant={op === name ? 'default' : 'ghost'}
              onClick={() => {
                setOp(name);
                if (name !== 'block' && name !== 'unblock') setBlocker('');
              }}
            >
              {opIcon(name)}
              {name}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            placeholder="phase (optional)"
            aria-label="Phase"
          />
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApply();
            }}
            placeholder="task content"
            aria-label="Task content"
          />
        </div>
        {(op === 'block' || op === 'unblock') && (
          <Input
            value={blocker}
            onChange={(e) => setBlocker(e.target.value)}
            placeholder="blocker reason"
            aria-label="Blocker reason"
          />
        )}
        <Button onClick={handleApply} disabled={applyOp.isPending}>
          <ListTodo />
          {applyOp.isPending ? 'Applying…' : `Apply ${op}`}
        </Button>
        {(formError || applyOp.isError) && (
          <p className="text-small text-destructive">
            {formError ?? (applyOp.error instanceof Error ? applyOp.error.message : 'Op failed.')}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        {todosQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {todosQuery.isError && (
          <ErrorState
            message={todosQuery.error instanceof Error ? todosQuery.error.message : 'Todos failed.'}
            onRetry={() => todosQuery.refetch()}
          />
        )}
        {todosQuery.data && todosQuery.data.length === 0 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            No phases yet — use init or append to start tracking.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {todosQuery.data?.map((todoPhase) => (
            <section key={todoPhase.name} className="rounded-md bg-card hairline">
              <header className="hairline-b px-2 py-1.5 text-meta font-strong uppercase text-muted-foreground">
                {todoPhase.name} ({todoPhase.tasks.length})
              </header>
              {todoPhase.tasks.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No tasks in this phase.</p>
              ) : (
                <ul className="flex flex-col gap-1.5 p-2">
                  {todoPhase.tasks.map((task) => (
                    <TaskRow
                      key={`${todoPhase.name}:${task.content}:${task.status}`}
                      task={task}
                      onSelect={() => {
                        setPhase(todoPhase.name);
                        setContent(task.content);
                        setBlocker('');
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
