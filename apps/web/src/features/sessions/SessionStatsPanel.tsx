import { type ContextLevel, contextLevel } from '@ai-gui/core';
import type { ContextBreakdownDto, SessionStatsDto } from '@ai-gui/protocol';
import { useSessionStats } from '../../lib/api-client/hooks';

/** Token counts: 950 → 950, 12_400 → 12.4k, 2_500_000 → 2.50M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Saturation colour per level, reusing existing tokens: amber → ember (the
 * accent, one step hotter) → destructive for the terminal state.
 */
export const CONTEXT_LEVEL_CLASS: Record<ContextLevel, string> = {
  normal: '',
  warning: 'text-[hsl(var(--amber))]',
  purple: 'text-[hsl(var(--primary))]',
  error: 'text-[hsl(var(--destructive))]',
};

/** Token-count fields only: `contextWindow`/`anchored` are not per-category. */
type CategoryKey =
  | 'systemPromptTokens'
  | 'systemToolsTokens'
  | 'systemContextTokens'
  | 'skillsTokens'
  | 'messagesTokens';

const CATEGORY_ROWS: { key: CategoryKey; label: string; className: string }[] = [
  { key: 'systemPromptTokens', label: 'System prompt', className: 'bg-[hsl(var(--primary))]' },
  { key: 'systemToolsTokens', label: 'Tool schemas', className: 'bg-[hsl(var(--amber))]' },
  {
    key: 'systemContextTokens',
    label: 'Project context',
    className: 'bg-[hsl(var(--muted-foreground))]',
  },
  { key: 'skillsTokens', label: 'Skills', className: 'bg-[hsl(var(--diff-add))]' },
  { key: 'messagesTokens', label: 'Messages', className: 'bg-[hsl(var(--foreground))]' },
];

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Context window split, mirroring the TUI `/context` view: one proportional
 * bar per category plus the used/free split of the whole window.
 */
function ContextBreakdown({ breakdown }: { breakdown: ContextBreakdownDto }) {
  const window = breakdown.contextWindow;
  if (window <= 0) return null;
  const used = Math.max(0, breakdown.usedTokens);
  const free = Math.max(0, window - used);
  const segments = CATEGORY_ROWS.map((row) => ({ ...row, tokens: breakdown[row.key] })).filter(
    (row) => row.tokens > 0,
  );
  return (
    <div className="flex flex-col gap-1.5">
      {/* Window occupancy: the whole bar is the context window. */}
      <div
        className="flex h-2 w-full overflow-hidden rounded-sm bg-[hsl(var(--muted))]"
        title={`${formatTokens(used)} of ${formatTokens(window)} tokens used`}
      >
        {segments.map((row) => (
          <span
            key={row.key}
            className={row.className}
            style={{ width: `${(row.tokens / window) * 100}%` }}
          />
        ))}
      </div>
      {/* Composition of the used tokens, so a small window slice stays readable. */}
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-sm"
        title="Composition of the tokens in use"
      >
        {segments.map((row) => (
          <span
            key={row.key}
            className={row.className}
            style={{ width: `${used > 0 ? (row.tokens / used) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        {segments.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <span aria-hidden className={`inline-block size-2 rounded-sm ${row.className}`} />
            <span className="flex-1 truncate text-[hsl(var(--muted-foreground))]">{row.label}</span>
            <span className="tabular-nums">{formatTokens(row.tokens)}</span>
            <span className="w-12 text-right tabular-nums text-[hsl(var(--muted-foreground))]">
              {((row.tokens / window) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
        <div className="mt-0.5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-1">
          <span className="text-[hsl(var(--muted-foreground))]">
            Used {formatTokens(used)} / {formatTokens(window)}
            {breakdown.anchored ? ' (anchored)' : ''}
          </span>
          <span className="tabular-nums text-[hsl(var(--muted-foreground))]">
            free {formatTokens(free)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Session statistics panel (the TUI `/session` readout): message and tool
 * counts, cumulative tokens, cost/credits, routed models, context split.
 */
export function SessionStatsPanel({ sessionId }: { sessionId: string }) {
  const statsQuery = useSessionStats(sessionId);
  const stats: SessionStatsDto | undefined = statsQuery.data;
  if (statsQuery.isError) {
    return <p className="px-3 pb-1.5 text-xs text-[hsl(var(--destructive))]">Stats unavailable.</p>;
  }
  if (!stats) {
    return (
      <p className="px-3 pb-1.5 font-mono text-xs text-[hsl(var(--muted-foreground))]">
        Loading stats…
      </p>
    );
  }

  const level = stats.context
    ? contextLevel(stats.context.percent, stats.context.contextWindow)
    : 'normal';
  const routed = Object.entries(stats.routedModels ?? {});

  return (
    <div className="grid gap-x-6 gap-y-2 px-3 pb-2 font-mono text-[11px] leading-relaxed md:grid-cols-2">
      <div className="flex flex-col gap-0.5">
        <StatRow label="id" value={sessionId} />
        <StatRow label="file" value={stats.sessionFile ?? 'in-memory'} />
        <StatRow label="messages" value={String(stats.totalMessages)} />
        <StatRow
          label="user / assistant"
          value={`${stats.userMessages} / ${stats.assistantMessages}`}
        />
        <StatRow label="tool calls / results" value={`${stats.toolCalls} / ${stats.toolResults}`} />
        <StatRow label="tokens in" value={formatTokens(stats.tokens.input)} />
        <StatRow label="tokens out" value={formatTokens(stats.tokens.output)} />
        <StatRow label="reasoning" value={formatTokens(stats.tokens.reasoning)} />
        <StatRow
          label="cache r / w"
          value={`${formatTokens(stats.tokens.cacheRead)} / ${formatTokens(stats.tokens.cacheWrite)}`}
        />
        <StatRow label="tokens total" value={formatTokens(stats.tokens.total)} />
        <StatRow label="cost" value={`$${stats.cost.toFixed(4)}`} />
        {stats.premiumRequests > 0 && (
          <StatRow label="premium requests" value={String(stats.premiumRequests)} />
        )}
        {stats.credits && (
          <StatRow
            label="credits"
            value={`${stats.credits.cost.toFixed(2)} (committed ${stats.credits.committedCost.toFixed(2)}, acu ${stats.credits.acuCost.toFixed(2)})`}
          />
        )}
        {routed.length > 0 && (
          <StatRow
            label="routed models"
            value={routed.map(([model, count]) => `${model}×${count}`).join(', ')}
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {stats.context ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[hsl(var(--muted-foreground))]">context</span>
              <span className={`tabular-nums ${CONTEXT_LEVEL_CLASS[level]}`}>
                {stats.context.percent.toFixed(1)}% · {formatTokens(stats.context.tokens)}/
                {formatTokens(stats.context.contextWindow)}
              </span>
            </div>
            {stats.contextBreakdown ? (
              <ContextBreakdown breakdown={stats.contextBreakdown} />
            ) : (
              <p className="text-[hsl(var(--muted-foreground))]">No breakdown available.</p>
            )}
          </>
        ) : (
          <p className="text-[hsl(var(--muted-foreground))]">Context window unknown.</p>
        )}
      </div>
    </div>
  );
}
