import { cn } from '../utils';

/** oc-2 `keybind-v2`: 14px keys, 11px/530 uppercase labels. */
export function Keybind({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-3.5 items-center rounded-[2px] bg-muted px-1 font-strong text-meta text-muted-foreground uppercase"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
