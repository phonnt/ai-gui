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
      },
      {
        onSuccess: (data) => setSpawnedId(data.agentId),
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
