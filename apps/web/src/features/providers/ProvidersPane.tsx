import { Badge, Button, Input, Skeleton } from '@grove/ui';
import { Boxes, Search, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useModels, useProviders } from '../../lib/api-client/hooks';
import { useEscapeToClose } from '../../lib/use-escape-close';
import { ProviderIcon } from '../model/ProviderIcon';

function AvailabilityDot({ available }: { available: boolean }) {
  return (
    <span
      role="img"
      aria-label={available ? 'available' : 'unavailable'}
      title={available ? 'available' : 'unavailable'}
      className={`inline-block size-2 rounded-full ${
        available ? 'bg-[hsl(var(--success))]' : 'bg-[hsl(var(--muted-foreground))]'
      }`}
    />
  );
}

export function ProvidersPane() {
  const providersQuery = useProviders();
  const modelsQuery = useModels();
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [connectId, setConnectId] = useState<string | null>(null);
  useEscapeToClose(connectId !== null, () => setConnectId(null));
  const [copied, setCopied] = useState(false);

  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);

  const providerIds = useMemo(() => {
    const seen = new Set<string>();
    for (const model of models) seen.add(model.provider);
    for (const provider of providers) seen.add(provider.id);
    return [...seen].sort();
  }, [models, providers]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return models.filter((model) => {
      if (providerFilter !== null && model.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        model.id.toLowerCase().includes(q) ||
        model.provider.toLowerCase().includes(q) ||
        model.source.toLowerCase().includes(q)
      );
    });
  }, [models, providerFilter, search]);

  // The model catalog is ~500 kB and can take seconds to arrive: render the
  // provider table as soon as it lands instead of holding the whole pane behind
  // the model list (which showed a full-pane skeleton for ~5s).
  const providersPending = providersQuery.isPending;
  const modelsPending = modelsQuery.isPending;
  const nothingYet = providersPending && modelsPending;
  const bothFailed = providersQuery.isError && modelsQuery.isError;
  const errorMessage =
    (providersQuery.error instanceof Error ? providersQuery.error.message : null) ??
    (modelsQuery.error instanceof Error ? modelsQuery.error.message : null) ??
    'Failed to load providers or models.';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] p-3">
        <Server className="size-4" />
        <h3 className="text-[13px] font-semibold">Providers & Models</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {nothingYet && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {bothFailed && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
            <p className="text-xs text-[hsl(var(--destructive))]">{errorMessage}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void providersQuery.refetch();
                void modelsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {!nothingYet && !bothFailed && (
          <div className="flex flex-col gap-4">
            <section>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Providers
              </h4>
              {providersPending ? (
                <Skeleton className="h-24 w-full" />
              ) : providers.length === 0 ? (
                <p className="rounded-md border border-[hsl(var(--border))] p-3 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
                  No providers reported.
                </p>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">ID</th>
                      <th className="px-2 py-1">Auth</th>
                      <th className="px-2 py-1 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((provider) => (
                      <tr key={provider.id} className="border-t border-[hsl(var(--border))]">
                        <td className="px-2 py-1.5">
                          <AvailabilityDot available={provider.available} />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs">
                          <span className="flex items-center gap-2">
                            <ProviderIcon provider={provider.id} />
                            {provider.id}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant={provider.available ? 'default' : 'outline'}>
                            {provider.auth}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {!provider.available && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setCopied(false);
                                setConnectId(provider.id);
                              }}
                            >
                              Connect
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                <Boxes className="size-3.5" />
                Models
              </h4>
              <div className="mb-2 flex items-center gap-2">
                <Search className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models…"
                  aria-label="Search models"
                />
              </div>
              {providerIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant={providerFilter === null ? 'default' : 'ghost'}
                    onClick={() => setProviderFilter(null)}
                  >
                    All
                  </Button>
                  {providerIds.map((id) => (
                    <Button
                      key={id}
                      size="sm"
                      variant={providerFilter === id ? 'default' : 'ghost'}
                      onClick={() => setProviderFilter(providerFilter === id ? null : id)}
                      aria-pressed={providerFilter === id}
                    >
                      {id}
                    </Button>
                  ))}
                </div>
              )}
              {modelsPending ? (
                <Skeleton className="h-24 w-full" />
              ) : filteredModels.length === 0 ? (
                <p className="rounded-md border border-[hsl(var(--border))] p-3 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
                  No models match.
                </p>
              ) : (
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Model</th>
                      <th className="px-2 py-1">Provider</th>
                      <th className="px-2 py-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.map((model) => (
                      <tr
                        key={`${model.provider}/${model.id}`}
                        className="border-t border-[hsl(var(--border))]"
                      >
                        <td className="px-2 py-1.5">
                          <AvailabilityDot available={model.available} />
                        </td>
                        <td className="max-w-48 truncate px-2 py-1.5 font-mono text-xs">
                          {model.id}
                        </td>
                        <td className="px-2 py-1.5 text-xs">{model.provider}</td>
                        <td className="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                          {model.source}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
      {connectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close connect dialog"
            onClick={() => setConnectId(null)}
            className="absolute inset-0 bg-[hsl(var(--overlay)/var(--overlay-alpha))]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Connect ${connectId}`}
            className="relative flex w-full max-w-md flex-col gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-2xl"
          >
            <div className="flex items-center gap-2">
              <ProviderIcon provider={connectId} />
              <h3 className="text-sm font-semibold">Connect {connectId}</h3>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              OAuth sign-in opens in your browser. Run the login in a terminal, complete the browser
              step, then come back and hit Refresh — in-web OAuth is not supported yet.
            </p>
            <code className="rounded-md bg-[hsl(var(--muted))] px-2 py-1.5 font-mono text-xs">
              omp login {connectId}
            </code>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(`omp login ${connectId}`)
                    .then(() => {
                      setCopied(true);
                    })
                    .catch(() => {
                      /* clipboard blocked: user copies manually */
                    });
                }}
              >
                {copied ? 'Copied' : 'Copy command'}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setConnectId(null);
                  void providersQuery.refetch();
                  void modelsQuery.refetch();
                }}
              >
                I authorized — Refresh
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
