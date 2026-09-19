import { Button, Input } from '@ai-gui/ui';
import { CheckCircle2, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useSpawnHubAgent } from '../../lib/api-client/hooks';

interface SpawnWizardProps {
  sessionId: string;
  onSpawned?: (agentId: string) => void;
}

const textareaClassName =
  'flex min-h-20 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-[13px] placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50';

export function SpawnWizard({ sessionId, onSpawned }: SpawnWizardProps) {
  const spawn = useSpawnHubAgent();
  const [agent, setAgent] = useState('');
  const [task, setTask] = useState('');
  const [context, setContext] = useState('');
  const [outputSchema, setOutputSchema] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<'' | 'lo' | 'med' | 'hi'>('');
  const [strict, setStrict] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [detached, setDetached] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [spawnedId, setSpawnedId] = useState<string | null>(null);

  const handleSpawn = () => {
    setFormError(null);
    if (task.trim().length === 0) {
      setFormError('Task is required.');
      return;
    }
    let parsedSchema: unknown;
    if (outputSchema.trim().length > 0) {
      try {
        parsedSchema = JSON.parse(outputSchema) as unknown;
      } catch {
        setFormError('Output schema must be valid JSON.');
        return;
      }
    }
    spawn.mutate(
      {
        sessionId,
        agent: agent.trim().length > 0 ? agent.trim() : undefined,
        task: task.trim(),
        context: context.trim().length > 0 ? context.trim() : undefined,
        outputSchema: parsedSchema,
        ...(parsedSchema !== undefined ? { schemaMode: strict ? 'strict' : 'permissive' } : {}),
        ...(model.trim().length > 0 ? { model: model.trim() } : {}),
        ...(effort !== '' ? { effort } : {}),
        ...(isolated ? { isolation: { requested: true } } : {}),
        ...(detached ? { detached: true } : {}),
      },
      {
        onSuccess: (data) => {
          setSpawnedId(data.agentId);
          setAgent('');
          setTask('');
          setContext('');
          setOutputSchema('');
          setModel('');
          setEffort('');
          setStrict(false);
          setIsolated(false);
          setDetached(false);
          setFormError(null);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] p-3">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Rocket />
        Spawn agent
      </h3>
      <Input
        value={agent}
        onChange={(e) => setAgent(e.target.value)}
        placeholder="agent (empty = default)"
        aria-label="Agent"
      />
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder="task (required)"
        aria-label="Task"
        className={textareaClassName}
      />
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="context (optional)"
        aria-label="Context"
        className={textareaClassName}
      />
      <textarea
        value={outputSchema}
        onChange={(e) => setOutputSchema(e.target.value)}
        placeholder='output schema as JSON (optional, e.g. {"type": "object"})'
        aria-label="Output schema"
        spellCheck={false}
        className={`${textareaClassName} font-mono text-xs`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model / role (optional)"
          aria-label="Subagent model override"
          className="h-7 w-48 text-xs"
        />
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Thinking effort</legend>
          {(['lo', 'med', 'hi'] as const).map((level) => (
            <Button
              key={level}
              size="sm"
              variant={effort === level ? 'default' : 'outline'}
              onClick={() => setEffort((prev) => (prev === level ? '' : level))}
              aria-pressed={effort === level}
              title={`Thinking effort: ${level}`}
            >
              {level}
            </Button>
          ))}
        </fieldset>
        <Button
          size="sm"
          variant={strict ? 'default' : 'outline'}
          onClick={() => setStrict((v) => !v)}
          disabled={outputSchema.trim().length === 0}
          aria-pressed={strict}
          title="Reject results that violate the output schema instead of repairing them"
        >
          Strict schema
        </Button>
        <Button
          size="sm"
          variant={isolated ? 'default' : 'outline'}
          onClick={() => setIsolated((v) => !v)}
          aria-pressed={isolated}
          title="Run in an isolated worktree"
        >
          Isolated
        </Button>
        <Button
          size="sm"
          variant={detached ? 'default' : 'outline'}
          onClick={() => setDetached((v) => !v)}
          aria-pressed={detached}
          title="Return immediately and run in the background"
        >
          Detached
        </Button>
      </div>
      <Button size="sm" onClick={handleSpawn} disabled={spawn.isPending}>
        <Rocket />
        {spawn.isPending ? 'Spawning…' : 'Spawn'}
      </Button>
      {(formError || spawn.isError) && (
        <p className="text-xs text-[hsl(var(--destructive))]">
          {formError ?? (spawn.error instanceof Error ? spawn.error.message : 'Spawn failed.')}
        </p>
      )}
      {spawnedId && (
        <div className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2">
          <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            <CheckCircle2 />
            Spawned agent
            <code className="rounded-md bg-[hsl(var(--muted))] px-1 font-mono">{spawnedId}</code>
          </p>
          {onSpawned && (
            <Button size="sm" variant="outline" onClick={() => onSpawned(spawnedId)}>
              View in roster
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
