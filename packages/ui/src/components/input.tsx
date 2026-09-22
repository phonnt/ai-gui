import * as React from 'react';
import { cn } from '../utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-7 w-full rounded-md bg-background px-2 text-body text-foreground hairline placeholder:text-muted-foreground outline-none hover:hairline-strong focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
