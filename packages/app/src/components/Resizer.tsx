import { useRef } from 'react';
import { setPrefs, usePrefs, WIDTHS, zoomFactor, type Prefs } from '../state/prefs';

type Key = 'sidebarW' | 'listW' | 'tocW';

/**
 * A drag handle on the edge of a pane. `edge` says which side of the pane it sits on:
 * dragging toward the pane's inside shrinks it. Arrow keys nudge, double-click resets.
 */
export function Resizer({ pane, edge, label }: { pane: Key; edge: 'right' | 'left'; label: string }) {
  const prefs = usePrefs();
  const { min, max, def } = WIDTHS[pane];
  const value = prefs[pane] ?? def;
  const drag = useRef<{ x: number; w: number } | null>(null);
  const set = (w: number) => setPrefs({ [pane]: Math.round(Math.min(max, Math.max(min, w))) } as Partial<Prefs>);
  return (
    <div className={`resizer ${edge}`} role="separator" aria-orientation="vertical" tabIndex={0}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} title={`${label}. Double-click to reset.`}
      onPointerDown={e => { drag.current = { x: e.clientX, w: value }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
      onPointerMove={e => {
        if (!drag.current) return;
        // pointer coordinates are real pixels; widths are CSS px inside the zoomed document
        const dx = (e.clientX - drag.current.x) / zoomFactor();
        set(drag.current.w + (edge === 'right' ? dx : -dx));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => setPrefs({ [pane]: null } as Partial<Prefs>)}
      onKeyDown={e => {
        const step = e.shiftKey ? 48 : 16;
        const dir = edge === 'right' ? 1 : -1;
        if (e.key === 'ArrowRight') { e.preventDefault(); set(value + step * dir); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); set(value - step * dir); }
        else if (e.key === 'Home' || e.key === 'Escape') { e.preventDefault(); setPrefs({ [pane]: null } as Partial<Prefs>); }
      }} />
  );
}
