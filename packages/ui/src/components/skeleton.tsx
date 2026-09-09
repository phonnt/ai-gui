import { cn } from '../utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('animate-pulse rounded bg-[hsl(var(--muted))]', className)} {...props} />
  );
}

export { Skeleton };
