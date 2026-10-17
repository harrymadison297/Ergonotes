// What the extension needs to know about the files of a vault, without VS Code: paths, titles, links, edits.
import { parseNote } from '../../../packages/core/src/folder.ts';
import { addCheckIn, habitDef, habitStatus, nudgeFor, parseLog, setRemark, type HabitDef, type HabitStatus } from '../../../packages/core/src/habit.ts';

export interface NoteRef { /** the title: the file name without `.md` */ title: string; /** `/`-separated, from the vault root */ path: string }

export const posix = (p: string) => p.replace(/\\/g, '/');
export const titleOf = (p: string) => posix(p).split('/').pop()!.replace(/\.md$/i, '');
export const dirOf = (p: string) => { const s = posix(p); const i = s.lastIndexOf('/'); return i < 0 ? '' : s.slice(0, i); };

/** The path to write in a link from a note in `fromDir` to `to` (both from the vault root): `../Plan.md`, `Sub/Note.md`. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/** What Markdown wants in a link destination: spaces and parentheses are escaped. */
export const encodeDest = (p: string) => p.split('/').map(s => (s === '..' || s === '.' ? s : encodeURIComponent(s).replace(/%28/g, '(').replace(/%29/g, ')'))).join('/');

/** `[Title](relative/Title.md)`: how the app writes a link to a note (ADR 0010). */
export const markdownLink = (fromDir: string, n: NoteRef, title?: string) => `[${n.title}](${encodeDest(relativePath(fromDir, n.path))}${title ? ` "${title}"` : ''})`;
/** A file of the hidden `.habits/` folder: a Habit, not a Note (ADR 0014). */
export const isHabitFile = (path: string): boolean => /^\.habits\/[^/]+\.md$/i.test(path);

/** The notes that match what has been typed after `[[` or `@`: names that start with it first, then names that contain it. */
export function matchNotes(notes: NoteRef[], query: string, limit = 30): NoteRef[] {
  const q = query.trim().toLowerCase();
  const score = (n: NoteRef) => { const t = n.title.toLowerCase(); return !q ? 1 : t.startsWith(q) ? 0 : t.includes(q) ? 1 : n.path.toLowerCase().includes(q) ? 2 : 3; };
  return notes.filter(n => score(n) < 3).sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title, undefined, { numeric: true })).slice(0, limit);
}

// ---------------------------------------------------------------- habits
export interface HabitView { def: HabitDef; status: HabitStatus; nudge: string | null }

/** The Habit a note's text describes and where it stands on `today`, or null when it is not a Habit. */
export function habitOf(text: string, today: string): HabitView | null {
  const { fm, body } = parseNote(text);
  const def = habitDef(fm);
  if (!def) return null;
  const status = habitStatus(def, parseLog(body).checkIns, today, 7);
  return { def, status, nudge: def.archived ? null : nudgeFor(status)?.text ?? null };
}

export function chipFor(h: HabitView): { text: string; met: boolean } {
  const met = h.status.todayState === 'met';
  const streak = h.status.streak > 0 ? `${h.status.streak}-day streak` : 'no streak yet';
  return { met, text: `${streak} · ${h.def.archived ? 'archived' : met ? 'met today' : h.status.todayState === 'exempt' ? 'not counted yet' : `${h.status.left} to go`}` };
}

/** The text of a habit note with one more Check-in written into its log. */
export function withCheckIn(text: string, date: string, time: string, comment?: string): string {
  const { body } = parseNote(text);
  const at = text.length - body.length;
  return text.slice(0, at) + addCheckIn(body, { date, time, text: comment });
}

export function withRemark(text: string, date: string, remark: string): string {
  const { body } = parseNote(text);
  const at = text.length - body.length;
  return text.slice(0, at) + setRemark(body, date, remark);
}

/** The smallest edit that turns `before` into `after`: what to replace (by character offsets) and with what. */
export function minimalEdit(before: string, after: string): { start: number; end: number; text: string } | null {
  if (before === after) return null;
  let s = 0;
  while (s < before.length && s < after.length && before[s] === after[s]) s++;
  let e = 0;
  while (e < before.length - s && e < after.length - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
  return { start: s, end: before.length - e, text: after.slice(s, after.length - e) };
}

// ---------------------------------------------------------------- tokens on a line
export const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const timeOf = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** A line with its `@due(...)` (or `@remind`) set, replacing the one it has. */
export function withToken(line: string, kind: 'due' | 'remind', value: string): string {
  const re = new RegExp(`\\s*@${kind}\\([^)]*\\)`);
  const stripped = line.replace(re, '');
  return `${stripped.replace(/\s+$/, '')} @${kind}(${value})`;
}

/** A task: the line with a box in front of it, unless it has one. A list item gets a box; a plain line becomes an item. */
export function asTask(line: string): string {
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(line)) return line;
  const m = /^(\s*)([-*+]\s+)?(.*)$/.exec(line)!;
  return `${m[1]}- [ ] ${m[3]}`;
}

export const eventToken = (date: string, start?: string, end?: string) => `@event(${date}${start ? `T${start}${end ? `-${end}` : ''}` : ''})`;
export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const isClock = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function newHabitText(o: { title: string; target: number; per: 1 | 3 | 5 | 7; start: string }): string {
  return `---\nhabit: true\ntarget: ${o.target}\nper: ${o.per}\nstart: ${o.start}\n---\n\n## Log\n`;
}
