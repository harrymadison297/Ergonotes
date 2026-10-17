// Habits (CONTEXT.md, Habit; ADR 0013, 0014). A Habit is a Markdown file in the hidden `.habits/` folder that holds only what
// the person did and when; the state of each day, the misses, the streak and the rates are computed from it. Days are `YYYY-MM-DD` strings (the person's
// own calendar day), so nothing here depends on a time zone.
import type { Frontmatter } from './markdown.ts';
import { parseTasks } from './markdown.ts';

export const HABIT_FOLDER = '.habits';
/** The title of a Markdown link that mentions a Habit: `[Run](.habits/Run.md "type_habit")`, as `type_record` marks a Record. */
export const HABIT_LINK_TITLE = 'type_habit';
/** A file that is a Habit by where it is: `.habits/<name>.md`, nothing deeper. */
export const isHabitPath = (path: string): boolean => /^\.habits\/[^/]+\.md$/i.test(path);
export const PERIODS = [1, 3, 5, 7] as const;
export type Period = (typeof PERIODS)[number];

export interface HabitDef {
  /** how many times ... */
  target: number;
  /** ... in this many days, counted over the window that ends on the day looked at */
  per: Period;
  /** the first day that counts; absent: the day of the first Check-in */
  start: string | null;
  archived: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TARGET = 99;

/** The Habit a Note's frontmatter describes, or null when it is not one. Out-of-range numbers fall back to once a day. */
export function habitDef(fm: Frontmatter): HabitDef | null {
  if (fm.habit !== true && fm.habit !== 'true') return null;
  const t = Number(fm.target);
  const p = Number(fm.per);
  const start = typeof fm.start === 'string' ? fm.start.slice(0, 10) : fm.start instanceof Date ? fm.start.toISOString().slice(0, 10) : null;
  return {
    target: Number.isInteger(t) && t >= 1 && t <= MAX_TARGET ? t : 1,
    per: (PERIODS as readonly number[]).includes(p) ? (p as Period) : 1,
    start: start && DAY_RE.test(start) ? start : null,
    archived: fm.archived === true || fm.archived === 'true',
  };
}

// ---------------------------------------------------------------- days
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// ---------------------------------------------------------------- the log
export interface CheckIn { date: string; time?: string; text: string; line: number }
export interface Remark { date: string; text: string; line: number }

const LOG_HEAD = /^#{2}\s+Log\s*$/i;
const ANY_HEAD = /^#{1,6}\s/;
const REMARK_RE = /^[-*+]\s+(\d{4}-\d{2}-\d{2}):\s?(.*)$/;

/** Where the `## Log` section is: its heading line and the line after its last one. */
function logSection(lines: string[]): { head: number; end: number } | null {
  const head = lines.findIndex(l => LOG_HEAD.test(l));
  if (head < 0) return null;
  let end = lines.length;
  for (let i = head + 1; i < lines.length; i++) if (ANY_HEAD.test(lines[i])) { end = i; break; }
  return { head, end };
}

/** Every `- [x] @done(...)` line of the note is a Check-in; a day's remark is a bullet `- 2026-10-16: reason` under `## Log`. */
export function parseLog(body: string): { checkIns: CheckIn[]; remarks: Remark[] } {
  const checkIns: CheckIn[] = [];
  for (const t of parseTasks(body)) {
    if (!t.done || !t.doneAt) continue;
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(t.doneAt);
    if (m) checkIns.push({ date: m[1], time: m[2], text: t.text, line: t.line });
  }
  const lines = body.split('\n');
  const remarks: Remark[] = [];
  const sec = logSection(lines);
  if (sec) for (let i = sec.head + 1; i < sec.end; i++) {
    const m = REMARK_RE.exec(lines[i]);
    if (m) remarks.push({ date: m[1], text: m[2].trim(), line: i });
  }
  return { checkIns, remarks };
}

const checkInLine = (c: { date: string; time?: string; text?: string }) => `- [x] @done(${c.date}${c.time ? 'T' + c.time : ''})${c.text?.trim() ? ' ' + c.text.trim().replace(/\s*\n\s*/g, ' ') : ''}`;
const remarkLine = (date: string, text: string) => `- ${date}: ${text.trim().replace(/\s*\n\s*/g, ' ')}`;

/** Sort key of a line of the log: remarks come before the Check-ins of their day. */
function keyOf(line: string): string | null {
  const r = REMARK_RE.exec(line);
  if (r) return `${r[1]}T`;
  const m = /^\s*[-*+] \[[xX]\] .*?@done\((\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?\)/.exec(line);
  return m ? `${m[1]}T${m[2] ?? '00:00'}~` : null;
}

function insertInLog(body: string, line: string, key: string): string {
  const endsNl = body.endsWith('\n');
  const lines = body.split('\n');
  if (endsNl) lines.pop(); // the newline that ends the file stays where it is
  const sec = logSection(lines);
  if (!sec) {
    const base = body.replace(/\n*$/, '');
    return `${base}${base ? '\n\n' : ''}## Log\n\n${line}\n`;
  }
  // after the last entry that is not later than this one; the entries stay in the order of their days
  let at = -1;
  for (let i = sec.head + 1; i < sec.end; i++) { const k = keyOf(lines[i]); if (k !== null && k <= key) at = i; }
  if (at >= 0) lines.splice(at + 1, 0, line);
  else {
    // before every entry: right after the heading and the blank line that follows it
    let first = sec.head + 1;
    while (first < sec.end && lines[first].trim() === '') first++;
    const firstEntry = (() => { for (let i = sec.head + 1; i < sec.end; i++) if (keyOf(lines[i]) !== null) return i; return -1; })();
    const place = firstEntry >= 0 ? firstEntry : first;
    lines.splice(place, 0, line);
    if (firstEntry < 0 && place === sec.head + 1) lines.splice(place, 0, '');
  }
  return lines.join('\n') + (endsNl ? '\n' : '');
}

/** Write one Check-in into the log, in the order of the days. */
export function addCheckIn(body: string, c: { date: string; time?: string; text?: string }): string {
  return insertInLog(body, checkInLine(c), `${c.date}T${c.time ?? '00:00'}~`);
}

/** Set (or, with empty text, remove) the remark of a day. */
export function setRemark(body: string, date: string, text: string): string {
  const lines = body.split('\n');
  const sec = logSection(lines);
  if (sec) for (let i = sec.head + 1; i < sec.end; i++) {
    const m = REMARK_RE.exec(lines[i]);
    if (m && m[1] === date) {
      if (text.trim()) lines[i] = remarkLine(date, text); else lines.splice(i, 1);
      return lines.join('\n');
    }
  }
  return text.trim() ? insertInLog(body, remarkLine(date, text), `${date}T`) : body;
}

// ---------------------------------------------------------------- the state of the days
export type DayState = 'met' | 'behind' | 'exempt' | 'pending' | 'future';
export interface HabitDay { date: string; state: DayState; /** Check-ins that day */ count: number; /** Check-ins in the window ending that day */ inWindow: number }

export interface HabitStatus {
  today: string;
  /** the first day that counts */
  start: string;
  doneToday: number;
  inWindow: number;
  /** Check-ins still wanted for today's window to be met */
  left: number;
  todayState: DayState;
  /** met days in a row ending today (ending yesterday while today is still open) */
  streak: number;
  best: number;
  /** behind days in a row ending yesterday */
  missed: number;
  last: string | null;
  /** met days over judged days (met or behind) in the last 7, 30 and 90 days; null when none was judged */
  rate: { d7: number | null; d30: number | null; d90: number | null };
  days: HabitDay[];
}

const HISTORY = 800;

export function habitStatus(def: HabitDef, checkIns: { date: string }[], today: string, span = 84): HabitStatus {
  const count = new Map<string, number>();
  for (const c of checkIns) count.set(c.date, (count.get(c.date) ?? 0) + 1);
  const firstCheckIn = checkIns.length ? checkIns.reduce((a, c) => (c.date < a ? c.date : a), checkIns[0].date) : null;
  const start = [def.start, firstCheckIn].filter((d): d is string => !!d).sort()[0] ?? today;
  const last = checkIns.length ? checkIns.reduce((a, c) => (c.date > a ? c.date : a), checkIns[0].date) : null;

  let from = [start, addDays(today, -(HISTORY - 1))].sort().at(-1)!;
  if (from > today) from = today; // a Habit that starts later has nothing to judge yet
  const first = daysBetween(from, today);
  // prefix sums over [from - per, today] so that every window is a difference
  const startOfCounts = addDays(from, -def.per);
  const total = daysBetween(startOfCounts, today) + 1;
  const prefix = new Array<number>(total + 1).fill(0);
  for (let i = 0; i < total; i++) prefix[i + 1] = prefix[i] + (count.get(addDays(startOfCounts, i)) ?? 0);
  const windowEnding = (d: string) => {
    const hi = daysBetween(startOfCounts, d) + 1; // exclusive
    const lo = Math.max(0, hi - def.per);
    return prefix[hi] - prefix[lo];
  };
  const stateOf = (d: string): DayState => {
    if (d > today) return 'future';
    if (d < start) return 'exempt';
    if (windowEnding(d) >= def.target) return 'met';
    if (d < addDays(start, def.per - 1)) return 'exempt'; // the window is not yet full
    return d === today ? 'pending' : 'behind';
  };

  const states = new Map<string, DayState>();
  for (let i = 0; i <= first; i++) { const d = addDays(from, i); states.set(d, stateOf(d)); }

  let best = 0, run = 0;
  for (let i = 0; i <= first; i++) { if (states.get(addDays(from, i)) === 'met') { run++; best = Math.max(best, run); } else run = 0; }

  const todayState = states.get(today) ?? stateOf(today);
  let streak = 0;
  for (let d = todayState === 'met' ? today : addDays(today, -1); states.get(d) === 'met'; d = addDays(d, -1)) streak++;
  let missed = 0;
  for (let d = addDays(today, -1); states.get(d) === 'behind'; d = addDays(d, -1)) missed++;

  const rateOver = (n: number): number | null => {
    let met = 0, judged = 0;
    for (let i = 0; i < n; i++) {
      const s = states.get(addDays(today, -i));
      if (s === 'met') { met++; judged++; } else if (s === 'behind') judged++;
    }
    return judged ? met / judged : null;
  };

  const days: HabitDay[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ date: d, state: states.get(d) ?? (d < from ? 'exempt' : stateOf(d)), count: count.get(d) ?? 0, inWindow: d < from ? 0 : windowEnding(d) });
  }
  const inWindow = windowEnding(today);
  return {
    today, start, doneToday: count.get(today) ?? 0, inWindow, left: Math.max(0, def.target - inWindow), todayState, streak, best, missed, last,
    rate: { d7: rateOver(7), d30: rateOver(30), d90: rateOver(90) }, days,
  };
}

/** The state of any day in a range, for a Calendar that asks about many Habits at once. */
export function dayStates(def: HabitDef, checkIns: { date: string }[], today: string, from: string, to: string): { date: string; state: DayState }[] {
  const out: { date: string; state: DayState }[] = [];
  const s = habitStatus(def, checkIns, today, Math.max(1, Math.min(daysBetween(from, today) + 1, 1000)));
  const byDate = new Map(s.days.map(d => [d.date, d.state]));
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, state: byDate.get(d) ?? (d > today ? 'future' : 'exempt') });
  return out;
}

// ---------------------------------------------------------------- the words
export const MILESTONES = [3, 7, 14, 30, 60, 100] as const;
export type NudgeTone = 'good' | 'gentle' | 'firm';
export interface Nudge { /** changes when the message does, so that dismissing one does not hide the next */ key: string; tone: NudgeTone; text: string }

const MILESTONE_TEXT: Record<number, string> = {
  3: 'Three days in a row. It is starting to stick.',
  7: 'A full week in a row. Keep it light and keep going.',
  14: 'Two weeks in a row. This is turning into a habit.',
  30: 'Thirty days in a row. That is a real habit now.',
  60: 'Sixty days in a row. It is part of your life.',
  100: 'One hundred days in a row. Remarkable.',
};

/** The sentence to show about a Habit now, or null. Fixed words: no AI is involved (ADR 0013). */
export function nudgeFor(s: HabitStatus): Nudge | null {
  if (s.todayState === 'met') {
    if ((MILESTONES as readonly number[]).includes(s.streak)) return { key: `streak-${s.streak}`, tone: 'good', text: MILESTONE_TEXT[s.streak] };
    if (s.doneToday > 0) return { key: `done-${s.today}`, tone: 'good', text: 'Done for today. Nicely kept.' };
    return null;
  }
  const m = s.missed;
  if (m >= 7) return { key: `missed-7-${s.today}`, tone: 'firm', text: 'A week has gone by without it. If this habit no longer fits, archive it, or restart with just one.' };
  if (m >= 3) return { key: `missed-3-${s.today}`, tone: 'gentle', text: `${m} days without it. Restart with just one; a small start counts.` };
  if (m === 2) return { key: `missed-2-${s.today}`, tone: 'gentle', text: 'Two days without it. Try the smallest version of it today.' };
  if (m === 1) return { key: `missed-1-${s.today}`, tone: 'gentle', text: 'Yesterday slipped by. Today is a fresh start.' };
  return null;
}
