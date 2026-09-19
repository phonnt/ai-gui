import { Badge, Button, Skeleton } from '@ai-gui/ui';
import { BookOpen, Brain, MemoryStick, Send } from 'lucide-react';
import { useState } from 'react';
import {
  useMemory,
  useMemoryOp,
  useSessionSkillContent,
  useSessionSkills,
  useSetMemoryBackend,
} from '../../lib/api-client/hooks';
import { memoryText } from '../../lib/api-client/rest';

/** Memory backends the schema accepts (TUI `memory.backend`). */
const MEMORY_BACKENDS = ['off', 'local', 'mnemopi', 'hindsight', 'sharpshooter'] as const;

interface KnowledgePaneProps {
  sessionId: string;
}

export function KnowledgePane({ sessionId }: KnowledgePaneProps) {
  const skillsQuery = useSessionSkills(sessionId);
  const memoryQuery = useMemory(sessionId);
  const memoryOp = useMemoryOp(sessionId);
  const backend = useSetMemoryBackend(sessionId);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [memoryOutput, setMemoryOutput] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const skills = skillsQuery.data ?? [];
  const selected = skills.find((skill) => skill.name === selectedName) ?? skills[0] ?? null;
  const contentQuery = useSessionSkillContent(sessionId, selected?.name);

  const runOp = (op: Parameters<typeof memoryOp.mutate>[0]['op'], query?: string) => {
    setMemoryNotice(null);
    setMemoryOutput(null);
    memoryOp.mutate(
      { op, ...(query !== undefined && query !== '' ? { query } : {}) },
      {
        onSuccess: (data) => {
          const text = memoryText(data.result);
          if (text !== null) setMemoryOutput(text);
          else setMemoryNotice(`${op}: no payload (backend ${data.backend})`);
        },
      },
    );
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
              <fieldset className="flex flex-wrap items-center gap-1">
                <legend className="text-xs text-[hsl(var(--muted-foreground))]">Backend</legend>
                {MEMORY_BACKENDS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={memoryQuery.data.backend === option ? 'default' : 'outline'}
                    title="Switch backend for this session and re-initialise it"
                    onClick={() =>
                      backend.mutate(option, {
                        onSuccess: () => setMemoryNotice(`Backend set to ${option}.`),
                      })
                    }
                    disabled={backend.isPending}
                    aria-pressed={memoryQuery.data.backend === option}
                  >
                    {option}
                  </Button>
                ))}
              </fieldset>
              {backend.isError && (
                <p className="text-xs text-[hsl(var(--destructive))]">
                  {backend.error instanceof Error
                    ? backend.error.message
                    : 'Backend switch failed.'}
                </p>
              )}
              {(() => {
                const summary = memoryText(memoryQuery.data.status);
                return summary !== null ? (
                  <p className="whitespace-pre-wrap text-[13px]">{summary}</p>
                ) : (
                  <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
                    No status reported by this backend.
                  </p>
                );
              })()}
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ['view', 'View injection'],
                    ['stats', 'Stats'],
                    ['diagnose', 'Diagnose'],
                    ['queue', 'Pending queue'],
                  ] as const
                ).map(([op, label]) => (
                  <Button
                    key={op}
                    size="sm"
                    variant="outline"
                    onClick={() => runOp(op)}
                    disabled={memoryOp.isPending}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runOp('clear')}
                  disabled={memoryOp.isPending}
                  title="Wipe this backend's persisted state"
                >
                  Clear
                </Button>
              </div>
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  runOp('search', searchQuery.trim());
                }}
              >
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search memory (semantic/lexical)"
                  aria-label="Memory search query"
                  className="h-7 flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 font-mono text-xs"
                />
                <Button
                  size="sm"
                  type="submit"
                  disabled={memoryOp.isPending || searchQuery.trim() === ''}
                >
                  Search
                </Button>
              </form>
              {memoryOp.isError && (
                <p className="text-xs text-[hsl(var(--destructive))]">
                  {memoryOp.error instanceof Error ? memoryOp.error.message : 'Memory op failed.'}
                </p>
              )}
              {memoryNotice && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{memoryNotice}</p>
              )}
              {memoryOutput && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px]">
                  {memoryOutput}
                </pre>
              )}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Flush pending memory to the backend now.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runOp('enqueue')}
                  disabled={memoryOp.isPending}
                >
                  <Send />
                  {memoryOp.isPending ? 'Working…' : 'Consolidate now'}
                </Button>
              </div>
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
