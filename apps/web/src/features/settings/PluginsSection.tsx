import type { InstalledMarketplacePluginDto } from '@grove/protocol';
import { Badge, Button, Segmented, Skeleton } from '@grove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Package, Puzzle } from 'lucide-react';
import { useState } from 'react';
import {
  useExtensions,
  useInstalledMarketplacePlugins,
  useInstallMarketplacePlugin,
  useMarketplacePlugins,
  usePlugins,
  usePluginUpdates,
  useSetMarketplacePluginEnabled,
  useUninstallMarketplacePlugin,
  useUpgradeMarketplacePlugin,
} from '../../lib/api-client/hooks';

type PluginTab = 'installed' | 'browse';

/** Source failure text, or `null` when nothing failed. */
function errorText(...errors: (Error | null)[]): string | null {
  const failed = errors.find((error) => error !== null);
  return failed ? failed.message : null;
}

/**
 * Marketplace and installed plugins (TUI `/plugins`, `/marketplace`). Browse
 * lists what the configured marketplaces offer; Installed owns the lifecycle —
 * enable/disable, uninstall, and upgrading when the catalog moved on.
 */
export function PluginsSection() {
  const [tab, setTab] = useState<PluginTab>('installed');
  const qc = useQueryClient();
  const extensionsQuery = useExtensions();
  const extensions = extensionsQuery.data ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['plugins'] });
    void qc.invalidateQueries({ queryKey: ['marketplace'] });
    void qc.invalidateQueries({ queryKey: ['extensions'] });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Package className="size-3.5 shrink-0 text-muted-foreground" />
          <h4 className="flex-1 section-label">Plugins</h4>
          <Segmented
            aria-label="Plugin view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'installed', label: 'Installed' },
              { value: 'browse', label: 'Browse' },
            ]}
          />
          <Button variant="ghost" onClick={refresh}>
            Refresh
          </Button>
        </div>
        {tab === 'installed' ? <InstalledPluginsTab /> : <BrowsePluginsTab />}
      </div>

      <div className="flex flex-col gap-1.5 hairline-t pt-2">
        <div className="flex items-center gap-2">
          <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />
          <h4 className="flex-1 section-label">Extensions</h4>
          <Button variant="ghost" onClick={() => void extensionsQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {extensionsQuery.isError && (
          <p className="text-small text-destructive">
            {extensionsQuery.error instanceof Error
              ? extensionsQuery.error.message
              : 'Extensions failed.'}
          </p>
        )}
        {extensionsQuery.data && extensions.length === 0 && (
          <p className="text-small text-muted-foreground">
            No extension packages loaded for this workspace.
          </p>
        )}
        {extensions.length > 0 && (
          <ul className="flex flex-col gap-1">
            {extensions.map((extension) => (
              <li
                key={extension.path}
                className="flex items-center gap-2 rounded-md panel-plain px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-small">
                  {extension.name}
                </span>
                <span className="shrink-0 font-mono text-meta text-muted-foreground">
                  {extension.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One installed marketplace plugin: state, update badge, and its actions. */
function InstalledMarketplaceRow({
  plugin,
  updateTo,
  busy,
  onSetEnabled,
  onUninstall,
  onUpgrade,
}: {
  plugin: InstalledMarketplacePluginDto;
  updateTo?: string;
  busy: boolean;
  onSetEnabled: () => void;
  onUninstall: () => void;
  onUpgrade: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md panel-plain px-2 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-small">{plugin.id}</span>
      {plugin.version && (
        <span className="shrink-0 font-mono text-meta text-muted-foreground">{plugin.version}</span>
      )}
      {plugin.scope === 'project' && <Badge variant="outline">project</Badge>}
      <Badge variant={plugin.enabled ? 'secondary' : 'outline'}>
        {plugin.enabled ? 'enabled' : 'disabled'}
      </Badge>
      {updateTo && <Badge variant="info">update {updateTo}</Badge>}
      <span className="flex shrink-0 items-center gap-1">
        {updateTo && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onUpgrade}>
            Upgrade
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={onSetEnabled}>
          {plugin.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="danger" size="sm" disabled={busy} onClick={onUninstall}>
          Uninstall
        </Button>
      </span>
    </li>
  );
}

function InstalledPluginsTab() {
  const installedQuery = useInstalledMarketplacePlugins();
  const updatesQuery = usePluginUpdates();
  const pluginsQuery = usePlugins();
  const setEnabled = useSetMarketplacePluginEnabled();
  const uninstall = useUninstallMarketplacePlugin();
  const upgrade = useUpgradeMarketplacePlugin();

  const installed = installedQuery.data ?? [];
  const updates = updatesQuery.data ?? [];
  const plugins = pluginsQuery.data ?? [];
  // `/api/plugins` already reports marketplace installs; drop exactly the rows
  // the actionable list above owns so nothing renders twice.
  const marketplaceIds = new Set(installed.map((plugin) => plugin.id));
  const others = plugins.filter((plugin) => !marketplaceIds.has(`${plugin.name}@${plugin.source}`));
  const busy = setEnabled.isPending || uninstall.isPending || upgrade.isPending;
  const failure = errorText(
    installedQuery.error,
    updatesQuery.error,
    pluginsQuery.error,
    setEnabled.error,
    uninstall.error,
    upgrade.error,
  );

  return (
    <div className="flex flex-col gap-1.5">
      {installedQuery.isPending && <Skeleton className="h-8 w-full" />}
      {failure && <p className="text-small text-destructive">{failure}</p>}
      {installed.length > 0 && (
        <ul className="flex flex-col gap-1">
          {installed.map((plugin) => {
            const update = updates.find(
              (entry) => entry.pluginId === plugin.id && entry.scope === plugin.scope,
            );
            return (
              <InstalledMarketplaceRow
                key={`${plugin.scope}:${plugin.id}`}
                plugin={plugin}
                updateTo={update?.to}
                busy={busy}
                onSetEnabled={() =>
                  setEnabled.mutate({
                    pluginId: plugin.id,
                    enabled: !plugin.enabled,
                    scope: plugin.scope,
                  })
                }
                onUninstall={() => uninstall.mutate({ pluginId: plugin.id, scope: plugin.scope })}
                onUpgrade={() => upgrade.mutate({ pluginId: plugin.id, scope: plugin.scope })}
              />
            );
          })}
        </ul>
      )}
      {installedQuery.data && installed.length === 0 && (
        <p className="text-small text-muted-foreground">
          No marketplace plugins installed. Browse the marketplaces to add one.
        </p>
      )}
      {others.length > 0 && (
        <ul className="flex flex-col gap-1">
          {others.map((plugin) => (
            <li
              key={`${plugin.source}:${plugin.name}`}
              className="flex items-center gap-2 rounded-md panel-plain px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-small">{plugin.name}</span>
              {plugin.version && (
                <span className="shrink-0 font-mono text-meta text-muted-foreground">
                  {plugin.version}
                </span>
              )}
              <Badge variant={plugin.enabled ? 'secondary' : 'outline'}>
                {plugin.enabled ? 'enabled' : 'disabled'}
              </Badge>
              <span className="shrink-0 font-mono text-meta text-muted-foreground">
                {plugin.source}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrowsePluginsTab() {
  const availableQuery = useMarketplacePlugins();
  const install = useInstallMarketplacePlugin();

  const available = availableQuery.data ?? [];
  const installing = install.isPending ? install.variables : undefined;
  const failure = errorText(availableQuery.error, install.error);

  return (
    <div className="flex flex-col gap-1.5">
      {availableQuery.isPending && <Skeleton className="h-8 w-full" />}
      {failure && <p className="text-small text-destructive">{failure}</p>}
      {availableQuery.data && available.length === 0 && (
        <p className="text-small text-muted-foreground">
          No marketplace plugins to show. Add a source with the OMP CLI (`omp plugin marketplace add
          &lt;source&gt;`), then refresh.
        </p>
      )}
      {available.length > 0 && (
        <ul className="flex flex-col gap-1">
          {available.map((plugin) => {
            const pending =
              installing?.pluginId === plugin.name && installing.marketplace === plugin.marketplace;
            return (
              <li
                key={`${plugin.marketplace}:${plugin.name}`}
                className="flex items-center gap-2 rounded-md panel-plain px-2 py-1"
              >
                <span className="shrink-0 truncate font-mono text-small">{plugin.name}</span>
                {plugin.description && (
                  <span className="min-w-0 flex-1 truncate text-small text-muted-foreground">
                    {plugin.description}
                  </span>
                )}
                {plugin.version && (
                  <span className="shrink-0 font-mono text-meta text-muted-foreground">
                    {plugin.version}
                  </span>
                )}
                <span className="shrink-0 font-mono text-meta text-muted-foreground">
                  {plugin.marketplace}
                </span>
                <Button
                  variant="neutral"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    install.mutate({ pluginId: plugin.name, marketplace: plugin.marketplace })
                  }
                >
                  Install
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
