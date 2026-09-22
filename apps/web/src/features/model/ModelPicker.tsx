import { Button, EmptyState, Input, MenuItem, Popover, Skeleton } from '@grove/ui';
import { Brain, Check, ChevronDown, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  useSessionModels,
  useSetSessionModel,
  useSetSessionThinking,
} from '../../lib/api-client/hooks';
import { ProviderIcon } from './ProviderIcon';

const THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'max'];

interface ModelPickerProps {
  sessionId: string;
  onManageProviders?: () => void;
  /** Open dropdowns upward (when embedded in the bottom composer). */
  dropUp?: boolean;
}

export function ModelPicker({ sessionId, onManageProviders, dropUp }: ModelPickerProps) {
  const dropClass = dropUp
    ? 'absolute bottom-full left-0 z-50 mb-1'
    : 'absolute left-0 top-full z-50 mt-1';
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [providerSel, setProviderSel] = useState<string | null>(null);
  const modelsQuery = useSessionModels(sessionId || undefined);
  const setModel = useSetSessionModel(sessionId);
  const setThinking = useSetSessionThinking(sessionId);

  const state = modelsQuery.data;
  const current = state?.current;
  const activeProvider = providerSel ?? current?.provider ?? null;

  const providers = useMemo(() => {
    const set = new Set<string>();
    for (const m of state?.models ?? []) set.add(m.provider);
    return [...set].sort();
  }, [state]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (state?.models ?? []).filter(
      (m) =>
        (activeProvider === null || m.provider === activeProvider) &&
        (!q || `${m.provider}/${m.id}`.toLowerCase().includes(q)),
    );
  }, [state, filter, activeProvider]);

  const error =
    (modelsQuery.error ?? setModel.error ?? setThinking.error)
      ? 'Model switch failed — see details in the panel.'
      : null;

  const pickProvider = (provider: string | null) => {
    setProviderSel(provider);
    setProviderOpen(false);
    setModelOpen(true);
  };

  const pickModel = (provider: string, id: string) => {
    setModelOpen(false);
    setModel.mutate({ provider, modelId: id });
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="relative">
        <Button
          variant="ghost"
          onClick={() => {
            setProviderOpen((v) => !v);
            setModelOpen(false);
          }}
          aria-label={`Provider: ${activeProvider ?? 'all'}`}
          title="Filter by provider"
          className="max-w-40"
        >
          {activeProvider ? (
            <ProviderIcon provider={activeProvider} />
          ) : (
            <Server className="shrink-0" />
          )}
          <span className="truncate font-mono text-small">{activeProvider ?? 'Provider'}</span>
          <ChevronDown className="shrink-0" />
        </Button>
        {providerOpen && (
          <Popover
            open
            label="Provider picker"
            onClose={() => setProviderOpen(false)}
            listbox
            className={`${dropClass} max-h-[50vh] w-56`}
          >
            <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-1">
              <MenuItem onClick={() => pickProvider(null)}>
                <span className="w-4 shrink-0">{activeProvider === null && <Check />}</span>
                <span className="text-small text-muted-foreground">All providers</span>
              </MenuItem>
              {providers.map((p) => (
                <MenuItem key={p} onClick={() => pickProvider(p)}>
                  <span className="w-4 shrink-0">
                    {activeProvider === p && <Check className="size-3.5" />}
                  </span>
                  <ProviderIcon provider={p} />
                  <span className="min-w-0 flex-1 truncate font-mono text-small">{p}</span>
                </MenuItem>
              ))}
              {onManageProviders && (
                <button
                  type="button"
                  onClick={() => {
                    setProviderOpen(false);
                    onManageProviders();
                  }}
                  className="mt-1 flex w-full items-center gap-2 rounded-md panel-plain-t px-2 py-1.5 text-left text-body text-link hover:bg-accent"
                >
                  <span className="w-4 shrink-0" />
                  Manage providers…
                </button>
              )}
            </div>
          </Popover>
        )}
      </div>

      <div className="relative">
        <Button
          variant="ghost"
          onClick={() => {
            setModelOpen((v) => !v);
            setProviderOpen(false);
          }}
          aria-label={`Model: ${current ? `${current.provider}/${current.id}` : 'none'}. Thinking: ${state?.thinking ?? 'default'}`}
          title="Switch model / thinking level"
          className="max-w-72"
        >
          <Brain className="shrink-0" />
          <span className="truncate font-mono text-small">{current?.id ?? 'Model'}</span>
          {state?.thinking && (
            <span className="shrink-0 font-mono text-meta text-muted-foreground">
              · {state.thinking}
            </span>
          )}
          <ChevronDown className="shrink-0" />
        </Button>
        {modelOpen && (
          <Popover
            open
            label="Model picker"
            onClose={() => setModelOpen(false)}
            listbox
            className={`${dropClass} max-h-[60vh] w-80`}
          >
            <div className="hairline-b p-2">
              <Input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter models…"
                aria-label="Filter models"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-1">
              {modelsQuery.isPending && <Skeleton className="h-10 w-full" />}
              {visible.length === 0 && !modelsQuery.isPending && (
                <EmptyState message="No models match." />
              )}
              {visible.map((m) => {
                const active = current?.provider === m.provider && current?.id === m.id;
                return (
                  <MenuItem
                    key={`${m.provider}/${m.id}`}
                    disabled={setModel.isPending}
                    onClick={() => pickModel(m.provider, m.id)}
                    selected={active}
                  >
                    <span className="w-4 shrink-0">{active && <Check className="size-3.5" />}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-small">
                      <span className="text-muted-foreground">{m.provider}/</span>
                      {m.id}
                    </span>
                  </MenuItem>
                );
              })}
            </div>
            <div className="flex items-center gap-1 hairline-t p-2">
              <span className="px-1 text-meta text-muted-foreground">Thinking</span>
              {THINKING_LEVELS.map((level) => (
                <Button
                  key={level}
                  variant={state?.thinking === level ? 'default' : 'ghost'}
                  disabled={setThinking.isPending}
                  onClick={() => setThinking.mutate(level)}
                  aria-pressed={state?.thinking === level}
                >
                  {level}
                </Button>
              ))}
            </div>
            {error && <p className="hairline-t px-2 py-1.5 text-small text-destructive">{error}</p>}
          </Popover>
        )}
      </div>
    </div>
  );
}
