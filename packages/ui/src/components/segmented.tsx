import { cn } from '../utils';

/**
 * oc-2 `segmented-control-v2`: 28px track on `layer-01`, pressed item on the
 * base surface with a strong hairline, 13px/440 labels.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  'aria-label'?: string;
  className?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <fieldset
      className={cn('inline-flex h-7 items-center gap-0.5 rounded-md bg-muted p-0.5', className)}
      {...rest}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-6 rounded-sm px-3 text-body transition-colors disabled:opacity-45',
              pressed
                ? 'bg-background font-strong text-foreground hairline-strong'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
