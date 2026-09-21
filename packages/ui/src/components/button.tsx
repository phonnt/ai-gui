import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../utils';

/**
 * OpenCode Desktop metrics (oc-2 `button-v2`): heights 24/28/32, radii 4/6/6,
 * 13px/530 labels, 2px focus outline at 2.5px offset. `default` is the Grove
 * CTA (layer-03 fill + strong hairline); `neutral` mirrors the app's
 * button-neutral surface.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-strong transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border border-border-strong bg-primary text-primary-foreground hover:bg-primary-hover',
        neutral: 'hairline bg-secondary text-secondary-foreground hover:bg-accent',
        outline: 'hairline-muted bg-transparent text-foreground hover:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent',
        'ghost-muted': 'bg-transparent text-muted-foreground hover:bg-accent',
        danger: 'bg-transparent text-destructive hover:bg-accent',
        warning: 'bg-transparent text-warning-strong hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'bg-transparent text-link underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-6 px-[9px] text-body',
        default: 'h-7 px-[11px] text-body',
        lg: 'h-8 px-[15px] text-body',
        icon: 'size-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
