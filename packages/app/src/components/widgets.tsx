// The Widgets of the Dashboard (CONTEXT.md): what each one shows, from the data the app already holds or the days the vault gives.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, FilePlus2, FileText, Image as ImageIcon, Paperclip, Plus } from 'lucide-react';
import { addDays, type FileInfo, type HabitDayEntry } from '@ergonotes/core';
import { useApp } from '../state/app';
import { habitHref, href, noteHref } from '../state/router';
import { classNames, isoDay } from '../state/util';
import { nudgeDismissed, nudgeId, openToday } from '../state/habits';
import { type WidgetKind, type WidgetSize } from '../state/dashboard';
import { addMonths, checkInBars, dayShares, heatWeeks, longestStreaks, monthCells, monthFirst, monthLast, monthOf, monthRate, perDay, perWeek, rateChange, rateSeries } from '../state/habitStats';
import { moodForGreeting } from '../state/mood';
import { IconBtn, NoteCard, TagLink } from './ui';
import { Mood } from './Mood';
import { Columns, DayRing, HBars, HeatGrid, Line } from './charts';
import { HabitTaskRow, NewHabitDialog, NudgeCard } from './Habit';
import { ScratchPad } from './ScratchPad';
import { TaskRow } from '../views/Tasks';

/** How many rows a size shows: small, medium, large. */
const rows = (size: WidgetSize, s: number, m: number, l: number): number => (size === 'S' ? s : size === 'M' ? m : l);

/** A Widget with nothing to show: a face and a line about what would fill it. */
function Empty({ mood, children, action }: { mood: Parameters<typeof Mood>[0]['name']; children: ReactNode; action?: ReactNode }) {
  return <div className="w-empty"><Mood name={mood} size={52} /><p>{children}</p>{action}</div>;
}

/** The time now, read again every `ms`. */
function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** The days of the habits from `from` to `to` (up to today), read again when anything about the habits changes. */
function useHabitDays(from: string, to: string): HabitDayEntry[] | null {
  const app = useApp();
  const [days, setDays] = useState<HabitDayEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    if (from > app.today) { setDays([]); return; }
    void app.api.habitDays(from, to < app.today ? to : app.today, app.today).then(d => { if (live) setDays(d); }, () => { if (live) setDays([]); });
    return () => { live = false; };
  }, [app.api, from, to, app.today, app.habits]);
  return days;
}

// ---------------------------------------------------------------- the calendar of tasks (the old mini calendar)
export function MiniCalendar({ onPick }: { onPick?: (day: string) => void }) {
  const app = useApp();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const marks = useMemo(() => {
    const s = new Set<string>();
    for (const t of app.tasks) if (!t.done && t.due) s.add(t.due.slice(0, 10));
    return s;
  }, [app.tasks]);
  const first = cursor.getDay();
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))];
  const today = isoDay();
  return (
    <div className="mini-cal">
      <div className="head">
        <IconBtn label="Previous month" icon={<ChevronLeft size={18} />} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} />
        <span>{cursor.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</span>
        <IconBtn label="Next month" icon={<ChevronRight size={18} />} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
      </div>
      <div className="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
        {cells.map((d, i) => d ? (
          <button key={i} className={`day${isoDay(d) === today ? ' today' : ''}`} onClick={() => onPick ? onPick(isoDay(d)) : app.go({ name: 'calendar', day: isoDay(d) })}
            aria-label={d.toLocaleDateString('en', { dateStyle: 'full' })}>
            {d.getDate()}{marks.has(isoDay(d)) && <i />}
          </button>
        ) : <span key={i} />)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the bodies
function Greeting() {
  const app = useApp();
  const now = useNow();
  const [adding, setAdding] = useState(false);
  const live = app.habits.filter(h => !h.archived);
  const allMet = live.length > 0 && live.every(h => h.status.todayState === 'met');
  return (
    <div className="w-greeting">
      <div className="g-text">
        <h3>Happy {now.toLocaleDateString('en', { weekday: 'long' })}</h3>
        <p className="muted">{now.toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' })}, {now.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</p>
      </div>
      <Mood name={moodForGreeting(now.getHours(), allMet)} size={64} />
      <div className="g-actions">
        <button className="btn primary" onClick={() => void app.newNote()}><FilePlus2 size={16} /> New note</button>
        <button className="btn" onClick={() => setAdding(true)}><Plus size={16} /> New habit</button>
      </div>
      {adding && <NewHabitDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function NotesBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const [tab, setTab] = useState<'recent' | 'inbox'>('recent');
  const notes = useMemo(() => app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template), [app.items]);
  const inboxId = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id;
  const n = rows(size, 4, 8, 14);
  const shown = useMemo(() => {
    const src = tab === 'recent' ? notes : notes.filter(x => x.parent === inboxId);
    return [...src].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, n);
  }, [notes, tab, inboxId, n]);
  const folderName = (x: { parent: string | null }) => (x.parent ? app.byId.get(x.parent)?.title : undefined);
  return (
    <>
      <span className="seg w-seg" role="group" aria-label="Which notes">
        <button aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>Recent</button>
        <button aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>Inbox</button>
      </span>
      <div className="cards hrow">
        {shown.map(x => <NoteCard key={x.id} n={x} folder={folderName(x)} href={noteHref(x)} />)}
        <button className="card create" onClick={() => void app.newNote()}>
          <span className="create-dot"><FilePlus2 size={20} /></span>
          <span>Create new note</span>
        </button>
      </div>
    </>
  );
}

function PinnedBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const pinned = app.items.filter(i => i.type === 'note' && !i.inTrash && i.pinned).slice(0, rows(size, 4, 8, 14));
  const folderName = (x: { parent: string | null }) => (x.parent ? app.byId.get(x.parent)?.title : undefined);
  if (pinned.length === 0) return <Empty mood="relaxed">Pin a note and it will wait for you here.</Empty>;
  return <div className="cards hrow">{pinned.map(n => <NoteCard key={n.id} n={n} folder={folderName(n)} href={noteHref(n)} />)}</div>;
}

function TagsBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  if (app.tags.length === 0) return <Empty mood="relaxed">Tags you give to notes will gather here.</Empty>;
  return <div className="tag-cloud">{app.tags.slice(0, rows(size, 8, 20, 40)).map(t => <TagLink key={t.tag} tag={t.tag} count={t.count} href={href({ name: 'notes', tag: t.tag })} />)}</div>;
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
function FilesBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    void app.api.listFiles().then(f => { if (live) setFiles(f); }, () => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [app.api, app.items]);
  if (files === null) return <div aria-busy="true" style={{ minHeight: 60 }} />;
  const list = [...files].sort((a, b) => b.created.localeCompare(a.created)).slice(0, rows(size, 3, 5, 9));
  if (list.length === 0) return <Empty mood="sleeping">Pictures, documents and recordings you add will show up here.</Empty>;
  return (
    <ul className="w-list">
      {list.map(f => (
        <li key={f.id}><a href={href({ name: 'files', file: f.id })}>
          {f.mime.startsWith('image/') ? <ImageIcon size={16} aria-hidden /> : f.mime.startsWith('text/') || f.mime.includes('pdf') ? <FileText size={16} aria-hidden /> : <Paperclip size={16} aria-hidden />}
          <span className="t">{f.name}</span><small>{fmtSize(f.size)}</small>
        </a></li>
      ))}
    </ul>
  );
}

function TasksDueBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const due = useMemo(() => app.tasks.filter(t => !t.done && t.due && t.due.slice(0, 10) <= app.today).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')), [app.tasks, app.today]);
  const n = rows(size, 3, 5, 9);
  if (due.length === 0) return <Empty mood="delighted">Nothing due. Add a due date to a task in any note.</Empty>;
  return <>{due.slice(0, n).map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />)}{due.length > n && <a className="w-more" href={href({ name: 'tasks' })}>{due.length - n} more</a>}</>;
}

function RemindersBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const list = useMemo(() => app.tasks.filter(t => !t.done && t.remind && t.remind.slice(0, 10) === app.today).sort((a, b) => (a.remind ?? '').localeCompare(b.remind ?? '')), [app.tasks, app.today]);
  const n = rows(size, 3, 5, 9);
  if (list.length === 0) return <Empty mood="sleeping">No reminders today. Set one on a task with the bell.</Empty>;
  return <>{list.slice(0, n).map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />)}{list.length > n && <a className="w-more" href={href({ name: 'tasks' })}>{list.length - n} more</a>}</>;
}

function EventsBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const [events, setEvents] = useState<{ noteId: string; date: string; start?: string | null; end?: string | null; text: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    void app.api.calendar(`${app.today}T00:00`, `${addDays(app.today, 6)}T23:59`).then(d => { if (live) setEvents(d.events); }, () => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [app.api, app.today, app.items]);
  if (events === null) return <div aria-busy="true" style={{ minHeight: 60 }} />;
  if (events.length === 0) return <Empty mood="relaxed">No events in the next seven days. Add one to a note from the Insert menu.</Empty>;
  const when = (d: string) => (d === app.today ? 'Today' : d === addDays(app.today, 1) ? 'Tomorrow' : new Date(`${d}T12:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' }));
  return (
    <ul className="w-list">
      {events.slice(0, rows(size, 3, 5, 9)).map((e, i) => (
        <li key={i}><a href={href({ name: 'calendar', day: e.date })}><span className="when">{when(e.date)}</span><span className="t">{e.text}</span><small>{e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : 'All day'}</small></a></li>
      ))}
    </ul>
  );
}

function HabitsTodayBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const left = useMemo(() => openToday(app.habits), [app.habits]);
  const nudges = app.habits.filter(h => h.nudge && !h.archived && !nudgeDismissed(app.today, nudgeId(h, h.nudge))).slice(0, 2);
  const any = app.habits.some(h => !h.archived);
  return (
    <>
      {nudges.length > 0 && <div className="nudges">{nudges.map(h => <NudgeCard key={h.id} habit={h} nudge={h.nudge!} showName />)}</div>}
      {left.length === 0
        ? (any
          ? <Empty mood="delighted">Every habit is met for today.</Empty>
          : <Empty mood="sleeping" action={<button className="btn" onClick={() => setAdding(true)}><Plus size={16} /> New habit</button>}>No habits yet.</Empty>)
        : left.slice(0, rows(size, 3, 5, 9)).map(h => <HabitTaskRow key={h.id} h={h} compact />)}
      {adding && <NewHabitDialog onClose={() => setAdding(false)} />}
    </>
  );
}

/** The month shown by the habit Widgets that have a month: this one, and the buttons to go back and forward. */
function useMonth(): { ym: string; prev: () => void; next: () => void; thisMonth: boolean } {
  const app = useApp();
  const [ym, setYm] = useState(() => monthOf(app.today));
  return { ym, prev: () => setYm(addMonths(ym, -1)), next: () => setYm(addMonths(ym, 1)), thisMonth: ym === monthOf(app.today) };
}
const monthName = (ym: string) => new Date(`${ym}-01T12:00`).toLocaleDateString('en', { month: 'long', year: 'numeric' });

function HabitCalendarBody() {
  const app = useApp();
  const m = useMonth();
  const days = useHabitDays(monthFirst(m.ym), monthLast(m.ym));
  const shares = useMemo(() => dayShares(days ?? []), [days]);
  const any = app.habits.some(h => !h.archived);
  const cells = monthCells(m.ym);
  return (
    <div className="hcal">
      <div className="head">
        <span>{monthName(m.ym)}</span>
        <span className="grow" />
        <IconBtn label="Previous month" icon={<ChevronLeft size={18} />} onClick={m.prev} />
        <IconBtn label="Next month" icon={<ChevronRight size={18} />} onClick={m.next} disabled={m.ym >= monthOf(app.today)} />
      </div>
      <div className="grid" role="grid" aria-label={`Habits met each day of ${monthName(m.ym)}`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const s = shares.get(d);
          const title = s ? `${d}: ${s.met} of ${s.total} habit${s.total === 1 ? '' : 's'} met` : d;
          return <span key={d} role="gridcell" title={title} aria-label={title} className={classNames('day', d === app.today && 'today')}><DayRing share={s && s.total ? s.met / s.total : null}>{Number(d.slice(8))}</DayRing></span>;
        })}
      </div>
      {!any && <p className="muted hcal-note">Make a habit and its days appear here.</p>}
    </div>
  );
}

function HabitRateBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const m = useMonth();
  const days = useHabitDays(monthFirst(addMonths(m.ym, -1)), monthLast(m.ym));
  if (days === null) return <div aria-busy="true" style={{ minHeight: 80 }} />;
  const cur = monthRate(days, m.ym);
  const prev = monthRate(days, addMonths(m.ym, -1));
  const change = rateChange(cur.rate, prev.rate);
  const series = rateSeries(days, m.ym).map(p => p.rate);
  if (!app.habits.some(h => !h.archived)) return <Empty mood="sleeping">The rate of your habits will show here.</Empty>;
  return (
    <div className="hrate">
      <div className="head">
        <span className="muted">{monthName(m.ym)}</span>
        <span className="grow" />
        <IconBtn label="Previous month" icon={<ChevronLeft size={16} />} onClick={m.prev} />
        <IconBtn label="Next month" icon={<ChevronRight size={16} />} onClick={m.next} disabled={m.thisMonth} />
      </div>
      <div className="big" aria-label={cur.rate === null ? 'No habit day was judged yet' : `${Math.round(cur.rate * 100)} percent`}>{cur.rate === null ? '–' : `${Math.round(cur.rate * 100)}%`}</div>
      <div className={classNames('delta', change !== null && (change >= 0 ? 'up' : 'down'))}>
        {change === null ? 'Nothing to compare yet' : `${change >= 0 ? '+' : '−'}${Math.abs(change)}% from last month`}
      </div>
      <div className="muted small">{cur.met} of {cur.judged} habit days kept</div>
      {size !== 'S' && <Line values={series} max={1} height={size === 'L' ? 90 : 56} label={`Rate of each day of ${monthName(m.ym)}`} />}
    </div>
  );
}

function HabitBarsBody({ size }: { size: WidgetSize }) {
  const m = useMonth();
  const days = useHabitDays(monthFirst(m.ym), monthLast(m.ym));
  const bars = useMemo(() => checkInBars(days ?? [], m.ym), [days, m.ym]);
  return (
    <>
      <div className="head w-month">
        <span className="muted">Check-ins in {monthName(m.ym)}</span>
        <span className="grow" />
        <IconBtn label="Previous month" icon={<ChevronLeft size={16} />} onClick={m.prev} />
        <IconBtn label="Next month" icon={<ChevronRight size={16} />} onClick={m.next} disabled={m.thisMonth} />
      </div>
      <HBars label={`Check-ins of each habit in ${monthName(m.ym)}`} empty="No habits yet" rows={bars.slice(0, rows(size, 4, 6, 10)).map(b => ({ key: b.habitId, label: b.title, value: b.count, href: habitHref(b.habitId) }))} />
    </>
  );
}

function HabitStreaksBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const list = longestStreaks(app.habits).slice(0, rows(size, 3, 5, 9));
  return <HBars label="Habits by days in a row" empty="No streak yet. Check in today and it starts." rows={list.map(h => ({ key: h.id, label: h.title, value: h.status.streak, href: habitHref(h.id), hint: h.status.streak === 1 ? 'day' : 'days' }))} />;
}

function HabitHeatBody() {
  const app = useApp();
  const first = addDays(app.today, -(53 * 7));
  const days = useHabitDays(first, app.today);
  const weeks = useMemo(() => heatWeeks(dayShares(days ?? []), app.today), [days, app.today]);
  return <HeatGrid weeks={weeks} label="Habits met on each day of the last year, darker for more" />;
}

function NotesEditedBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const data = useMemo(() => perDay(app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template).map(i => i.updated), app.today, 30, iso => isoDay(new Date(iso))), [app.items, app.today]);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <>
      <div className="w-figure"><b>{total}</b> <span className="muted">note{total === 1 ? '' : 's'} changed in 30 days</span></div>
      <Columns label="Notes changed each day of the last 30 days" height={size === 'L' ? 160 : size === 'S' ? 70 : 110} mark={data.length - 1}
        data={data.map(d => ({ label: d.date, value: d.count, title: `${d.date}: ${d.count} note${d.count === 1 ? '' : 's'}` }))} empty="No note was changed lately" />
    </>
  );
}

function TasksDoneBody({ size }: { size: WidgetSize }) {
  const app = useApp();
  const weeks = useMemo(() => perWeek(app.tasks.filter(t => t.done).map(t => t.doneAt), app.today, 12), [app.tasks, app.today]);
  const max = Math.max(1, ...weeks.map(w => w.count));
  const total = weeks.reduce((s, w) => s + w.count, 0);
  return (
    <>
      <div className="w-figure"><b>{total}</b> <span className="muted">task{total === 1 ? '' : 's'} done in 12 weeks</span></div>
      <Line values={total === 0 ? [] : weeks.map(w => w.count)} max={max} height={size === 'L' ? 150 : size === 'S' ? 64 : 100} label="Tasks done each week over the last 12 weeks" empty="No task was finished lately" />
    </>
  );
}

// ---------------------------------------------------------------- the registry
interface Entry {
  title: string;
  Body: (p: { size: WidgetSize }) => ReactNode;
  /** a link in the corner of the heading */
  action?: { href: string; label: string };
  /** no card of its own around it (the Scratchpad has one) */
  bare?: boolean;
  /** the Widget is a heading itself */
  headless?: boolean;
}

export const WIDGETS: Record<WidgetKind, Entry> = {
  greeting: { title: 'Greeting', Body: () => <Greeting />, headless: true },
  scratch: { title: 'Scratch pad', Body: () => <ScratchPad />, bare: true },
  notes: { title: 'Notes', Body: ({ size }) => <NotesBody size={size} /> },
  pinned: { title: 'Pinned', Body: ({ size }) => <PinnedBody size={size} /> },
  tags: { title: 'Tags', Body: ({ size }) => <TagsBody size={size} />, action: { href: href({ name: 'notes' }), label: 'All notes' } },
  'recent-files': { title: 'Recent files', Body: ({ size }) => <FilesBody size={size} />, action: { href: href({ name: 'files' }), label: 'All files' } },
  'tasks-due': { title: 'Tasks due', Body: ({ size }) => <TasksDueBody size={size} />, action: { href: href({ name: 'tasks' }), label: 'All tasks' } },
  reminders: { title: 'Reminders today', Body: ({ size }) => <RemindersBody size={size} />, action: { href: href({ name: 'tasks' }), label: 'All tasks' } },
  events: { title: 'Upcoming events', Body: ({ size }) => <EventsBody size={size} />, action: { href: href({ name: 'calendar' }), label: 'Calendar' } },
  calendar: { title: 'Calendar', Body: () => <MiniCalendar />, action: { href: href({ name: 'calendar' }), label: 'Open calendar' } },
  'habits-today': { title: 'Habits today', Body: ({ size }) => <HabitsTodayBody size={size} />, action: { href: href({ name: 'habits' }), label: 'All habits' } },
  'habit-calendar': { title: 'Habit calendar', Body: () => <HabitCalendarBody />, action: { href: href({ name: 'habits' }), label: 'All habits' } },
  'habit-rate': { title: 'Habit rate', Body: ({ size }) => <HabitRateBody size={size} /> },
  'habit-bars': { title: 'Habit bars', Body: ({ size }) => <HabitBarsBody size={size} />, action: { href: href({ name: 'habits' }), label: 'All habits' } },
  'habit-streaks': { title: 'Habit streaks', Body: ({ size }) => <HabitStreaksBody size={size} /> },
  'habit-heat': { title: 'Habit heat map', Body: () => <HabitHeatBody /> },
  'notes-edited': { title: 'Notes edited', Body: ({ size }) => <NotesEditedBody size={size} /> },
  'tasks-done': { title: 'Tasks done', Body: ({ size }) => <TasksDoneBody size={size} /> },
};

