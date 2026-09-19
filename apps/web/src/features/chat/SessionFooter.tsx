import { useSessionStats } from '../../lib/api-client/hooks';

/** Compact token counts: 950 → 950, 12_400 → 12.4k, 2_500_000 → 2.50M. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const CONTEXT_WARN_PERCENT = 75;

/**
 * Cumulative session readout mirroring the TUI footer segments: prompt/
 * completion/cache tokens, session cost, context saturation, tool calls.
 */
export function SessionFooter({ sessionId }: { sessionId: string }) {
  const statsQuery = useSessionStats(sessionId || undefined);
  const stats = statsQuery.data;
  if (!stats) return null;

  const { tokens, context } = stats;
  const contextHot = context !== null && context.percent >= CONTEXT_WARN_PERCENT;

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
      {context && (
        <span
          title={`Context ${context.tokens} / ${context.contextWindow} tokens`}
          className={contextHot ? 'text-[hsl(var(--diff-del))]' : undefined}
        >
          ctx {context.percent.toFixed(1)}%
        </span>
      )}
      <span title="Tool calls this session">{stats.toolCalls} tools</span>
    </div>
  );
}
