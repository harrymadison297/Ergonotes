// The curves the loader draws. Plain parametric formulas, each closed over t in [0, 2π) and scaled into [-1, 1].
export type CurveKind = 'rose' | 'lissajous' | 'hypotrochoid' | 'cardioid' | 'lemniscate';

export const CURVE_KINDS: readonly CurveKind[] = ['rose', 'lissajous', 'hypotrochoid', 'cardioid', 'lemniscate'];

const TAU = Math.PI * 2;

export function curvePoint(kind: CurveKind, t: number): [number, number] {
  switch (kind) {
    case 'rose': { // r = cos(3θ)
      const r = Math.cos(3 * t);
      return [r * Math.cos(t), r * Math.sin(t)];
    }
    case 'lissajous':
      return [Math.sin(3 * t + Math.PI / 2), Math.sin(2 * t)];
    case 'hypotrochoid': { // R = 5, r = 3, d = 5: closes after one turn of t * 3
      const T = t * 3;
      const x = 2 * Math.cos(T) + 5 * Math.cos((2 / 3) * T);
      const y = 2 * Math.sin(T) - 5 * Math.sin((2 / 3) * T);
      return [x / 7, y / 7];
    }
    case 'cardioid': { // r = (1 - cos θ) / 2, moved to the middle of the box
      const r = 0.5 * (1 - Math.cos(t));
      return [(r * Math.cos(t) + 0.44) * 1.5, r * Math.sin(t) * 1.5];
    }
    case 'lemniscate': { // Bernoulli's lemniscate
      const d = 1 + Math.sin(t) ** 2;
      return [Math.cos(t) / d, (Math.sin(t) * Math.cos(t)) / d * 1.6];
    }
  }
}

/** One full turn of the curve's parameter. */
export const CURVE_PERIOD = TAU;

const STEPS = 720;
const lengths = new Map<CurveKind, number[]>();

/** Cumulative length along the curve at STEPS + 1 points of its parameter, scaled to end at 1. */
function table(kind: CurveKind): number[] {
  let t = lengths.get(kind);
  if (t) return t;
  t = [0];
  let [px, py] = curvePoint(kind, 0);
  for (let i = 1; i <= STEPS; i++) {
    const [x, y] = curvePoint(kind, (i / STEPS) * TAU);
    t.push(t[i - 1] + Math.hypot(x - px, y - py));
    px = x; py = y;
  }
  const total = t[STEPS] || 1;
  t = t.map(v => v / total);
  lengths.set(kind, t);
  return t;
}

/** The point a fraction `f` of the way along the curve (by length, so a head moves at a steady pace); `f` wraps round. */
export function curveAt(kind: CurveKind, f: number): [number, number] {
  const g = ((f % 1) + 1) % 1;
  const t = table(kind);
  let lo = 0, hi = STEPS;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= g) lo = mid; else hi = mid; }
  const span = t[hi] - t[lo] || 1;
  return curvePoint(kind, ((lo + (g - t[lo]) / span) / STEPS) * TAU);
}
