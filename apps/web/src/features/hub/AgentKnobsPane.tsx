import { Badge, Button, Input, Skeleton } from '@ai-gui/ui';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePutSetting, useSettings } from '../../lib/api-client/hooks';

/** Per-agent knob records the TUI exposes (task tab). */
const KNOBS = [
  {
    key: 'task.agentModelOverrides',
    label: 'Model override',
    hint: 'provider/model per agent name',
  },
  { key: 'task.agentPrewalk', label: 'Prewalk', hint: 'agent names that prewalk' },
  { key: 'task.agentAdvisor', label: 'Advisor', hint: 'agent names that run an advisor' },
] as const;

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Editors for the per-agent knob records. The TUI stores them as settings
 * maps keyed by agent name, so the same keys are editable here without a
 * separate transport.
 */
export function AgentKnobsPane() {
  const settingsQuery = useSettings();
  const put = usePutSetting();
  const [drafts, setDrafts] = useState<Record<string, { name: string; value: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const entries = settingsQuery.data ?? [];
  const save = (key: string, next: Record<string, string>) => {
    setError(null);
    put.mutate(
      { key, value: next },
      { onError: (err) => setError(err instanceof Error ? err.message : 'Save failed.') },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] px-3 py-2">
        <SlidersHorizontal className="size-4" />
        <h2 className="text-[13px] font-semibold">Per-agent settings</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {settingsQuery.isPending && <Skeleton className="h-32 w-full" />}
        {settingsQuery.isError && (
          <p className="text-xs text-[hsl(var(--destructive))]">Failed to load settings.</p>
        )}
        <div className="flex flex-col gap-4">
          {KNOBS.map(({ key, label, hint }) => {
            const entry = entries.find((e) => e.key === key);
            const current = asRecord(entry?.value);
            const draft = drafts[key] ?? { name: '', value: '' };
            return (
              <section
                key={key}
                className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{label}</span>
                  <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {key}
                  </span>
                  <Badge variant="outline" className="ml-auto">
                    {Object.keys(current).length}
                  </Badge>
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>
                <ul className="flex flex-col gap-1">
                  {Object.entries(current).map(([name, value]) => (
                    <li key={name} className="flex items-center gap-2 font-mono text-xs">
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="min-w-0 flex-1 truncate text-[hsl(var(--muted-foreground))]">
                        {value || '(enabled)'}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${name} from ${label}`}
                        disabled={put.isPending}
                        onClick={() => {
                          const next = { ...current };
                          delete next[name];
                          save(key, next);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                  {Object.keys(current).length === 0 && (
                    <li className="text-xs text-[hsl(var(--muted-foreground))]">No entries.</li>
                  )}
                </ul>
                <div className="flex gap-1">
                  <Input
                    value={draft.name}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [key]: { ...draft, name: e.target.value } }))
                    }
                    placeholder="agent name"
                    aria-label={`Agent name for ${label}`}
                    className="h-7 text-xs"
                  />
                  <Input
                    value={draft.value}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [key]: { ...draft, value: e.target.value } }))
                    }
                    placeholder="value (empty = enabled)"
                    aria-label={`Value for ${label}`}
                    className="h-7 text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={put.isPending || draft.name.trim() === ''}
                    onClick={() => {
                      const name = draft.name.trim();
                      save(key, { ...current, [name]: draft.value.trim() });
                      setDrafts((prev) => ({ ...prev, [key]: { name: '', value: '' } }));
                    }}
                  >
                    Add
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
        {error && <p className="pt-2 text-xs text-[hsl(var(--destructive))]">{error}</p>}
      </div>
    </div>
  );
}
