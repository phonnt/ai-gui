import type { ChatMessage } from '@ai-gui/core';

export interface Turn {
  id: string;
  user: ChatMessage | null;
  items: ChatMessage[];
}

export interface TurnSummary {
  toolCount: number;
  fileCount: number;
  errorCount: number;
  totalWallMs: number;
  assistantCount: number;
}

/** Group a flat transcript into turns. A `user` message starts a new turn. */
export function groupTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const msg of messages) {
    if (msg.role === 'user') {
      current = { id: msg.id, user: msg, items: [] };
      turns.push(current);
    } else if (current) {
      current.items.push(msg);
    } else {
      // Preamble before the first user message (history import, system).
      current = { id: `preamble-${msg.id}`, user: null, items: [msg] };
      turns.push(current);
    }
  }
  return turns;
}

export function summarizeTurn(turn: Turn): TurnSummary {
  const tools = turn.items.filter((m) => m.role === 'tool');
  const files = new Set<string>();
  let totalWallMs = 0;
  let errorCount = 0;
  for (const t of tools) {
    if (t.tool?.error) errorCount += 1;
    if (t.tool?.path) files.add(t.tool.path);
    else if (t.tool?.diff && t.tool.diff.length > 0) files.add(t.tool?.name ?? 'edit');
    if (typeof t.tool?.wallTimeMs === 'number') totalWallMs += t.tool.wallTimeMs;
  }
  return {
    toolCount: tools.length,
    fileCount: files.size,
    errorCount,
    totalWallMs,
    assistantCount: turn.items.filter((m) => m.role === 'assistant').length,
  };
}

/**
 * Wall-clock turn duration from transcript timestamps (user prompt → last
 * response message). Null when timestamps are missing or unparseable —
 * callers then omit the duration instead of showing a wrong number.
 */
export function turnDurationMs(turn: Turn): number | null {
  const first = turn.user ?? turn.items[0];
  const last = turn.items[turn.items.length - 1];
  if (!first || !last) return null;
  const start = Date.parse(first.createdAt);
  const end = Date.parse(last.createdAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return end - start;
}

/** Long durations like the TUI: `43s`, `6m 43s`, `1h 2m`. */
export function formatLongDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export type TurnState = 'working' | 'done' | 'failed';

/** TUI-style collapse label: `Completed 4 steps in 6m 43s`. */
export function formatTurnStatus(
  state: TurnState,
  steps: number,
  durationMs: number | null,
): string {
  const unit = steps === 1 ? 'step' : 'steps';
  const duration = durationMs === null ? '' : ` in ${formatLongDuration(durationMs)}`;
  switch (state) {
    case 'working':
      return `Working · ${steps} ${unit}`;
    case 'failed':
      return `Failed after ${steps} ${unit}${duration}`;
    case 'done':
      return `Completed ${steps} ${unit}${duration}`;
  }
}
