import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge ships with Tailwind's stock scales, so it reads our custom ramp
 * (`text-body`, `text-meta`, …) as *text colours* and drops them whenever a real
 * colour class like `text-foreground` follows — the font size silently fell back
 * to the inherited one. Registering the ramp as a font-size group keeps both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': ['text-meta', 'text-small', 'text-body', 'text-title', 'text-hero'],
      'font-weight': ['font-regular', 'font-strong'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
