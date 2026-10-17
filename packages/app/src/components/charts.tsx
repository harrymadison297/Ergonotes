// The small charts of the Widgets, drawn in SVG with the colours of the app (no chart library: the app stays small and offline).
// Each has a text label for a screen reader; the figures are in the tooltips (`<title>`).
import type { ReactNode } from 'react';
import { classNames } from '../state/util';

/** A ring around a day of the habit calendar: the share of habits met (1 = all of them). `share` null draws nothing around it. */
export function DayRing({ share, size = 38, children }: { share: number | null; size?: number; children?: ReactNode }) {
  const r = (size - 4) / 2, c = 2 * Math.PI * r;
  const frac = share === null ? 0 : Math.max(0, Math.min(1, share));
  return (
    <span className={classNames('day-ring', frac >= 1 && 'full')} style={{ width: size, height: size }}>
      {share !== null && (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className="track" />
          {frac > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} strokeLinecap="round" className="arc" strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        </svg>
      )}
      <span className="n">{children}</span>
    </span>
  );
}

export interface Datum { label: string; value: number; title?: string; hint?: string }

/** Vertical columns on a baseline; the last one can be marked (today). */
export function Columns({ data, height = 120, label, mark, empty = 'Nothing yet' }: { data: Datum[]; height?: number; label: string; mark?: number; empty?: string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0 || total === 0) return <div className="chart-empty" role="img" aria-label={`${label}: ${empty}`}>{empty}</div>;
  const w = 100 / data.length;
  return (
    <svg className="chart columns" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={`${label}: ${total} in all`}>
      <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="base" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => {
        const h = d.value === 0 ? 0 : Math.max(2, (d.value / max) * (height - 6));
        return (
          <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={height - 1 - h} height={h} rx={0.8} className={classNames('bar', i === mark && 'mark')}>
            <title>{d.title ?? `${d.label}: ${d.value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Horizontal bars with a name and a number each, the biggest taking the whole width. */
export function HBars({ rows, label, empty = 'Nothing yet' }: { rows: { key: string; label: string; value: number; href?: string; hint?: string }[]; label: string; empty?: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (rows.length === 0) return <div className="chart-empty" role="img" aria-label={`${label}: ${empty}`}>{empty}</div>;
  return (
    <ul className="hbars" aria-label={label}>
      {rows.map(r => (
        <li key={r.key}>
          {r.href ? <a className="name" href={r.href} title={r.label}>{r.label}</a> : <span className="name" title={r.label}>{r.label}</span>}
          <span className="track" role="img" aria-label={`${r.label}: ${r.value}${r.hint ? ' ' + r.hint : ''}`}><i style={{ width: `${Math.max(r.value ? 4 : 0, (r.value / max) * 100)}%` }} /></span>
          <b>{r.value}{r.hint ? <small> {r.hint}</small> : null}</b>
        </li>
      ))}
    </ul>
  );
}

/** A line over equal steps with the area under it; `null` leaves a gap. Values run 0..max. */
export function Line({ values, max = 1, height = 56, label, empty = 'Nothing yet' }: { values: (number | null)[]; max?: number; height?: number; label: string; empty?: string }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return <div className="chart-empty" role="img" aria-label={`${label}: ${empty}`}>{empty}</div>;
  const top = Math.max(max, 1e-9);
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const y = (v: number) => height - 3 - (Math.min(v, top) / top) * (height - 8);
  const runs: [number, number][][] = [];
  values.forEach((v, i) => {
    if (v === null) { runs.push([]); return; }
    if (!runs.length) runs.push([]);
    runs[runs.length - 1].push([i * step, y(v)]);
  });
  const lines = runs.filter(r => r.length > 0);
  return (
    <svg className="chart line" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
      <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} className="base" vectorEffect="non-scaling-stroke" />
      {lines.map((r, i) => r.length > 1 && <path key={`a${i}`} d={`M${r[0][0]} ${height - 1} ${r.map(p => `L${p[0]} ${p[1]}`).join(' ')} L${r[r.length - 1][0]} ${height - 1} Z`} className="area" />)}
      {lines.map((r, i) => <polyline key={`l${i}`} points={r.map(p => p.join(' ')).join(' ')} fill="none" className="stroke" vectorEffect="non-scaling-stroke" />)}
      {lines.filter(r => r.length === 1).map((r, i) => <circle key={`d${i}`} cx={r[0][0]} cy={r[0][1]} r={1.6} className="dot" />)}
    </svg>
  );
}

/** The year as columns of days; `level` 0..4 (darker is more), -1 draws nothing. */
export function HeatGrid({ weeks, label, onPick }: { weeks: { date: string; level: number }[][]; label: string; onPick?: (date: string) => void }) {
  return (
    <div className="heatgrid" role="img" aria-label={label}>
      {weeks.map((w, i) => (
        <div className="col" key={i}>
          {w.map(c => <i key={c.date} className={classNames('cell', `l${c.level}`)} title={c.date} onClick={onPick ? () => onPick(c.date) : undefined} />)}
        </div>
      ))}
    </div>
  );
}
