import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../utils';

/**
 * oc-2 `tag`: 16px tall, 2px radius, 11px/530 with +0.05px tracking, hairline
 * border. `neutral` is the muted label chip; the state variants reuse the
 * palette triplets so chips read the same as status dots.
 */
const badgeVariants = cva(
  'inline-flex h-4 items-center gap-1 rounded-[2px] px-1 text-meta font-strong uppercase transition-colors',
  {
    variants: {
      variant: {
        neutral: 'hairline bg-muted text-muted-foreground',
        secondary: 'hairline-muted bg-secondary text-secondary-foreground',
        accent: 'bg-primary text-primary-foreground hairline-none',
        success: 'bg-success-bg text-success hairline-none',
        warning: 'bg-warning-bg text-warning-strong hairline-none',
        danger: 'bg-destructive-bg text-destructive hairline-none',
        info: 'bg-info-bg text-info hairline-none',
        destructive: 'bg-destructive text-destructive-foreground hairline-none',
        outline: 'hairline bg-transparent text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
