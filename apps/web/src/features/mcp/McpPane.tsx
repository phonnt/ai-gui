import { Badge, Button, ErrorState, Skeleton } from '@grove/ui';
import type { UseMutationResult } from '@tanstack/react-query';
import { FlaskConical, PlugZap, RefreshCw, RotateCcw, Server } from 'lucide-react';
import { useState } from 'react';
import type { McpActionResult, McpServerInfo } from '../../lib/api-client/hooks';
import {
  useDiscoverMcpTools,
  useMcpServers,
  useMcpTools,
  useReconnectMcpServer,
  useReloadMcpServer,
  useTestMcpServer,
} from '../../lib/api-client/hooks';
import { mcpToolCount } from '../../lib/api-client/rest';

function statusVariant(status: string): 'neutral' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected':
      return 'neutral';
    case 'connecting':
      return 'secondary';
    case 'disconnected':
      return 'destructive';
    default:
      return 'outline';
  }
}
export function McpPane() {
  const serversQuery = useMcpServers();
  const test = useTestMcpServer();
  const reconnect = useReconnectMcpServer();
  const reload = useReloadMcpServer();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ action: string; result: McpActionResult } | null>(
    null,
  );

  const servers = serversQuery.data ?? [];
  const selected: McpServerInfo | null =
    servers.find((server) => server.name === selectedName) ?? servers[0] ?? null;
  const tools = useMcpTools(selected?.name);
  const discover = useDiscoverMcpTools();
  const pending = test.isPending || reconnect.isPending || reload.isPending;
  const actionError =
    (test.error instanceof Error ? test.error.message : null) ??
    (reconnect.error instanceof Error ? reconnect.error.message : null) ??
    (reload.error instanceof Error ? reload.error.message : null);

  const runAction = (
    action: 'test' | 'reconnect' | 'reload',
    mutation: UseMutationResult<McpActionResult, Error, string>,
  ) => {
    if (!selected) return;
    setLastResult(null);
    test.reset();
    reconnect.reset();
    reload.reset();
    mutation.mutate(selected.name, {
      onSuccess: (result) => setLastResult({ action, result }),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 hairline-b p-3">
        <Server className="size-4" />
        <h3 className="text-body font-strong">MCP Servers</h3>
        <Button
          variant="outline"
          onClick={() => serversQuery.refetch()}
          disabled={serversQuery.isFetching}
          className="ml-auto"
        >
          <RefreshCw />
          {serversQuery.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        {serversQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {serversQuery.isError && (
          <ErrorState
            message={
              serversQuery.error instanceof Error
                ? serversQuery.error.message
                : 'Failed to load MCP servers.'
            }
            onRetry={() => serversQuery.refetch()}
          />
        )}
        {serversQuery.data && servers.length === 0 && (
          <p className="rounded-md hairline p-4 text-center text-body text-muted-foreground">
            No MCP servers configured.
          </p>
        )}
        {servers.length > 0 && (
          <ul className="flex flex-col gap-1">
            {servers.map((server) => {
              const count = mcpToolCount(server);
              const active = selected?.name === server.name;
              return (
                <li key={server.name}>
                  <button
                    type="button"
                    onClick={() => setSelectedName(server.name)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-body hover:bg-accent ${
                      active ? 'border-ring' : 'border-border'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-small">
                      {server.name}
                    </span>
                    <Badge variant={statusVariant(server.status)}>{server.status}</Badge>
                    <span className="shrink-0 text-small text-muted-foreground">
                      {server.transport}
                      {count !== null ? ` · ${count} tools` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {selected && (
          <div className="mt-3 flex flex-col gap-2 rounded-md hairline p-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlugZap className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-small font-strong">
                {selected.name}
              </span>
              <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
              <dt className="text-muted-foreground">Transport</dt>
              <dd className="font-mono">{selected.transport}</dd>
              <dt className="text-muted-foreground">Tools</dt>
              <dd className="font-mono">
                {(() => {
                  const count = mcpToolCount(selected);
                  return count !== null ? String(count) : '—';
                })()}
              </dd>
            </dl>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-small text-muted-foreground">Registered tools</span>
                <Button
                  variant="outline"
                  className="ml-auto"
                  disabled={discover.isPending}
                  onClick={() => discover.mutate(selected.name)}
                  title="Connect this server and refresh its tool list"
                >
                  {discover.isPending ? 'Discovering…' : 'Discover'}
                </Button>
              </div>
              {tools.isPending && <Skeleton className="h-10 w-full" />}
              {tools.data && tools.data.length === 0 && (
                <p className="text-small text-muted-foreground">
                  No tools registered yet — run Discover to connect the server.
                </p>
              )}
              {tools.data && tools.data.length > 0 && (
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto scroll-area">
                  {tools.data.map((tool) => (
                    <li key={`${tool.server}:${tool.name}`} className="text-small">
                      <span className="font-mono">{tool.name}</span>
                      {tool.description && (
                        <span className="text-muted-foreground">
                          {' — '}
                          {tool.description.length > 120
                            ? `${tool.description.slice(0, 120)}…`
                            : tool.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={pending} onClick={() => runAction('test', test)}>
                <FlaskConical />
                Test
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => runAction('reconnect', reconnect)}
              >
                <PlugZap />
                Reconnect
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => runAction('reload', reload)}
              >
                <RotateCcw />
                Reload
              </Button>
            </div>
            {pending && <p className="text-small text-muted-foreground">Working…</p>}
            {actionError && <p className="text-small text-destructive">{actionError}</p>}
            {lastResult && (
              <p
                className={`text-small ${
                  lastResult.result.ok ? 'text-muted-foreground' : 'text-destructive'
                }`}
              >
                {lastResult.action}: {lastResult.result.ok ? 'ok' : 'failed'}
                {lastResult.result.detail ? ` — ${lastResult.result.detail}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
