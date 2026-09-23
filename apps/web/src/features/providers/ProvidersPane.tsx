import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  StatusDot,
  useEscapeToClose,
} from '@grove/ui';
import { Boxes, Search, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useModels, useProviderLogout, useProviders } from '../../lib/api-client/hooks';
import { ProviderIcon } from '../model/ProviderIcon';
import { ProviderLoginDialog } from './ProviderLoginDialog';

function AvailabilityDot({ available }: { available: boolean }) {
  return (
    <StatusDot
      label={available ? 'available' : 'unavailable'}
      tone={available ? 'success' : 'muted'}
    />
  );
}

export function ProvidersPane() {
  const providersQuery = useProviders();
  const modelsQuery = useModels();
  const logout = useProviderLogout();
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [logoutId, setLogoutId] = useState<string | null>(null);
  useEscapeToClose(logoutId !== null, () => setLogoutId(null));

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
      <div className="flex items-center gap-1.5 hairline-b p-3">
        <Server className="size-4" />
        <h3 className="text-body font-strong">Providers & Models</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        {nothingYet && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {bothFailed && (
          <ErrorState
            message={errorMessage}
            onRetry={() => {
              void providersQuery.refetch();
              void modelsQuery.refetch();
            }}
          />
        )}
        {!nothingYet && !bothFailed && (
          <div className="flex flex-col gap-4">
            <section>
              <h4 className="mb-1.5 section-label">Providers</h4>
              {providersPending ? (
                <Skeleton className="h-24 w-full" />
              ) : providers.length === 0 ? (
                <EmptyState message="No providers reported." />
              ) : (
                <table className="w-full border-collapse text-body">
                  <thead>
                    <tr className="text-left text-meta uppercase text-muted-foreground">
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">ID</th>
                      <th className="px-2 py-1">Auth</th>
                      <th className="px-2 py-1 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((provider) => (
                      <tr key={provider.id} className="hairline-t">
                        <td className="px-2 py-1.5">
                          <AvailabilityDot available={provider.available} />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-small">
                          <span className="flex items-center gap-2">
                            <ProviderIcon provider={provider.id} />
                            {provider.id}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant={provider.available ? 'neutral' : 'outline'}>
                            {provider.auth}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {provider.login && provider.auth !== 'oauth' && (
                            <Button
                              variant="outline"
                              aria-label={`Login ${provider.id}`}
                              onClick={() => setLoginId(provider.id)}
                            >
                              Login
                            </Button>
                          )}
                          {provider.login && provider.auth === 'oauth' && (
                            <Button
                              variant="outline"
                              aria-label={`Logout ${provider.id}`}
                              disabled={logout.isPending}
                              onClick={() => setLogoutId(provider.id)}
                            >
                              Logout
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
              <h4 className="mb-1.5 flex items-center gap-1.5 section-label">
                <Boxes className="size-3.5" />
                Models
              </h4>
              <div className="mb-2 flex items-center gap-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
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
                    variant={providerFilter === null ? 'default' : 'ghost'}
                    onClick={() => setProviderFilter(null)}
                  >
                    All
                  </Button>
                  {providerIds.map((id) => (
                    <Button
                      key={id}
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
                <EmptyState message="No models match." />
              ) : (
                <table className="w-full border-collapse text-body">
                  <thead>
                    <tr className="text-left text-meta uppercase text-muted-foreground">
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Model</th>
                      <th className="px-2 py-1">Provider</th>
                      <th className="px-2 py-1">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredModels.map((model) => (
                      <tr key={`${model.provider}/${model.id}`} className="hairline-t">
                        <td className="px-2 py-1.5">
                          <AvailabilityDot available={model.available} />
                        </td>
                        <td className="max-w-48 truncate px-2 py-1.5 font-mono text-small">
                          {model.id}
                        </td>
                        <td className="px-2 py-1.5 text-small">{model.provider}</td>
                        <td className="px-2 py-1.5 text-small text-muted-foreground">
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
      {loginId && <ProviderLoginDialog providerId={loginId} onClose={() => setLoginId(null)} />}
      {logoutId && (
        <Dialog
          open
          onClose={() => setLogoutId(null)}
          label={`Sign out of ${logoutId}`}
          className="gap-3 p-4"
        >
          <div className="flex items-center gap-2">
            <ProviderIcon provider={logoutId} />
            <h3 className="text-title font-strong">Sign out of {logoutId}</h3>
          </div>
          <p className="text-body text-muted-foreground">
            Removes the stored credential for this provider. Models that need it go back to
            unavailable.
          </p>
          {logout.isError && <ErrorState message={logout.error.message} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLogoutId(null)}>
              Keep
            </Button>
            <Button
              disabled={logout.isPending}
              onClick={() => {
                logout.mutate(logoutId, { onSuccess: () => setLogoutId(null) });
              }}
            >
              Sign out
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
