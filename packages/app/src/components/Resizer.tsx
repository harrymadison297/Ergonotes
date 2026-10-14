import { useRef } from 'react';
import { setPrefs, usePrefs, WIDTHS, type Prefs } from '../state/prefs';

/**
 * A drag handle on the edge of a pane (its parent element). `edge` says which side of the pane
 * it sits on: dragging toward the pane's inside shrinks it. Arrow keys nudge, double-click resets.
 */
export function Resizer({ pane, edge, label }: { pane: keyof typeof WIDTHS; edge: 'right' | 'left'; label: string }) {
  const prefs = usePrefs();
  const { min, max } = WIDTHS[pane];
  const drag = useRef<{ x: number; w: number } | null>(null);
  const set = (w: number) => setPrefs({ [pane]: Math.round(Math.min(max, Math.max(min, w))) } as Partial<Prefs>);
  const reset = () => setPrefs({ [pane]: null } as Partial<Prefs>);
  const widthOf = (el: HTMLElement) => el.parentElement?.getBoundingClientRect().width ?? min;
  const sign = edge === 'right' ? 1 : -1;
  return (
    <div className={`resizer ${edge}`} role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={prefs[pane] ?? undefined}
      title={`${label}. Double-click to reset.`}
      onPointerDown={e => { drag.current = { x: e.clientX, w: widthOf(e.currentTarget) }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={e => { if (drag.current) set(drag.current.w + sign * (e.clientX - drag.current.x)); }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={reset}
      onKeyDown={e => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === 'ArrowRight') { e.preventDefault(); set(widthOf(e.currentTarget) + step * sign); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); set(widthOf(e.currentTarget) - step * sign); }
        else if (e.key === 'Home' || e.key === 'Escape') { e.preventDefault(); reset(); }
      }} />
  );
}
