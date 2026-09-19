import { type ContextLevel, contextLevel } from '@ai-gui/core';
import { useSessionStats } from '../../lib/api-client/hooks';
import { CONTEXT_LEVEL_CLASS, formatTokens } from '../sessions/SessionStatsPanel';

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-[hsl(var(--border))] px-3 py-1 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
      <span title="Prompt tokens sent (including cache reads)">↑{formatTokens(tokens.input)}</span>
      <span title="Completion tokens">↓{formatTokens(tokens.output)}</span>
      {tokens.cacheRead > 0 && (
        <span title="Cache read tokens">R{formatTokens(tokens.cacheRead)}</span>
      )}
      {tokens.cacheWrite > 0 && (
        <span title="Cache write tokens">W{formatTokens(tokens.cacheWrite)}</span>
      )}
      {tokens.reasoning > 0 && (
        <span title="Reasoning tokens">∴{formatTokens(tokens.reasoning)}</span>
      )}
      {stats.cost > 0 && <span title="Session cost">${stats.cost.toFixed(3)}</span>}
      {stats.premiumRequests > 0 && <span title="Premium requests">{stats.premiumRequests}⭐</span>}
      {context && (
        <span
          title={`Context ${context.tokens} / ${context.contextWindow} tokens`}
          className={CONTEXT_LEVEL_CLASS[level] || undefined}
        >
          ctx {context.percent.toFixed(1)}%
        </span>
      )}
      <span title="Tool calls this session">{stats.toolCalls} tools</span>
      <span title="Messages in the transcript">{stats.totalMessages} msgs</span>
    </div>
  );
}
