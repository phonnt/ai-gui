import * as React from 'react';
import { cn } from '../utils';

/**
 * oc-2 `textarea-v2`: min-height 80px, 8px padding, radius 6, 13/440 at 1.35
 * line-height, hairline resting and a 2px focus outline.
 */
const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'min-h-20 w-full resize-none rounded-md bg-background px-2 py-2 text-body text-foreground leading-[1.35] hairline outline-none hover:hairline-strong focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export { Textarea };
