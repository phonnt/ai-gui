import { describe, expect, test } from 'bun:test';
import {
  MARK_BRANCHES,
  MARK_DOT_RADIUS,
  MARK_OUTER_BOUND,
  MARK_TIP_RADIUS,
  MARK_VIEWBOX,
} from './mark';

const CENTRE = MARK_VIEWBOX / 2;
// Path numbers are rounded to 2 decimals, so a rotation comparison needs slack.
const EPS = 0.03;

function points(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function rotate(x: number, y: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const dx = x - CENTRE;
  const dy = y - CENTRE;
  return [
    CENTRE + dx * Math.cos(rad) - dy * Math.sin(rad),
    CENTRE + dx * Math.sin(rad) + dy * Math.cos(rad),
  ];
}

describe('mark geometry', () => {
  test('draws exactly three branches', () => {
    expect(MARK_BRANCHES).toHaveLength(3);
  });

  test('puts every terminal node on the tip radius', () => {
    for (const { dot } of MARK_BRANCHES) {
      const r = Math.hypot(dot.cx - CENTRE, dot.cy - CENTRE);
      expect(Math.abs(r - MARK_TIP_RADIUS)).toBeLessThanOrEqual(EPS);
      expect(dot.r).toBe(MARK_DOT_RADIUS);
    }
  });

  test('rotates branch 1 by 120° and 240° to get branches 2 and 3', () => {
    const first = MARK_BRANCHES[0];
    expect(first).toBeDefined();
    if (!first) return;

    const base = points(first.path);
    for (const [index, branch] of MARK_BRANCHES.slice(1).entries()) {
      const expected: number[] = [];
      for (let p = 0; p < base.length; p += 2) {
        expected.push(...rotate(base[p] ?? 0, base[p + 1] ?? 0, 120 * (index + 1)));
      }
      const actual = points(branch.path);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((value, i) => {
        expect(Math.abs(value - (expected[i] ?? 0))).toBeLessThanOrEqual(EPS);
      });
    }
  });

  test('fits inside the 32-unit box with margin to spare', () => {
    expect(MARK_OUTER_BOUND).toBeLessThanOrEqual(15.7);
    expect(CENTRE - MARK_OUTER_BOUND).toBeGreaterThan(0.3);
  });
});

describe('committed assets', () => {
  test('the committed mark.svg matches the geometry module', async () => {
    const file = Bun.file(new URL('../../../../assets/brand/mark.svg', import.meta.url));
    expect(await file.exists()).toBe(true);
    const svg = await file.text();

    for (const branch of MARK_BRANCHES) {
      expect(svg).toContain(`d="${branch.path}"`);
      expect(svg).toContain(`cx="${branch.dot.cx}" cy="${branch.dot.cy}" r="${branch.dot.r}"`);
    }
  });
});
