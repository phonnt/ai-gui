import { Badge, Button, ErrorState, Input, Skeleton } from '@grove/ui';
import { KeyRound, RotateCcw, Search, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SettingsEntry } from '../../lib/api-client/hooks';
import { usePutSetting, useResetSetting, useSettings } from '../../lib/api-client/hooks';

type ValueKind = 'boolean' | 'number' | 'text' | 'json';

/** Schema-declared enum values render as a chooser instead of a free-text field. */
function optionsOf(entry: SettingsEntry): string[] | null {
  const values: unknown = entry.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.filter((v): v is string => typeof v === 'string');
}

function kindOf(value: unknown): ValueKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  return 'json';
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function Editor({ entry }: { entry: SettingsEntry }) {
  const put = usePutSetting();
  const reset = useResetSetting();
  const kind = kindOf(entry.value);
  const options = optionsOf(entry);
  // Masked entries start empty: the server only returns presence, so saving
  // a prefilled placeholder would overwrite the real secret.
  const [draft, setDraft] = useState<string>(() => (entry.masked ? '' : formatValue(entry.value)));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Sync when the server value changes (other tab, reset, normalization).
  // Notice survives same-key syncs so "Saved." stays visible after refetch.
  const keyRef = useRef(entry.key);
  // biome-ignore lint/correctness/useExhaustiveDependencies: entry identity comes from the list query
  useEffect(() => {
    const keyChanged = keyRef.current !== entry.key;
    keyRef.current = entry.key;
    setDraft(entry.masked ? '' : formatValue(entry.value));
    setError(null);
    if (keyChanged) setNotice(null);
  }, [entry.key, entry.value]);

  const handleSave = () => {
    setError(null);
    setNotice(null);
    let value: unknown = draft;
    try {
      if (kind === 'boolean') {
        if (draft !== 'true' && draft !== 'false') throw new Error('Use true or false.');
        value = draft === 'true';
      } else if (kind === 'number') {
        value = Number(draft);
        if (!Number.isFinite(value)) throw new Error('Enter a finite number.');
      } else if (kind === 'json') {
        value = JSON.parse(draft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid value.');
      return;
    }
    put.mutate(
      { key: entry.key, value },
      {
        onSuccess: () => setNotice('Saved.'),
        onError: (err) => setError(err instanceof Error ? err.message : 'Save failed.'),
      },
    );
  };

  const handleReset = () => {
    setError(null);
    setNotice(null);
    reset.mutate(entry.key, {
      onSuccess: (data) => {
        setDraft(formatValue(data.value));
        setNotice('Reset to default.');
      },
      onError: (err) => setError(err instanceof Error ? err.message : 'Reset failed.'),
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md hairline p-3">
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">{entry.key}</span>
        <Badge variant="outline">{kind}</Badge>
        {entry.masked && <Badge variant="secondary">masked</Badge>}
      </div>
      {entry.masked && (
        <p className="text-xs text-muted-foreground">
          Credential value — the server never returns the secret, only presence.
        </p>
      )}
      {kind === 'boolean' ? (
        <div className="flex items-center gap-2">
          <Button
            variant={draft === 'true' ? 'default' : 'outline'}
            onClick={() => setDraft('true')}
          >
            true
          </Button>
          <Button
            variant={draft === 'false' ? 'default' : 'outline'}
            onClick={() => setDraft('false')}
          >
            false
          </Button>
        </div>
      ) : options ? (
        <div className="flex flex-wrap items-center gap-1">
          {options.map((option) => (
            <Button
              key={option}
              variant={draft === option ? 'default' : 'outline'}
              onClick={() => setDraft(option)}
              aria-pressed={draft === option}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : kind === 'json' ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          spellCheck={false}
          placeholder={entry.masked ? 'Enter new value…' : undefined}
          className="w-full rounded-md bg-background hairline px-2 py-1.5 font-mono text-xs focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring"
        />
      ) : (
        <Input
          value={draft}
          type={kind === 'number' ? 'number' : 'text'}
          placeholder={entry.masked ? 'Enter new value…' : undefined}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {(error || put.isError || reset.isError) && (
        <p className="text-small text-destructive">
          {error ??
            (put.error instanceof Error ? put.error.message : null) ??
            (reset.error instanceof Error ? reset.error.message : null) ??
            'Request failed.'}
        </p>
      )}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={put.isPending || (entry.masked && !draft.trim())}
          title={
            entry.masked && !draft.trim()
              ? 'Enter a new value first — saving empty would clear the secret.'
              : undefined
          }
        >
          {put.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={reset.isPending}>
          <RotateCcw />
          {reset.isPending ? 'Resetting…' : 'Reset'}
        </Button>
      </div>
    </div>
  );
}

export function SettingsPane() {
  const settingsQuery = useSettings();
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const entries = useMemo(() => settingsQuery.data ?? [], [settingsQuery.data]);
  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const entry of entries) seen.add(entry.group);
    return [...seen].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (group !== null && entry.group !== group) return false;
      if (!q) return true;
      return (
        entry.key.toLowerCase().includes(q) ||
        entry.group.toLowerCase().includes(q) ||
        formatValue(entry.value).toLowerCase().includes(q)
      );
    });
  }, [entries, group, search]);

  const selected = entries.find((entry) => entry.key === selectedKey) ?? filtered[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 hairline-b p-3">
        <Settings2 className="size-4" />
        <h3 className="text-[13px] font-semibold">Settings</h3>
        <span className="ml-auto text-xs text-muted-foreground">server cwd scope</span>
      </div>
      <div className="flex items-center gap-2 hairline-b p-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search keys, groups, values…"
          aria-label="Search settings"
        />
      </div>
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1 hairline-b p-2">
          <Button variant={group === null ? 'default' : 'ghost'} onClick={() => setGroup(null)}>
            All
          </Button>
          {groups.map((name) => (
            <Button
              key={name}
              variant={group === name ? 'default' : 'ghost'}
              onClick={() => setGroup(group === name ? null : name)}
              aria-pressed={group === name}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {settingsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {settingsQuery.isError && (
          <ErrorState
            message={
              settingsQuery.error instanceof Error
                ? settingsQuery.error.message
                : 'Failed to load settings.'
            }
            onRetry={() => settingsQuery.refetch()}
          />
        )}
        {settingsQuery.data && filtered.length === 0 && (
          <p className="rounded-md hairline p-4 text-center text-[13px] text-muted-foreground">
            No settings match.
          </p>
        )}
        {filtered.length > 0 && (
          <ul className="mb-3 flex flex-col gap-1">
            {filtered.map((entry) => (
              <li key={entry.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(entry.key)}
                  aria-pressed={selected?.key === entry.key}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] hover:bg-accent ${
                    selected?.key === entry.key ? 'border-ring' : 'border-border'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.key}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.group}</span>
                  {entry.masked && <Badge variant="secondary">masked</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {selected && <Editor entry={selected} />}
      </div>
    </div>
  );
}
