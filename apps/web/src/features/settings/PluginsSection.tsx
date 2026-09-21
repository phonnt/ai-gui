import { Badge, Button, Skeleton } from '@grove/ui';
import { Package, Puzzle } from 'lucide-react';
import { useExtensions, usePlugins } from '../../lib/api-client/hooks';

/**
 * Installed plugins and loaded extension packages (TUI `/plugins list` and
 * `/extensions`). Read-only by design: installing/enabling runs the SDK's own
 * CLI flow, which the web cannot drive without a package manager TTY.
 */
export function PluginsSection() {
  const pluginsQuery = usePlugins();
  const extensionsQuery = useExtensions();

  const plugins = pluginsQuery.data ?? [];
  const extensions = extensionsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Package className="size-3.5 shrink-0 text-muted-foreground" />
          <h4 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plugins
          </h4>
          <Button size="sm" variant="ghost" onClick={() => void pluginsQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {pluginsQuery.isPending && <Skeleton className="h-8 w-full" />}
        {pluginsQuery.isError && (
          <p className="text-xs text-destructive">
            {pluginsQuery.error instanceof Error ? pluginsQuery.error.message : 'Plugins failed.'}
          </p>
        )}
        {pluginsQuery.data && plugins.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No plugins installed. Install with the OMP CLI (`omp plugins install …`).
          </p>
        )}
        {plugins.length > 0 && (
          <ul className="flex flex-col gap-1">
            {plugins.map((plugin) => (
              <li
                key={`${plugin.source}:${plugin.name}`}
                className="flex items-center gap-2 rounded-md hairline px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{plugin.name}</span>
                {plugin.version && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {plugin.version}
                  </span>
                )}
                <Badge variant={plugin.enabled ? 'secondary' : 'outline'}>
                  {plugin.enabled ? 'enabled' : 'disabled'}
                </Badge>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {plugin.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5 hairline-t pt-2">
        <div className="flex items-center gap-2">
          <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />
          <h4 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Extensions
          </h4>
          <Button size="sm" variant="ghost" onClick={() => void extensionsQuery.refetch()}>
            Refresh
          </Button>
        </div>
        {extensionsQuery.isError && (
          <p className="text-xs text-destructive">
            {extensionsQuery.error instanceof Error
              ? extensionsQuery.error.message
              : 'Extensions failed.'}
          </p>
        )}
        {extensionsQuery.data && extensions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No extension packages loaded for this workspace.
          </p>
        )}
        {extensions.length > 0 && (
          <ul className="flex flex-col gap-1">
            {extensions.map((extension) => (
              <li
                key={extension.path}
                className="flex items-center gap-2 rounded-md hairline px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{extension.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
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
