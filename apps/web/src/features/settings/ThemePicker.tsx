import { Badge, Button, Input, Skeleton } from '@grove/ui';
import { Check, Palette } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApplyTheme, useThemes } from '../../lib/api-client/hooks';
export function ThemePicker() {
  const themesQuery = useThemes();
  const apply = useApplyTheme();

  const themes = themesQuery.data?.themes ?? [];
  const current = themesQuery.data?.current;
  const [slot, setSlot] = useState<'dark' | 'light'>('dark');
  const dark = themesQuery.data?.dark ?? '';
  const light = themesQuery.data?.light ?? '';
  const slotValue = slot === 'dark' ? dark : light;
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter((t) => t.name.toLowerCase().includes(q));
  }, [themes, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] p-3">
        <Palette className="size-4" />
        <h3 className="text-[13px] font-semibold">Themes</h3>
        <fieldset className="ml-auto flex items-center gap-1">
          <legend className="sr-only">Theme slot</legend>
          {(['dark', 'light'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={slot === option ? 'default' : 'outline'}
              onClick={() => setSlot(option)}
              aria-pressed={slot === option}
              title={`Edit the ${option} theme slot (TUI keeps both)`}
            >
              {option}
            </Button>
          ))}
        </fieldset>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter themes…"
            aria-label="Filter themes"
          />
        </div>
        {themesQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {themesQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
            <p className="text-xs text-[hsl(var(--destructive))]">
              {themesQuery.error instanceof Error
                ? themesQuery.error.message
                : 'Failed to load themes.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => themesQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {themesQuery.data && themes.length === 0 && (
          <p className="rounded-md border border-[hsl(var(--border))] p-4 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
            No themes available.
          </p>
        )}
        {themes.length > 0 && visible.length === 0 && (
          <p className="rounded-md border border-[hsl(var(--border))] p-4 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
            No themes match.
          </p>
        )}
        {visible.length > 0 && (
          <ul className="grid grid-cols-2 gap-2">
            {visible.map((theme) => {
              const active = theme.name === slotValue;
              return (
                <li key={theme.name}>
                  <button
                    type="button"
                    onClick={() => apply.mutate({ name: theme.name, slot })}
                    disabled={apply.isPending || theme.name === slotValue}
                    aria-pressed={active}
                    className={`flex w-full flex-col gap-1.5 rounded-md border p-3 text-left hover:bg-[hsl(var(--accent))] disabled:cursor-default ${
                      active ? 'border-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      {active && <Check className="size-3.5" />}
                      <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                    </span>
                    {active && <Badge variant="default">{slot} slot</Badge>}
                    {!active && theme.name === current && (
                      <Badge variant="secondary">active now</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {(apply.isError || apply.error) && (
          <p className="mt-2 text-xs text-[hsl(var(--destructive))]">
            {apply.error instanceof Error ? apply.error.message : 'Apply failed.'}
          </p>
        )}
      </div>
    </div>
  );
}
