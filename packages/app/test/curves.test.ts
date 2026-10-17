import { describe, expect, it } from 'vitest';
import { CURVE_KINDS, CURVE_PERIOD, curveAt, curvePoint } from '../src/components/curves';

describe('the loader curves', () => {
  for (const kind of CURVE_KINDS) {
    it(`${kind} stays inside the box, is finite and closes on itself`, () => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i <= 720; i++) {
        const [x, y] = curvePoint(kind, (i / 720) * CURVE_PERIOD);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        min = Math.min(min, x, y);
        max = Math.max(max, x, y);
      }
      expect(min).toBeGreaterThanOrEqual(-1.02);
      expect(max).toBeLessThanOrEqual(1.02);
      const [x0, y0] = curvePoint(kind, 0);
      const [x1, y1] = curvePoint(kind, CURVE_PERIOD);
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(1e-9);
    });
    it(`${kind} fills a fair part of the box (a loader that is a dot is no loader)`, () => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i <= 720; i++) { const [x] = curvePoint(kind, (i / 720) * CURVE_PERIOD); min = Math.min(min, x); max = Math.max(max, x); }
      expect(max - min).toBeGreaterThan(1);
    });
  }

  for (const kind of CURVE_KINDS) {
    it(`${kind} is walked at a steady pace by curveAt`, () => {
      // equal steps of the fraction are about equal steps of distance
      const d: number[] = [];
      let [px, py] = curveAt(kind, 0);
      for (let i = 1; i <= 100; i++) { const [x, y] = curveAt(kind, i / 100); d.push(Math.hypot(x - px, y - py)); px = x; py = y; }
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      expect(Math.max(...d)).toBeLessThan(mean * 1.6);
      expect(Math.min(...d)).toBeGreaterThan(mean * 0.4);
      const [a, b] = [curveAt(kind, 0), curveAt(kind, 1)];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
      expect(curveAt(kind, -0.25)).toEqual(curveAt(kind, 0.75));
    });
  }
});
