// The figures of the habit Widgets: rings, the month's rate and its change, bars, the year, the activity counts.
import { describe, expect, it } from 'vitest';
import type { HabitDayEntry } from '@ergonotes/core';
import {
  addMonths, checkInBars, dayShares, daysInMonth, heatWeeks, longestStreaks, monthCells, monthLast, monthOf, monthRate, perDay, perWeek, rateChange, rateSeries,
} from '../src/state/habitStats';

const e = (habitId: string, date: string, state: HabitDayEntry['state'], count = 0): HabitDayEntry => ({ habitId, title: habitId.toUpperCase(), date, state, count });

describe('months', () => {
  it('step over a year and know their length', () => {
    expect(addMonths('2026-10', 1)).toBe('2026-11');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-03', -15)).toBe('2024-12');
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-10')).toBe(31);
    expect(monthLast('2026-11')).toBe('2026-11-30');
    expect(monthOf('2026-10-17')).toBe('2026-10');
  });
  it('lay out as weeks that start on Sunday', () => {
    const c = monthCells('2026-10'); // 1 October 2026 is a Thursday
    expect(c).toHaveLength(35);
    expect(c.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01']);
    expect(c[34]).toBe('2026-10-31');
    expect(monthCells('2026-02')).toHaveLength(28); // 1 Feb 2026 is a Sunday and the month is 28 days
    expect(monthCells('2026-08').filter(Boolean)).toHaveLength(31);
    for (const ym of ['2026-01', '2026-05', '2026-11']) expect(monthCells(ym).length % 7).toBe(0);
  });
});

describe('the ring of a day', () => {
  it('is the Habits met over the Habits that count, and an exempt day counts for nothing', () => {
    const s = dayShares([e('a', '2026-10-10', 'met'), e('b', '2026-10-10', 'behind'), e('c', '2026-10-10', 'exempt'), e('a', '2026-10-11', 'pending'), e('b', '2026-10-11', 'met')]);
    expect(s.get('2026-10-10')).toEqual({ met: 1, total: 2 });
    expect(s.get('2026-10-11')).toEqual({ met: 1, total: 2 });
    expect(s.get('2026-10-12')).toBeUndefined();
  });
});

describe('the rate of a month', () => {
  const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}`;
  it('is met days over judged days, and a day still open is not judged', () => {
    const entries = [e('a', day(1), 'met'), e('a', day(2), 'met'), e('a', day(3), 'behind'), e('a', day(4), 'pending'), e('a', day(5), 'exempt'), e('b', day(1), 'behind'), e('a', '2026-09-30', 'met')];
    expect(monthRate(entries, '2026-10')).toEqual({ met: 2, judged: 4, rate: 0.5 });
    expect(monthRate(entries, '2026-09')).toEqual({ met: 1, judged: 1, rate: 1 });
    expect(monthRate(entries, '2026-08')).toEqual({ met: 0, judged: 0, rate: null });
  });
  it('changes in percentage points against the month before, to one decimal', () => {
    expect(rateChange(0.75, 0.5)).toBe(25);
    expect(rateChange(0.5, 0.75)).toBe(-25);
    expect(rateChange(0.6667, 0.6)).toBe(6.7);
    expect(rateChange(0.5, 0.5)).toBe(0);
    expect(rateChange(null, 0.5)).toBeNull();
    expect(rateChange(0.5, null)).toBeNull();
  });
  it('is given day by day, with nothing on days that were not judged', () => {
    const s = rateSeries([e('a', day(1), 'met'), e('b', day(1), 'behind'), e('a', day(2), 'met'), e('a', day(3), 'pending')], '2026-10');
    expect(s).toHaveLength(31);
    expect(s[0]).toEqual({ date: day(1), rate: 0.5 });
    expect(s[1].rate).toBe(1);
    expect(s[2].rate).toBeNull();
    expect(s[30].rate).toBeNull();
  });
});

describe('the bars', () => {
  it('add up the Check-ins of each Habit in the month, the most first', () => {
    const bars = checkInBars([e('a', '2026-10-01', 'met', 2), e('a', '2026-10-02', 'met', 1), e('b', '2026-10-01', 'met', 5), e('c', '2026-10-03', 'behind', 0), e('a', '2026-09-30', 'met', 9)], '2026-10');
    expect(bars.map(b => [b.habitId, b.count])).toEqual([['b', 5], ['a', 3], ['c', 0]]);
  });
});

describe('the year', () => {
  it('is 53 weeks of seven days, Sunday first, ending in the week of today', () => {
    const w = heatWeeks(new Map(), '2026-10-17');
    expect(w).toHaveLength(53);
    expect(w.every(c => c.length === 7)).toBe(true);
    expect(w[52][6].date).toBe('2026-10-17'); // a Saturday
    expect(w[0][0].date).toBe('2025-10-12');
    for (const c of w) expect(new Date(c[0].date + 'T00:00:00Z').getUTCDay()).toBe(0);
  });
  it('is darker with more of the Habits met, and nothing on days to come or without a Habit', () => {
    const shares = new Map([['2026-10-16', { met: 0, total: 2 }], ['2026-10-15', { met: 1, total: 4 }], ['2026-10-14', { met: 2, total: 4 }], ['2026-10-13', { met: 3, total: 4 }], ['2026-10-12', { met: 4, total: 4 }], ['2026-10-18', { met: 4, total: 4 }]]);
    const flat = heatWeeks(shares, '2026-10-14').flat();
    const level = (d: string) => flat.find(c => c.date === d)!.level;
    expect(level('2026-10-12')).toBe(4);
    expect(level('2026-10-13')).toBe(3);
    expect(level('2026-10-14')).toBe(2);
    expect(level('2026-10-15')).toBe(-1);
    expect(level('2026-10-10')).toBe(-1);
    const all = heatWeeks(shares, '2026-10-17').flat();
    expect(all.find(c => c.date === '2026-10-16')!.level).toBe(0);
    expect(all.find(c => c.date === '2026-10-15')!.level).toBe(1);
  });
});

describe('streaks', () => {
  it('list the longest first, and leave out the archived and the ones with none', () => {
    const h = (title: string, streak: number, archived = false) => ({ title, archived, status: { streak } });
    expect(longestStreaks([h('b', 3), h('a', 3), h('c', 0), h('d', 9, true), h('e', 12)]).map(x => x.title)).toEqual(['e', 'a', 'b']);
  });
});

describe('the activity', () => {
  const same = (iso: string) => iso.slice(0, 10);
  it('counts per day over the last days, ignoring what is older', () => {
    const r = perDay(['2026-10-17T08:00', '2026-10-17T09:00', '2026-10-15T01:00', '2026-09-01T00:00', null, undefined], '2026-10-17', 3, same);
    expect(r).toEqual([{ date: '2026-10-15', count: 1 }, { date: '2026-10-16', count: 0 }, { date: '2026-10-17', count: 2 }]);
  });
  it('counts per week back from today, in sevens', () => {
    const r = perWeek(['2026-10-17', '2026-10-11', '2026-10-10', '2026-10-04', '2026-09-01', null], '2026-10-17', 3);
    expect(r).toEqual([{ from: '2026-09-27', count: 0 }, { from: '2026-10-04', count: 2 }, { from: '2026-10-11', count: 2 }]);
  });
});
