import { type ContextLevel, contextLevel } from '@grove/core';
import { Tooltip } from '@grove/ui';
import { useSessionStats } from '../../lib/api-client/hooks';
import { CONTEXT_LEVEL_CLASS } from '../../lib/context-level';
import { formatCount } from '../../lib/format';

/**
 * Compact cumulative readout mirroring the TUI footer segments: prompt/
 * completion/cache tokens, cost, context saturation, tool calls. The full
 * per-category split lives in the session stats panel.
 */
export function SessionFooter({ sessionId }: { sessionId: string }) {
  const statsQuery = useSessionStats(sessionId || undefined);
  const stats = statsQuery.data;
  if (!stats) return null;

  const { tokens, context } = stats;
  const level: ContextLevel = context
    ? contextLevel(context.percent, context.contextWindow)
    : 'normal';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 hairline-t px-3 py-1 font-mono text-meta text-muted-foreground">
      <Tooltip label="Prompt tokens sent (including cache reads)">
        <span>↑{formatCount(tokens.input)}</span>
      </Tooltip>
      <Tooltip label="Completion tokens">
        <span>↓{formatCount(tokens.output)}</span>
      </Tooltip>
      {tokens.cacheRead > 0 && (
        <Tooltip label="Cache read tokens">
          <span>R{formatCount(tokens.cacheRead)}</span>
        </Tooltip>
      )}
      {tokens.cacheWrite > 0 && (
        <Tooltip label="Cache write tokens">
          <span>W{formatCount(tokens.cacheWrite)}</span>
        </Tooltip>
      )}
      {tokens.reasoning > 0 && (
        <Tooltip label="Reasoning tokens">
          <span>∴{formatCount(tokens.reasoning)}</span>
        </Tooltip>
      )}
      {stats.cost > 0 && (
        <Tooltip label="Session cost">
          <span>${stats.cost.toFixed(3)}</span>
        </Tooltip>
      )}
      {stats.premiumRequests > 0 && (
        <Tooltip label="Premium requests">
          <span>{stats.premiumRequests}⭐</span>
        </Tooltip>
      )}
      {context && (
        <span
          title={`Context ${context.tokens} / ${context.contextWindow} tokens`}
          className={CONTEXT_LEVEL_CLASS[level] || undefined}
        >
          ctx {context.percent.toFixed(1)}%
        </span>
      )}
      <Tooltip label="Tool calls this session">
        <span>{stats.toolCalls} tools</span>
      </Tooltip>
      <Tooltip label="Messages in the transcript">
        <span>{stats.totalMessages} msgs</span>
      </Tooltip>
    </div>
  );
}
