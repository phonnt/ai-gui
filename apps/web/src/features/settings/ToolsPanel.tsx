import { Badge, Skeleton } from '@grove/ui';
import { Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSessionTools } from '../../lib/api-client/hooks';

/**
 * Tools registered on the live session (TUI `/tools`). The active flag is what
 * the model can actually call right now — mode switches (plan keeps `write`,
 * vibe swaps in the ephemeral vibe tools) show up here.
 */
export function ToolsPanel({ sessionId }: { sessionId: string }) {
  const toolsQuery = useSessionTools(sessionId);
  const [filter, setFilter] = useState('');
  const tools = useMemo(() => {
    const all = toolsQuery.data ?? [];
    const needle = filter.trim().toLowerCase();
    return needle === ''
      ? all
      : all.filter(
          (tool) =>
            tool.name.toLowerCase().includes(needle) ||
            tool.description.toLowerCase().includes(needle),
        );
  }, [toolsQuery.data, filter]);

  const activeCount = (toolsQuery.data ?? []).filter((tool) => tool.active).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 hairline-b p-3">
        <div className="flex items-center gap-2">
          <Wrench className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="flex-1 text-[13px] font-semibold">Tools</h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {activeCount}/{toolsQuery.data?.length ?? 0} active
          </span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or description…"
          aria-label="Filter tools"
          className="h-7 rounded-md bg-background hairline px-2 font-mono text-xs outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-area p-3">
        {toolsQuery.isPending && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {toolsQuery.isError && (
          <p className="text-small text-destructive">
            {toolsQuery.error instanceof Error ? toolsQuery.error.message : 'Tools failed.'}
          </p>
        )}
        {toolsQuery.data && tools.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">No tools match.</p>
        )}
        <ul className="flex flex-col gap-1">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-start gap-2 rounded-md hairline px-2 py-1.5">
              <span className="w-40 shrink-0 truncate font-mono text-xs">{tool.name}</span>
              <Badge variant={tool.active ? 'secondary' : 'outline'}>
                {tool.active ? 'active' : 'inactive'}
              </Badge>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {tool.description}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {tool.source}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
