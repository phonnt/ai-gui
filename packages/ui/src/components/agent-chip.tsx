import { cn } from '../utils';

/** Agent kinds the runtime reports; each gets its own identity colour. */
export type AgentKind = 'plan' | 'build' | 'explore' | 'review' | 'writer';

const KIND_CLASSES: Record<AgentKind, string> = {
  plan: 'text-agent-plan',
  build: 'text-agent-build',
  explore: 'text-agent-explore',
  review: 'text-agent-review',
  writer: 'text-agent-writer',
};

export function AgentChip({ kind, className }: { kind: AgentKind; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center rounded-[2px] px-1 text-meta font-strong uppercase',
        KIND_CLASSES[kind],
        className,
      )}
      style={{
        backgroundColor: `hsl(var(--agent-${kind}) / 0.12)`,
        boxShadow: `inset 0 0 0 0.5px hsl(var(--agent-${kind}) / 0.5)`,
      }}
    >
      {kind}
    </span>
  );
}
