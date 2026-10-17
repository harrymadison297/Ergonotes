import { useEffect, useRef } from 'react';
import { CURVE_KINDS, CURVE_PERIOD, curvePoint, type CurveKind } from './curves';

const TRAIL = 40;
/** where on the curve the trail's tail is, per particle (a fraction of one turn) */
const GAP = 0.011;

interface Props {
  /** one of the curves; `undefined` picks one that stays the same for this mounted loader */
  kind?: CurveKind;
  /** side of the square, in px */
  size?: number;
  /** seconds for the head to go once round the curve */
  turn?: number;
  /** the text read out for assistive technology */
  label?: string;
  className?: string;
}

/**
 * The loading mark: a bright head that runs along a mathematical curve, leaving a fading trail.
 * It stands for "the app is working on something that takes a moment"; with reduced motion it is the curve held still.
 */
export function CurveLoader({ kind, size = 64, turn = 4.2, label = 'Loading', className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const picked = useRef<CurveKind>(kind ?? CURVE_KINDS[Math.floor(Math.random() * CURVE_KINDS.length)]);
  const curve = kind ?? picked.current;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    const color = getComputedStyle(canvas).color || '#2dbe60';
    const pad = size * 0.14;
    const half = size / 2 - pad;
    const at = (turnFraction: number): [number, number] => {
      const [x, y] = curvePoint(curve, turnFraction * CURVE_PERIOD);
      return [size / 2 + x * half, size / 2 - y * half];
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const frame = (head: number) => {
      ctx.clearRect(0, 0, size, size);
      // the whole curve, faint
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, size / 48);
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) { const [x, y] = at(i / 160); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      if (reduce) return;
      ctx.fillStyle = color;
      for (let i = 0; i < TRAIL; i++) {
        const k = 1 - i / TRAIL;
        const [x, y] = at(head - i * GAP);
        ctx.globalAlpha = 0.08 + 0.92 * k * k;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, (size / 22) * (0.35 + 0.65 * k)), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (reduce) { frame(0); return; }
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => { frame(((now - start) / 1000 / turn) % 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [curve, size, turn]);

  return (
    <canvas
      ref={ref}
      className={className ? `curve-loader ${className}` : 'curve-loader'}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    />
  );
}

/** A loader with a line under it: the whole-window state while something starts or a vault is read. */
export function LoadingScreen({ text, detail, kind }: { text?: string; detail?: string; kind?: CurveKind }) {
  return (
    <div className="gate loading-screen" role="status" aria-busy="true" aria-live="polite">
      <div className="loading-box">
        <CurveLoader kind={kind} size={96} label={text ?? 'Loading'} />
        {text && <p className="loading-text">{text}</p>}
        {detail && <p className="loading-detail">{detail}</p>}
      </div>
    </div>
  );
}
