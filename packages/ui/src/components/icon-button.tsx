import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../utils';

/** oc-2 `icon-button-v2`: 20/24/28 px squares, radii 4/6/6. */
const iconButtonVariants = cva(
  'inline-flex shrink-0 items-center justify-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
    variants: {
      variant: {
        ghost: 'rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        'ghost-muted': 'rounded-md text-muted-foreground hover:text-foreground',
        plain: 'rounded-md text-foreground hover:bg-accent',
      },
      size: {
        sm: 'size-5 rounded-sm',
        default: 'size-6',
        lg: 'size-7',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'default' },
  },
);

interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name — icon buttons have no text content. */
  label: string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, label, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={props.title ?? label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

export { IconButton, iconButtonVariants };
