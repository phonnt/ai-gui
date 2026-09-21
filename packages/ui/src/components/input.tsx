import * as React from 'react';
import { cn } from '../utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-8 w-full rounded-md bg-background hairline px-2 text-[13px] placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-[2.5px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
