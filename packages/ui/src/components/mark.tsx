import { MARK_BRANCHES, MARK_STROKE_WIDTH, MARK_VIEWBOX } from '../brand/mark';
import { cn } from '../utils';

/**
 * Grove mark — A6 branch pinwheel. Draws with `currentColor` so the caller
 * picks the ember step (`text-mark-ember` flips per theme in apps/web).
 * Geometry: packages/ui/src/brand/mark.ts.
 */
export function Mark({
  size = 16,
  title = 'Grove',
  className,
}: {
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
      role="img"
      aria-label={title}
      className={cn('shrink-0', className)}
    >
      <title>{title}</title>
      <g fill="none" stroke="currentColor" strokeWidth={MARK_STROKE_WIDTH} strokeLinecap="round">
        {MARK_BRANCHES.map((branch) => (
          <path key={branch.path} d={branch.path} />
        ))}
      </g>
      <g fill="currentColor">
        {MARK_BRANCHES.map((branch) => (
          <circle key={branch.path} cx={branch.dot.cx} cy={branch.dot.cy} r={branch.dot.r} />
        ))}
      </g>
    </svg>
  );
}
