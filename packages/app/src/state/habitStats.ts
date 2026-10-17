// The figures of the habit Widgets (CONTEXT.md, Habit day): computed from the days the vault gives, never stored.
import { addDays, type HabitDayEntry } from '@ergonotes/core';

export const monthOf = (day: string): string => day.slice(0, 7);
export const addMonths = (ym: string, n: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
export const daysInMonth = (ym: string): number => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const monthFirst = (ym: string): string => `${ym}-01`;
export const monthLast = (ym: string): string => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`;
const weekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();

/** The cells of a month, Sunday first: a day, or null for the empty cells before the 1st and after the last day. */
export function monthCells(ym: string): (string | null)[] {
  const cells: (string | null)[] = Array(weekday(monthFirst(ym))).fill(null);
  for (let d = 1; d <= daysInMonth(ym); d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export interface DayShare { met: number; total: number }

/** Per day: the Habits met, and the Habits that count that day (met, behind, or still open today). Exempt days count for nothing. */
export function dayShares(entries: HabitDayEntry[]): Map<string, DayShare> {
  const m = new Map<string, DayShare>();
  for (const e of entries) {
    if (e.state === 'exempt') continue;
    const s = m.get(e.date) ?? { met: 0, total: 0 };
    s.total++;
    if (e.state === 'met') s.met++;
    m.set(e.date, s);
  }
  return m;
}

/** Met Habit days over judged Habit days (met or behind; a day still open is not judged yet) in a month; null when none was judged. */
export function monthRate(entries: HabitDayEntry[], ym: string): { met: number; judged: number; rate: number | null } {
  let met = 0, judged = 0;
  for (const e of entries) {
    if (monthOf(e.date) !== ym) continue;
    if (e.state === 'met') { met++; judged++; } else if (e.state === 'behind') judged++;
  }
  return { met, judged, rate: judged ? met / judged : null };
}

/** The change of a rate against another, in percentage points, to one decimal; null when either is unknown. */
export function rateChange(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  return Math.round((now - before) * 1000) / 10;
}

/** The rate of each day of a month, for the little line: null where no Habit was judged. */
export function rateSeries(entries: HabitDayEntry[], ym: string): { date: string; rate: number | null }[] {
  const by = new Map<string, { met: number; judged: number }>();
  for (const e of entries) {
    if (monthOf(e.date) !== ym) continue;
    const s = by.get(e.date) ?? { met: 0, judged: 0 };
    if (e.state === 'met') { s.met++; s.judged++; } else if (e.state === 'behind') s.judged++;
    by.set(e.date, s);
  }
  const out: { date: string; rate: number | null }[] = [];
  for (let d = 1; d <= daysInMonth(ym); d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const s = by.get(date);
    out.push({ date, rate: s && s.judged ? s.met / s.judged : null });
  }
  return out;
}

/** The Check-ins of each Habit in a month, the most first. */
export function checkInBars(entries: HabitDayEntry[], ym: string): { habitId: string; title: string; count: number }[] {
  const by = new Map<string, { habitId: string; title: string; count: number }>();
  for (const e of entries) {
    if (monthOf(e.date) !== ym) continue;
    const b = by.get(e.habitId) ?? { habitId: e.habitId, title: e.title, count: 0 };
    b.count += e.count;
    by.set(e.habitId, b);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, undefined, { numeric: true }));
}

/** A whole year as columns of seven days (Sunday first): the day, and 0..4 for how much of the Habits was met (-1: nothing counted). */
export function heatWeeks(shares: Map<string, DayShare>, today: string, weeks = 53): { date: string; level: number }[][] {
  const lastSunday = addDays(today, -weekday(today));
  const first = addDays(lastSunday, -7 * (weeks - 1));
  const cols: { date: string; level: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: { date: string; level: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, w * 7 + d);
      const s = date > today ? undefined : shares.get(date);
      col.push({ date, level: date > today || !s || s.total === 0 ? -1 : s.met === 0 ? 0 : Math.max(1, Math.ceil((s.met / s.total) * 4)) });
    }
    cols.push(col);
  }
  return cols;
}

/** Habits by the length of their streak now, longest first; those with none are left out. */
export function longestStreaks<T extends { status: { streak: number }; archived: boolean; title: string }>(hs: T[]): T[] {
  return hs.filter(h => !h.archived && h.status.streak > 0).sort((a, b) => b.status.streak - a.status.streak || a.title.localeCompare(b.title, undefined, { numeric: true }));
}

// ---- counts of the notes and tasks, for the activity Widgets
/** Per day over the last `days` days (ending `today`): how many of the ISO times fall on it. */
export function perDay(times: (string | null | undefined)[], today: string, days: number, toDay: (iso: string) => string): { date: string; count: number }[] {
  const out = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) out.set(addDays(today, -i), 0);
  for (const t of times) { if (!t) continue; const d = toDay(t); if (out.has(d)) out.set(d, out.get(d)! + 1); }
  return [...out].map(([date, count]) => ({ date, count }));
}

/** Per week over the last `weeks` weeks (each ending on the day `today` falls in the week of, counting back by sevens). */
export function perWeek(days: (string | null | undefined)[], today: string, weeks: number): { from: string; count: number }[] {
  const out: { from: string; count: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) out.push({ from: addDays(today, -(w * 7 + 6)), count: 0 });
  for (const d of days) {
    if (!d) continue;
    const day = d.slice(0, 10);
    for (let i = 0; i < out.length; i++) {
      const from = out[i].from;
      if (day >= from && day <= addDays(from, 6)) { out[i].count++; break; }
    }
  }
  return out;
}
