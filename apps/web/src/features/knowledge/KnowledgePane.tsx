import { Badge, Button, EmptyState, ErrorState, Panel, Skeleton } from '@grove/ui';
import { BookOpen, Brain, MemoryStick, Send } from 'lucide-react';
import { useState } from 'react';
import {
  useMemory,
  useMemoryOp,
  useSessionSkillContent,
  useSessionSkills,
  useSetMemoryBackend,
} from '../../lib/api-client/hooks';
import { memoryText, readFile } from '../../lib/api-client/rest';

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
  const [mmId, setMmId] = useState('');

  const skills = skillsQuery.data ?? [];
  const selected = skills.find((skill) => skill.name === selectedName) ?? skills[0] ?? null;
  const contentQuery = useSessionSkillContent(sessionId, selected?.name);

  /** Read a session-memory file (`memory://` resolves inside the SDK). */
  const openMemoryFile = async (path: string) => {
    setMemoryNotice(null);
    setMemoryOutput(null);
    const result = await readFile(sessionId, path);
    if (result.ok) setMemoryOutput(result.data.text ?? '');
    else setMemoryNotice(result.error);
  };

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
      <div className="flex items-center gap-1.5 hairline-b p-3">
        <BookOpen className="size-4" />
        <h3 className="text-body font-strong">Knowledge</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        <section className="mb-4">
          <h4 className="mb-1.5 flex items-center gap-1.5 section-label">
            <MemoryStick className="size-3.5" />
            Memory
          </h4>
          {memoryQuery.isPending && <Skeleton className="h-16 w-full" />}
          {memoryQuery.isError && (
            <ErrorState
              message={
                memoryQuery.error instanceof Error
                  ? memoryQuery.error.message
                  : 'Failed to load memory.'
              }
              onRetry={() => memoryQuery.refetch()}
            />
          )}
          {memoryQuery.data && (
            <Panel tone="plain" className="flex flex-col gap-2 p-3">
              <fieldset className="flex flex-wrap items-center gap-1">
                <legend className="text-small text-muted-foreground">Backend</legend>
                {MEMORY_BACKENDS.map((option) => (
                  <Button
                    key={option}
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
                <p className="text-small text-destructive">
                  {backend.error instanceof Error
                    ? backend.error.message
                    : 'Backend switch failed.'}
                </p>
              )}
              {(() => {
                const summary = memoryText(memoryQuery.data.status);
                return summary !== null ? (
                  <p className="whitespace-pre-wrap text-body">{summary}</p>
                ) : (
                  <p className="text-body text-muted-foreground">
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
                    variant="outline"
                    onClick={() => runOp(op)}
                    disabled={memoryOp.isPending}
                  >
                    {label}
                  </Button>
                ))}
                <Button
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
                  className="h-7 flex-1 rounded-md panel-inset px-2 font-mono text-small"
                />
                <Button type="submit" disabled={memoryOp.isPending || searchQuery.trim() === ''}>
                  Search
                </Button>
              </form>
              {memoryOp.isError && (
                <p className="text-small text-destructive">
                  {memoryOp.error instanceof Error ? memoryOp.error.message : 'Memory op failed.'}
                </p>
              )}
              {memoryNotice && <p className="text-small text-muted-foreground">{memoryNotice}</p>}
              <div className="flex flex-wrap items-center gap-1 hairline-t pt-2">
                <span className="text-meta uppercase text-muted-foreground">Memory files</span>
                {(
                  [
                    ['memory://root', 'summary'],
                    ['memory://root/MEMORY.md', 'MEMORY.md'],
                    ['memory://root/learned.md', 'learned.md'],
                  ] as const
                ).map(([path, label]) => (
                  <Button
                    key={path}
                    variant="outline"
                    onClick={() => void openMemoryFile(path)}
                    title={path}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {memoryQuery.data.backend === 'hindsight' && (
                <div className="flex flex-wrap items-center gap-1 hairline-t pt-2">
                  <span className="text-meta uppercase text-muted-foreground">Mental models</span>
                  <Button
                    variant="outline"
                    onClick={() => runOp('mm-list')}
                    disabled={memoryOp.isPending}
                  >
                    List
                  </Button>
                  <input
                    value={mmId}
                    onChange={(e) => setMmId(e.target.value)}
                    placeholder="id"
                    aria-label="Mental model id"
                    className="h-7 w-32 rounded-md panel-inset px-2 font-mono text-small"
                  />
                  <Button
                    variant="outline"
                    onClick={() => runOp('mm-show', mmId.trim())}
                    disabled={memoryOp.isPending || mmId.trim() === ''}
                  >
                    Show
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => runOp('mm-history', mmId.trim())}
                    disabled={memoryOp.isPending || mmId.trim() === ''}
                  >
                    History
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => runOp('mm-refresh', mmId.trim())}
                    disabled={memoryOp.isPending || mmId.trim() === ''}
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => runOp('mm-delete', mmId.trim())}
                    disabled={memoryOp.isPending || mmId.trim() === ''}
                  >
                    Delete
                  </Button>
                </div>
              )}
              {memoryOutput && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md panel-inset p-2 font-mono text-meta">
                  {memoryOutput}
                </pre>
              )}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-small text-muted-foreground">
                  Flush pending memory to the backend now.
                </span>
                <Button
                  variant="outline"
                  onClick={() => runOp('enqueue')}
                  disabled={memoryOp.isPending}
                >
                  <Send />
                  {memoryOp.isPending ? 'Working…' : 'Consolidate now'}
                </Button>
              </div>
            </Panel>
          )}
        </section>
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 section-label">
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
            <ErrorState
              message={
                skillsQuery.error instanceof Error
                  ? skillsQuery.error.message
                  : 'Failed to load skills.'
              }
              onRetry={() => skillsQuery.refetch()}
            />
          )}
          {skillsQuery.data && skills.length === 0 && <EmptyState message="No skills available." />}
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
                      className={`flex w-full flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left hover:bg-accent ${
                        active ? 'border-ring' : 'border-border'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-small font-strong">
                          {skill.name}
                        </span>
                        <Badge variant="outline">{skill.source}</Badge>
                      </span>
                      {skill.description && (
                        <span className="truncate text-small text-muted-foreground">
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
            <Panel tone="plain" className="mt-3 flex flex-col gap-2 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <BookOpen className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-small font-strong">
                  {selected.name}
                </span>
              </div>
              {contentQuery.isPending && <Skeleton className="h-24 w-full" />}
              {contentQuery.isError && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <p className="text-small text-destructive">
                    {contentQuery.error instanceof Error
                      ? contentQuery.error.message
                      : 'Failed to load skill preview.'}
                  </p>
                  <Button variant="outline" onClick={() => contentQuery.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {contentQuery.data && (
                <pre className="max-h-64 overflow-y-auto scroll-area whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-small">
                  {contentQuery.data.content}
                </pre>
              )}
            </Panel>
          )}
        </section>
      </div>
    </div>
  );
}
