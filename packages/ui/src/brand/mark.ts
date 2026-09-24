/**
 * Grove brand mark — geometry source of truth.
 *
 * A6 "Branch pinwheel": three identical branches rotated 120° around the
 * centre, each ending in a filled node. The React component and the asset
 * generator both read these constants, so the committed assets and the app
 * cannot drift apart.
 *
 * Spec: docs/superpowers/specs/2026-09-24-grove-logo-design.md §3.
 */

export const MARK_VIEWBOX = 32;
export const MARK_STROKE_WIDTH = 4.2;
export const MARK_DOT_RADIUS = 3.8;
export const MARK_TIP_RADIUS = 9.7;

/** Ember, per mode. Lowercase to match Biome's CSS formatter output. */
export const MARK_EMBER = '#f54e00';
export const MARK_EMBER_DARK = '#ff7a3d';

/** Base angles in degrees, screen space (−90° is up). */
const BRANCH_ANGLES = [-90, 30, 150] as const;
const START_DEG = -14;
const CONTROL1_DEG = -26;
const CONTROL2_DEG = 10;
const TIP_DEG = 16;
const CONTROL1_RATIO = 0.42;
const CONTROL2_RATIO = 0.78;

export interface MarkBranch {
  /** Cubic bezier for the branch stroke. */
  path: string;
  /** Terminal node, same 0..32 space. */
  dot: { cx: number; cy: number; r: number };
}

const round2 = (n: number): number => Number(n.toFixed(2));

function polar(deg: number, radius: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [round2(16 + radius * Math.cos(rad)), round2(16 + radius * Math.sin(rad))];
}

/** Distance from the centre where a branch leaves the middle. */
export function markStartRadius(strokeWidth = MARK_STROKE_WIDTH): number {
  return 1.5 + 0.3 * strokeWidth;
}

export function markBranches(strokeWidth = MARK_STROKE_WIDTH): MarkBranch[] {
  const r0 = markStartRadius(strokeWidth);
  const span = MARK_TIP_RADIUS - r0;
  return BRANCH_ANGLES.map((theta) => {
    const [x0, y0] = polar(theta + START_DEG, r0);
    const [x1, y1] = polar(theta + CONTROL1_DEG, r0 + span * CONTROL1_RATIO);
    const [x2, y2] = polar(theta + CONTROL2_DEG, r0 + span * CONTROL2_RATIO);
    const [x3, y3] = polar(theta + TIP_DEG, MARK_TIP_RADIUS);
    return {
      path: `M${x0} ${y0} C${x1} ${y1} ${x2} ${y2} ${x3} ${y3}`,
      dot: { cx: x3, cy: y3, r: MARK_DOT_RADIUS },
    };
  });
}

export const MARK_BRANCHES: MarkBranch[] = markBranches();

/** Farthest point of the drawn mark from the centre, stroke and node included. */
export const MARK_OUTER_BOUND = MARK_TIP_RADIUS + MARK_DOT_RADIUS + MARK_STROKE_WIDTH / 2;
