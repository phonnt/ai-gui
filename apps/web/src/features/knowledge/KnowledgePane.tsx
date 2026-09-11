import { Badge, Button, Skeleton } from '@ai-gui/ui';
import { BookOpen, Brain, MemoryStick, Send } from 'lucide-react';
import { useState } from 'react';
import {
  useEnqueueMemory,
  useMemory,
  useSkillContent,
  useSkills,
} from '../../lib/api-client/hooks';
import { memorySummaryText } from '../../lib/api-client/rest';
export function KnowledgePane() {
  const skillsQuery = useSkills();
  const memoryQuery = useMemory();
  const enqueue = useEnqueueMemory();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [enqueueNotice, setEnqueueNotice] = useState<string | null>(null);

  const skills = skillsQuery.data ?? [];
  const selected = skills.find((skill) => skill.name === selectedName) ?? skills[0] ?? null;
  const contentQuery = useSkillContent(selected?.name);

  const handleEnqueue = () => {
    setEnqueueNotice(null);
    enqueue.mutate(undefined, {
      onSuccess: () => {
        setEnqueueNotice('Consolidation requested.');
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] p-3">
        <BookOpen className="size-4" />
        <h3 className="text-[13px] font-semibold">Knowledge</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <section className="mb-4">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <MemoryStick className="size-3.5" />
            Memory
          </h4>
          {memoryQuery.isPending && <Skeleton className="h-16 w-full" />}
          {memoryQuery.isError && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
              <p className="text-xs text-[hsl(var(--destructive))]">
                {memoryQuery.error instanceof Error
                  ? memoryQuery.error.message
                  : 'Failed to load memory.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => memoryQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {memoryQuery.data && (
            <div className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Backend</span>
                <Badge variant="default">{memoryQuery.data.backend}</Badge>
              </div>
              {(() => {
                const summary = memorySummaryText(memoryQuery.data);
                return summary !== null ? (
                  <p className="whitespace-pre-wrap text-[13px]">{summary}</p>
                ) : (
                  <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                    No summary available.
                  </p>
                );
              })()}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Flush pending memory to the backend now.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEnqueue}
                  disabled={enqueue.isPending}
                >
                  <Send />
                  {enqueue.isPending ? 'Queueing…' : 'Consolidate now'}
                </Button>
              </div>
              {enqueue.isError && (
                <p className="text-xs text-[hsl(var(--destructive))]">
                  {enqueue.error instanceof Error ? enqueue.error.message : 'Enqueue failed.'}
                </p>
              )}
              {enqueueNotice && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{enqueueNotice}</p>
              )}
            </div>
          )}
        </section>
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            <Brain className="size-3.5" />
            Skills
          </h4>
          {skillsQuery.isPending && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {skillsQuery.isError && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
              <p className="text-xs text-[hsl(var(--destructive))]">
                {skillsQuery.error instanceof Error
                  ? skillsQuery.error.message
                  : 'Failed to load skills.'}
              </p>
              <Button size="sm" variant="outline" onClick={() => skillsQuery.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {skillsQuery.data && skills.length === 0 && (
            <p className="rounded-md border border-[hsl(var(--border))] p-4 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
              No skills available.
            </p>
          )}
          {skills.length > 0 && (
            <ul className="flex flex-col gap-1">
              {skills.map((skill) => {
                const active = selected?.name === skill.name;
                return (
                  <li key={skill.name}>
                    <button
                      type="button"
                      onClick={() => setSelectedName(skill.name)}
                      aria-pressed={active}
                      className={`flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left hover:bg-[hsl(var(--accent))] ${
                        active ? 'border-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
                          {skill.name}
                        </span>
                        <Badge variant="outline">{skill.source}</Badge>
                      </span>
                      {skill.description && (
                        <span className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                          {skill.description}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selected && (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpen className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
                  {selected.name}
                </span>
              </div>
              {contentQuery.isPending && <Skeleton className="h-24 w-full" />}
              {contentQuery.isError && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <p className="text-xs text-[hsl(var(--destructive))]">
                    {contentQuery.error instanceof Error
                      ? contentQuery.error.message
                      : 'Failed to load skill preview.'}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => contentQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {contentQuery.data && (
                <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-[hsl(var(--muted))] p-2 font-mono text-xs">
                  {contentQuery.data.content}
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
