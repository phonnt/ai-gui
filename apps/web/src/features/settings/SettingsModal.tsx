import { Button, Input, Skeleton } from '@grove/ui';
import { Settings2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type SettingsEntry, usePutSetting, useSettings } from '../../lib/api-client/hooks';
import { useEscapeToClose } from '../../lib/use-escape-close';

/** TUI tab order (SETTING_TABS): only tabs present in data render. */
const TAB_ORDER = [
  'appearance',
  'model',
  'interaction',
  'context',
  'memory',
  'files',
  'shell',
  'tools',
  'tasks',
  'providers',
  'general',
];

const TAB_LABELS: Record<string, string> = {
  appearance: 'Appearance',
  model: 'Model',
  interaction: 'Interaction',
  context: 'Context',
  memory: 'Memory',
  files: 'Files',
  shell: 'Shell',
  tools: 'Tools',
  tasks: 'Tasks',
  providers: 'Providers',
  general: 'General',
};

function Row({ entry }: { entry: SettingsEntry }) {
  const put = usePutSetting();
  const isBool = typeof entry.value === 'boolean';
  const isStructured = typeof entry.value === 'object' && entry.value !== null && !entry.masked;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = (raw: string) => {
    setError(null);
    // The server only returns presence for secrets, so an empty box means
    // "unchanged" — never wipe a stored credential by saving "".
    if (entry.masked && raw === '') {
      setError('Enter a new value to replace the secret.');
      return;
    }
    let value: unknown = raw;
    try {
      if (isBool) {
        if (raw !== 'true' && raw !== 'false') throw new Error('Use true or false.');
        value = raw === 'true';
      } else if (typeof entry.value === 'number') {
        value = Number(raw);
        if (!Number.isFinite(value)) throw new Error('Enter a finite number.');
      } else if (raw.startsWith('{') || raw.startsWith('[')) {
        value = JSON.parse(raw);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid value.');
      return;
    }
    put.mutate(
      { key: entry.key, value },
      { onError: (e) => setError(e instanceof Error ? e.message : 'Save failed.') },
    );
  };

  const shown =
    draft ??
    (entry.masked ? '' : isStructured ? JSON.stringify(entry.value) : String(entry.value ?? ''));
  const current = entry.masked
    ? ''
    : isStructured
      ? JSON.stringify(entry.value)
      : String(entry.value ?? '');

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[hsl(var(--accent))]">
      <div className="min-w-0 flex-1" title={entry.description ?? entry.key}>
        <p className="truncate text-[13px] font-medium">{entry.label}</p>
        <p className="truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
          {entry.key}
        </p>
        {error && <p className="text-[11px] text-[hsl(var(--destructive))]">{error}</p>}
      </div>
      {entry.masked && (
        <span className="shrink-0 rounded-md bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          masked
        </span>
      )}
      {isBool ? (
        <Button
          size="sm"
          variant={entry.value ? 'default' : 'outline'}
          disabled={put.isPending}
          onClick={() => save(entry.value ? 'false' : 'true')}
          aria-pressed={entry.value === true}
          aria-label={entry.label}
        >
          {entry.value ? 'On' : 'Off'}
        </Button>
      ) : entry.values && entry.values.length > 0 ? (
        <select
          value={current}
          disabled={put.isPending}
          onChange={(e) => save(e.target.value)}
          aria-label={entry.label}
          className="h-7 max-w-44 truncate rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
        >
          {!entry.values.includes(current) && <option value={current}>{current || '—'}</option>}
          {entry.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : isStructured ? (
        <textarea
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(shown);
          }}
          placeholder="JSON value (⌘+Enter to save)"
          aria-label={entry.label}
          rows={2}
          className="w-64 resize-y rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--ring))]"
        />
      ) : (
        <Input
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save(shown);
          }}
          placeholder={entry.masked ? 'set secret…' : 'value'}
          aria-label={entry.label}
          className="h-7 w-44 font-mono text-xs"
        />
      )}
    </div>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEscapeToClose(open, onClose);
  const settingsQuery = useSettings();
  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const tabs = useMemo(() => {
    const present = new Set((settingsQuery.data ?? []).map((e) => e.tab));
    return TAB_ORDER.filter((t) => present.has(t));
  }, [settingsQuery.data]);
  const active = tab && tabs.includes(tab) ? tab : (tabs[0] ?? null);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, SettingsEntry[]>();
    for (const e of settingsQuery.data ?? []) {
      if (e.tab !== active) continue;
      if (
        q &&
        !e.key.toLowerCase().includes(q) &&
        !e.label.toLowerCase().includes(q) &&
        !String(e.value ?? '')
          .toLowerCase()
          .includes(q)
      ) {
        continue;
      }
      const list = map.get(e.group) ?? [];
      list.push(e);
      map.set(e.group, list);
    }
    return [...map.entries()];
  }, [settingsQuery.data, active, filter]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 bg-[hsl(var(--overlay)/var(--overlay-alpha))]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative flex h-[85vh] w-full max-w-5xl overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl"
      >
        <div className="flex w-44 shrink-0 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--background))]">
          <p className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[13px] font-semibold">
            <Settings2 className="size-4" />
            Settings
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={active === t}
                className={`w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))] ${
                  active === t ? 'bg-[hsl(var(--accent))]' : ''
                }`}
              >
                {TAB_LABELS[t] ?? t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] p-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter settings…"
              aria-label="Filter settings"
              className="h-8"
            />
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close settings">
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {settingsQuery.isPending && <Skeleton className="h-10 w-full" />}
            {settingsQuery.isError && (
              <p className="p-3 text-xs text-[hsl(var(--destructive))]">Failed to load settings.</p>
            )}
            {groups.length === 0 && !settingsQuery.isPending && (
              <p className="p-3 text-xs text-[hsl(var(--muted-foreground))]">No settings match.</p>
            )}
            {groups.map(([group, entries]) => (
              <section key={group} className="mb-2">
                <h3 className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  {group}
                </h3>
                {entries.map((e) => (
                  <Row key={e.key} entry={e} />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
