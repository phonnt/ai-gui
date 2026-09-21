import type { PlanDraftResponseDto, PlanProposalDto } from '@grove/protocol';
import { Button } from '@grove/ui';
import { FileText } from 'lucide-react';

interface PlanReviewProps {
  /** Proposal pushed by the agent (`xd://propose`) or fetched for review. */
  plan: PlanProposalDto;
  /** Plan body; absent until the review fetch resolves. */
  content?: string;
  pending: boolean;
  onDecide: (action: 'execute' | 'keep') => void;
  onDismiss: () => void;
}

/**
 * Plan review (TUI plan overlay): the plan body, then approve-and-execute,
 * approve-and-keep, or dismiss to keep refining in plan mode.
 */
export function PlanReview({ plan, content, pending, onDecide, onDismiss }: PlanReviewProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Plan review"
      className="mx-3 mb-1 rounded-md border border-[hsl(var(--link))] bg-[hsl(var(--card))] p-2"
    >
      <p className="mb-1 text-xs font-medium text-[hsl(var(--link))]">
        Plan ready for review: {plan.title || plan.planFilePath || 'untitled'}
      </p>
      <p className="mb-2 flex items-center gap-1 break-all font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
        <FileText className="size-3 shrink-0" />
        {plan.planFilePath || '(no plan file)'}
        {plan.planExists ? '' : ' (no file written)'}
      </p>
      {content ? (
        <pre className="mb-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2 font-mono text-[11px] leading-relaxed">
          {content}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <Button size="sm" onClick={() => onDecide('execute')} disabled={pending}>
          Approve and execute
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide('keep')} disabled={pending}>
          Approve and keep
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Refine (stay in plan mode)
        </Button>
      </div>
    </div>
  );
}

/** Body preview fetched for `/plan-review` (no proposal event involved). */
export function planPreview(plan: PlanDraftResponseDto | undefined): string | undefined {
  if (!plan?.exists) return undefined;
  return plan.content || undefined;
}
