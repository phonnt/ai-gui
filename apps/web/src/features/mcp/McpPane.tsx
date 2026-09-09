import { Badge, Button, Skeleton } from '@ai-gui/ui';
import type { UseMutationResult } from '@tanstack/react-query';
import { FlaskConical, PlugZap, RefreshCw, RotateCcw, Server } from 'lucide-react';
import { useState } from 'react';
import type { McpActionResult, McpServerInfo } from '../../lib/api-client/hooks';
import {
  useMcpServers,
  useReconnectMcpServer,
  useReloadMcpServer,
  useTestMcpServer,
} from '../../lib/api-client/hooks';
import { mcpToolCount } from '../../lib/api-client/rest';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connected':
      return 'default';
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
    mutation.mutate(selected.name, {
      onSuccess: (result) => setLastResult({ action, result }),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-[hsl(var(--border))] p-3">
        <Server className="size-4" />
        <h3 className="text-[13px] font-semibold">MCP Servers</h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => serversQuery.refetch()}
          className="ml-auto"
        >
          <RefreshCw />
          Refresh
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {serversQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {serversQuery.isError && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-[hsl(var(--border))] p-3 text-center">
            <p className="text-xs text-[hsl(var(--destructive))]">
              {serversQuery.error instanceof Error
                ? serversQuery.error.message
                : 'Failed to load MCP servers.'}
            </p>
            <Button size="sm" variant="outline" onClick={() => serversQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {serversQuery.data && servers.length === 0 && (
          <p className="rounded-md border border-[hsl(var(--border))] p-4 text-center text-[13px] text-[hsl(var(--muted-foreground))]">
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
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[13px] hover:bg-[hsl(var(--accent))] ${
                      active ? 'border-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{server.name}</span>
                    <Badge variant={statusVariant(server.status)}>{server.status}</Badge>
                    <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">
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
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] p-3">
            <div className="flex min-w-0 items-center gap-2">
              <PlugZap className="size-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold">
                {selected.name}
              </span>
              <Badge variant={statusVariant(selected.status)}>{selected.status}</Badge>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-[hsl(var(--muted-foreground))]">Transport</dt>
              <dd className="font-mono">{selected.transport}</dd>
              <dt className="text-[hsl(var(--muted-foreground))]">Tools</dt>
              <dd className="font-mono">
                {(() => {
                  const count = mcpToolCount(selected);
                  return count !== null ? String(count) : '—';
                })()}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => runAction('test', test)}
              >
                <FlaskConical />
                Test
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => runAction('reconnect', reconnect)}
              >
                <PlugZap />
                Reconnect
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => runAction('reload', reload)}
              >
                <RotateCcw />
                Reload
              </Button>
            </div>
            {pending && <p className="text-xs text-[hsl(var(--muted-foreground))]">Working…</p>}
            {actionError && <p className="text-xs text-[hsl(var(--destructive))]">{actionError}</p>}
            {lastResult && (
              <p
                className={`text-xs ${
                  lastResult.result.ok
                    ? 'text-[hsl(var(--muted-foreground))]'
                    : 'text-[hsl(var(--destructive))]'
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
