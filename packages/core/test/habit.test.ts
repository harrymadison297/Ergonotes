import { describe, expect, it } from 'vitest';
import { addCheckIn, addDays, dayStates, habitDef, habitStatus, nudgeFor, parseLog, setRemark, type HabitDef } from '../src/habit.ts';
import { parseTasks } from '../src/markdown.ts';

const def = (target: number, per: 1 | 3 | 5 | 7, start: string | null = null): HabitDef => ({ target, per, start, archived: false });
const on = (...days: string[]) => days.map(date => ({ date }));
const T = '2026-10-17';
const ago = (n: number) => addDays(T, -n);

describe('what a note says it is', () => {
  it('is a habit only when it says so, with sane numbers', () => {
    expect(habitDef({})).toBeNull();
    expect(habitDef({ habit: false })).toBeNull();
    expect(habitDef({ habit: true, target: 2, per: 3, start: '2026-10-01' })).toEqual({ target: 2, per: 3, start: '2026-10-01', archived: false });
    expect(habitDef({ habit: true, target: 0, per: 4, start: 'soon' })).toEqual({ target: 1, per: 1, start: null, archived: false });
    expect(habitDef({ habit: true, archived: true })?.archived).toBe(true);
  });
});

describe('the days of a habit', () => {
  it('once a day: met on the days done, behind on the days not, today still open', () => {
    const s = habitStatus(def(1, 1, ago(5)), on(ago(5), ago(4), ago(2)), T);
    expect(s.days.slice(-6).map(d => d.state)).toEqual(['met', 'met', 'behind', 'met', 'behind', 'pending']);
    expect(s.todayState).toBe('pending');
    expect(s.left).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.streak).toBe(0);
    expect(s.best).toBe(2);
  });

  it('counts the days in a row up to today, or up to yesterday while today is open', () => {
    expect(habitStatus(def(1, 1, ago(4)), on(ago(3), ago(2), ago(1)), T).streak).toBe(3);
    const withToday = habitStatus(def(1, 1, ago(4)), on(ago(3), ago(2), ago(1), T), T);
    expect(withToday.streak).toBe(4);
    expect(withToday.todayState).toBe('met');
    expect(withToday.missed).toBe(0);
  });

  it('twice a day needs both', () => {
    const s = habitStatus(def(2, 1, ago(1)), on(ago(1), ago(1), T), T);
    expect(s.days.slice(-2).map(d => d.state)).toEqual(['met', 'pending']);
    expect(s.inWindow).toBe(1);
    expect(s.left).toBe(1);
    expect(s.doneToday).toBe(1);
  });

  it('twice in three days: a window that slides', () => {
    // done on day -6 and -5, then nothing; the window of three days
    const s = habitStatus(def(2, 3, ago(8)), on(ago(6), ago(5)), T);
    const state = Object.fromEntries(s.days.slice(-9).map(d => [d.date, d.state]));
    expect(state[ago(8)]).toBe('exempt'); // the window is not yet full
    expect(state[ago(7)]).toBe('exempt');
    expect(state[ago(6)]).toBe('behind'); // one in the window
    expect(state[ago(5)]).toBe('met'); // two in the window
    expect(state[ago(4)]).toBe('met'); // -6 and -5 still in
    expect(state[ago(3)]).toBe('behind'); // -6 has left the window: only -5 is in it
  });

  it('is not judged before it starts, nor in the first days when the window is not full, unless met', () => {
    const s = habitStatus(def(1, 3, ago(1)), [], T);
    expect(s.days.slice(-3).map(d => d.state)).toEqual(['exempt', 'exempt', 'exempt']); // before the start, and the start day and today: the window is not yet full
    expect(s.missed).toBe(0);
    const early = habitStatus(def(1, 3, ago(1)), on(ago(1)), T);
    expect(early.days.at(-2)!.state).toBe('met');
  });

  it('starts on its first check-in when it has no start day, and a start in the future judges nothing', () => {
    expect(habitStatus(def(1, 1), on(ago(2)), T).start).toBe(ago(2));
    const later = habitStatus(def(1, 1, addDays(T, 5)), [], T);
    expect(later.todayState).toBe('exempt');
    expect(later.missed).toBe(0);
    expect(later.days.at(-1)!.state).toBe('exempt');
  });

  it('counts the misses in a row up to yesterday and the best run', () => {
    const s = habitStatus(def(1, 1, ago(12)), on(ago(12), ago(11), ago(10), ago(9), ago(8), ago(3)), T);
    expect(s.missed).toBe(2); // -1 and -2 are behind, -3 is met
    expect(s.best).toBe(5);
  });

  it('rates over 7, 30 and 90 days count only the days that were judged', () => {
    const s = habitStatus(def(1, 1, ago(9)), on(ago(9), ago(8), ago(7), ago(6), ago(5)), T);
    // judged days in the last 10: -9..-1 (nine), today is open; met: five of nine
    expect(s.rate.d30).toBeCloseTo(5 / 9);
    expect(s.rate.d7).toBeCloseTo(2 / 6); // -6 and -5 met, -4..-1 behind, today still open
  });

  it('has no rate before anything was judged', () => {
    const s = habitStatus(def(1, 1, T), [], T);
    expect(s.rate).toEqual({ d7: null, d30: null, d90: null });
  });

  it('gives the grid of days asked for, oldest first', () => {
    const s = habitStatus(def(1, 1, ago(100)), [], T, 84);
    expect(s.days).toHaveLength(84);
    expect(s.days[0].date).toBe(addDays(T, -83));
    expect(s.days.at(-1)!.date).toBe(T);
  });

  it('answers for a range, for the Calendar', () => {
    const r = dayStates(def(1, 1, ago(3)), on(ago(2)), T, ago(4), addDays(T, 1));
    expect(r.map(x => x.state)).toEqual(['exempt', 'behind', 'met', 'behind', 'pending', 'future']);
  });
});

describe('the words about a habit', () => {
  const s = (check: string[], start = ago(40)) => habitStatus(def(1, 1, start), on(...check), T);
  const run = (n: number, endAt = 0) => Array.from({ length: n }, (_, i) => ago(endAt + i));

  it('praises a milestone of the streak and a day done, in that order', () => {
    expect(nudgeFor(s(run(3)))?.key).toBe('streak-3');
    expect(nudgeFor(s(run(7)))?.text).toMatch(/week/);
    expect(nudgeFor(s(run(4)))?.key).toBe(`done-${T}`);
    expect(nudgeFor(s(run(100), ago(150)))?.key).toBe('streak-100');
  });

  it('says nothing when it was done before today and today is still open with no misses', () => {
    expect(nudgeFor(s(run(2, 1)))).toBeNull();
  });

  it('gets gentler and then firmer with each day missed', () => {
    const missed = (n: number) => s(run(5, n + 1));
    expect(nudgeFor(missed(1))).toMatchObject({ tone: 'gentle' });
    expect(nudgeFor(missed(1))!.text).toMatch(/Yesterday/);
    expect(nudgeFor(missed(2))!.text).toMatch(/Two days/);
    expect(nudgeFor(missed(4))!.text).toMatch(/4 days/);
    expect(nudgeFor(missed(8))).toMatchObject({ tone: 'firm' });
    expect(nudgeFor(missed(8))!.text).toMatch(/archive/);
  });

  it('does not say a thing about a habit that has not been judged yet', () => {
    expect(nudgeFor(habitStatus(def(1, 1, T), [], T))).toBeNull();
  });
});

describe('the log in the note', () => {
  const NOTE = ['Drink water.', '', '## Log', '', '- [x] @done(2026-10-15T08:10) glass', '- 2026-10-16: rain, stayed in', '- [x] @done(2026-10-16T19:00)', '', '## Other', '', '- [x] @done(2026-10-17) not here'].join('\n');

  it('reads check-ins anywhere and remarks under Log', () => {
    const { checkIns, remarks } = parseLog(NOTE);
    expect(checkIns.map(c => [c.date, c.time, c.text])).toEqual([['2026-10-15', '08:10', 'glass'], ['2026-10-16', '19:00', ''], ['2026-10-17', undefined, 'not here']]);
    expect(remarks).toEqual([{ date: '2026-10-16', text: 'rain, stayed in', line: 5 }]);
  });

  it('is seen by the task parser, so the Calendar and the Tasks page count the lines on their @done day', () => {
    const t = parseTasks('- [x] @done(2026-10-15T08:10) glass');
    expect(t[0]).toMatchObject({ done: true, doneAt: '2026-10-15T08:10', text: 'glass' });
  });

  it('adds a check-in in the order of the days, after the one before it', () => {
    const out = addCheckIn(NOTE, { date: '2026-10-16', time: '12:00', text: 'lunch' });
    const lines = out.split('\n');
    expect(lines.indexOf('- [x] @done(2026-10-16T12:00) lunch')).toBe(lines.indexOf('- 2026-10-16: rain, stayed in') + 1);
    expect(lines.indexOf('- [x] @done(2026-10-16T19:00)')).toBeGreaterThan(lines.indexOf('- [x] @done(2026-10-16T12:00) lunch'));
    // nothing else changed
    expect(out.replace('- [x] @done(2026-10-16T12:00) lunch\n', '')).toBe(NOTE);
  });

  it('adds one at the end of the log, and one before all of it', () => {
    expect(addCheckIn(NOTE, { date: '2026-10-17', time: '07:00' }).split('\n')).toContain('- [x] @done(2026-10-17T07:00)');
    const out = addCheckIn(NOTE, { date: '2026-10-01' }).split('\n');
    expect(out.indexOf('- [x] @done(2026-10-01)')).toBeLessThan(out.indexOf('- [x] @done(2026-10-15T08:10) glass'));
    expect(out.indexOf('- [x] @done(2026-10-01)')).toBeGreaterThan(out.indexOf('## Log'));
  });

  it('makes the log when there is none, and ends the file with a newline', () => {
    expect(addCheckIn('Notes only', { date: T, time: '07:00', text: 'ran' })).toBe('Notes only\n\n## Log\n\n- [x] @done(2026-10-17T07:00) ran\n');
    expect(addCheckIn('', { date: T })).toBe('## Log\n\n- [x] @done(2026-10-17)\n');
    expect(addCheckIn('## Log\n', { date: T })).toBe('## Log\n\n- [x] @done(2026-10-17)\n');
  });

  it('keeps a comment on one line', () => {
    expect(addCheckIn('## Log\n', { date: T, text: 'a\nb' })).toContain('@done(2026-10-17) a b');
  });

  it('sets, changes and removes the remark of a day', () => {
    const added = setRemark(NOTE, '2026-10-15', 'felt tired');
    expect(parseLog(added).remarks.map(r => r.date)).toEqual(['2026-10-15', '2026-10-16']);
    const changed = setRemark(added, '2026-10-15', 'felt fine');
    expect(parseLog(changed).remarks[0].text).toBe('felt fine');
    expect(setRemark(changed, '2026-10-15', '')).toBe(NOTE);
    expect(setRemark(NOTE, '2026-10-01', '')).toBe(NOTE);
  });
});
