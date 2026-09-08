import { Button, Input, Skeleton } from '@ai-gui/ui';
import { Brain, Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  useSessionModels,
  useSetSessionModel,
  useSetSessionThinking,
} from '../../lib/api-client/hooks';

const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'max'];

interface ModelPickerProps {
  sessionId: string;
}

export function ModelPicker({ sessionId }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const modelsQuery = useSessionModels(sessionId || undefined);
  const setModel = useSetSessionModel(sessionId);
  const setThinking = useSetSessionThinking(sessionId);

  const state = modelsQuery.data;
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const models = state?.models ?? [];
    const groups = new Map<string, { provider: string; id: string }[]>();
    for (const m of models) {
      if (q && !`${m.provider}/${m.id}`.toLowerCase().includes(q)) continue;
      const list = groups.get(m.provider) ?? [];
      list.push(m);
      groups.set(m.provider, list);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [state, filter]);

  const current = state?.current;
  const label = current ? `${current.provider}/${current.id}` : 'Model';
  const error =
    (modelsQuery.error ?? setModel.error ?? setThinking.error)
      ? 'Model switch failed — see details in the panel.'
      : null;

  const shortLabel = current ? current.id : 'Model';
  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Model: ${label}. Thinking: ${state?.thinking ?? 'default'}`}
        title="Switch model / thinking level"
        className="max-w-72"
      >
        <Brain className="shrink-0" />
        <span className="truncate font-mono text-xs">{shortLabel}</span>
        {state?.thinking && (
          <span className="shrink-0 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">
            · {state.thinking}
          </span>
        )}
        <ChevronDown className="shrink-0" />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Model picker"
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[60vh] w-80 flex-col overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg"
        >
          <div className="border-b border-[hsl(var(--border))] p-2">
            <Input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter provider/model…"
              aria-label="Filter models"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {modelsQuery.isPending && <Skeleton className="h-10 w-full" />}
            {visible.length === 0 && !modelsQuery.isPending && (
              <p className="px-2 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
                No models match.
              </p>
            )}
            {visible.map(([provider, models]) => (
              <div key={provider}>
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  {provider}
                </p>
                {models.map((m) => {
                  const active = current?.provider === m.provider && current?.id === m.id;
                  return (
                    <button
                      key={`${m.provider}/${m.id}`}
                      type="button"
                      disabled={setModel.isPending}
                      onClick={() => {
                        setOpen(false);
                        setModel.mutate({ provider: m.provider, modelId: m.id });
                      }}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-[hsl(var(--accent))] ${
                        active ? 'bg-[hsl(var(--accent))]' : ''
                      }`}
                    >
                      <span className="w-4 shrink-0">
                        {active && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{m.id}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t border-[hsl(var(--border))] p-2">
            <span className="px-1 text-[11px] text-[hsl(var(--muted-foreground))]">Thinking</span>
            {THINKING_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={state?.thinking === level ? 'default' : 'ghost'}
                disabled={setThinking.isPending}
                onClick={() => setThinking.mutate(level)}
                aria-pressed={state?.thinking === level}
              >
                {level}
              </Button>
            ))}
          </div>
          {error && (
            <p className="border-t border-[hsl(var(--border))] px-2 py-1.5 text-xs text-[hsl(var(--destructive))]">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
