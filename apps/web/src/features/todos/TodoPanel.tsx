import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { Ban, CheckCheck, ListTodo, OctagonPause, Play, Plus, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useApplyTodoOp, useTodos } from '../../lib/api-client/hooks';
import type { P2aTodoTask } from '../../lib/api-client/rest';

interface TodoPanelProps {
  sessionId: string;
}

const OPS = ['init', 'start', 'done', 'block', 'unblock', 'append'] as const;

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s.includes('complet') || s.includes('done')) return 'default';
  if (s.includes('progress') || s.includes('active') || s.includes('start')) return 'secondary';
  if (s.includes('block') || s.includes('abandon')) return 'destructive';
  return 'outline';
}

function TaskRow({ task }: { task: P2aTodoTask }) {
  return (
    <li className="rounded border border-[hsl(var(--border))] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.content}</span>
        <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
      </div>
      {task.blocker && (
        <p className="mt-1 flex items-center gap-1 text-xs text-[hsl(var(--destructive))]">
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
    if (blocker.trim()) payload.blocker = blocker.trim();
    if (op !== 'init' && Object.keys(payload).length === 0) {
      setFormError('Provide at least a phase, content, or blocker for this op.');
      return;
    }
    applyOp.mutate(
      { op, payload },
      {
        onSuccess: () => {
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
      <div className="flex flex-col gap-2 border-b border-[hsl(var(--border))] p-3">
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Todo operations">
          {OPS.map((name) => (
            <Button
              key={name}
              size="sm"
              variant={op === name ? 'default' : 'ghost'}
              onClick={() => setOp(name)}
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
        <Button size="sm" onClick={handleApply} disabled={applyOp.isPending}>
          <ListTodo />
          {applyOp.isPending ? 'Applying…' : `Apply ${op}`}
        </Button>
        {(formError || applyOp.isError) && (
          <p className="text-xs text-[hsl(var(--destructive))]">
            {formError ?? (applyOp.error instanceof Error ? applyOp.error.message : 'Op failed.')}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {todosQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}
        {todosQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded border border-[hsl(var(--border))] p-3 text-center">
            <p className="text-xs text-[hsl(var(--destructive))]">
              {todosQuery.error instanceof Error ? todosQuery.error.message : 'Todos failed.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => todosQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {todosQuery.data && todosQuery.data.length === 0 && (
          <p className="p-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
            No phases yet — use init or append to start tracking.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {todosQuery.data?.map((todoPhase) => (
            <section
              key={todoPhase.name}
              className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
            >
              <header className="border-b border-[hsl(var(--border))] px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                {todoPhase.name} ({todoPhase.tasks.length})
              </header>
              {todoPhase.tasks.length === 0 ? (
                <p className="p-2 text-xs text-[hsl(var(--muted-foreground))]">
                  No tasks in this phase.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 p-2">
                  {todoPhase.tasks.map((task, idx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: tasks have no ids
                    <TaskRow key={idx} task={task} />
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
