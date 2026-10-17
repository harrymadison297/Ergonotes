import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FilePlus2 } from 'lucide-react';
import { useApp } from '../state/app';
import { href, noteHref } from '../state/router';
import { isoDay } from '../state/util';
import { IconBtn, NoteCard, TagLink } from '../components/ui';
import { TaskRow } from './Tasks';
import { HabitTaskRow, NudgeCard } from '../components/Habit';
import { nudgeDismissed, nudgeId, openToday } from '../state/habits';
import { classNames } from '../state/util';
import { FirstRunBanner } from '../components/FirstRunBanner';
import { ScratchPad } from '../components/ScratchPad';

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
          <button key={i} className={`day${isoDay(d) === today ? ' today' : ''}`} onClick={() => onPick ? onPick(isoDay(d)) : app.go({ name: 'calendar' })}
            aria-label={d.toLocaleDateString('en', { dateStyle: 'full' })}>
            {d.getDate()}{marks.has(isoDay(d)) && <i />}
          </button>
        ) : <span key={i} />)}
      </div>
    </div>
  );
}

export function Home() {
  const app = useApp();
  const [tab, setTab] = useState<'recent' | 'inbox'>('recent');
  const notes = useMemo(() => app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template), [app.items]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes]);
  const inboxId = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id;
  const inbox = useMemo(() => notes.filter(n => n.parent === inboxId).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes, inboxId]);
  const pinned = notes.filter(n => n.pinned).slice(0, 6);
  // today: what is open and due now or overdue, what is to remind today, and what a Habit still wants
  const today = app.today;
  const dueTasks = useMemo(() => app.tasks.filter(t => !t.done && t.due && t.due.slice(0, 10) <= today)
    .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')), [app.tasks, today]);
  const reminders = useMemo(() => app.tasks.filter(t => !t.done && t.remind && t.remind.slice(0, 10) === today)
    .sort((a, b) => (a.remind ?? '').localeCompare(b.remind ?? '')), [app.tasks, today]);
  const habitsLeft = useMemo(() => openToday(app.habits), [app.habits]);
  const [list, setList] = useState<'tasks' | 'reminders' | 'habits'>('tasks');
  const nudges = app.habits.filter(h => h.nudge && !h.archived && !nudgeDismissed(today, nudgeId(h, h.nudge))).slice(0, 2);
  const counts = { tasks: dueTasks.length, reminders: reminders.length, habits: habitsLeft.length };
  const shown = tab === 'recent' ? recent : inbox;
  const folderName = (n: { parent: string | null }) => (n.parent ? app.byId.get(n.parent)?.title : undefined);


  return (
    <div className="home">
      <h1>Home</h1>
      <FirstRunBanner />
      <div className="today-line" role="group" aria-label="Today">
        <span className="today-label">Today</span>
        {([['tasks', 'task', 'tasks'], ['reminders', 'reminder', 'reminders'], ['habits', 'habit', 'habits left']] as const).map(([k, one, many]) => (
          <button key={k} type="button" className={classNames('today-count', list === k && 'on', counts[k] === 0 && 'zero')} aria-pressed={list === k} onClick={() => setList(k)}>
            <b>{counts[k]}</b> {k === 'habits' ? (counts[k] === 1 ? 'habit left' : 'habits left') : counts[k] === 1 ? one : many}
          </button>
        ))}
      </div>
      {nudges.length > 0 && <div className="nudges">{nudges.map(h => <NudgeCard key={h.id} habit={h} nudge={h.nudge!} showName />)}</div>}

      <div className="home-row">
        <section className="widget w-notes" aria-labelledby="w-notes">
          <h2 id="w-notes">Notes
            <span className="grow" />
            <span className="seg" role="group" aria-label="Which notes">
              <button aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>Recent</button>
              <button aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>Inbox</button>
            </span>
          </h2>
          <div className="cards hrow">
            {shown.map(n => <NoteCard key={n.id} n={n} folder={folderName(n)} href={noteHref(n)} />)}
            <button className="card create" onClick={() => void app.newNote()}>
              <span className="create-dot"><FilePlus2 size={20} /></span>
              <span>Create new note</span>
            </button>
          </div>
        </section>

        <section className="widget w-capture" aria-labelledby="w-capture">
          <h2 id="w-capture">Scratch pad</h2>
          <ScratchPad />
        </section>
      </div>

      <div className="home-grid">
        <div className="home-main">
          {pinned.length > 0 && (
            <section className="widget w-pinned" aria-labelledby="w-pin">
              <h2 id="w-pin">Pinned</h2>
              <div className="cards hrow">{pinned.map(n => <NoteCard key={n.id} n={n} folder={folderName(n)} href={noteHref(n)} />)}</div>
            </section>
          )}

          {app.tags.length > 0 && (
            <section className="widget w-tags" aria-labelledby="w-tags">
              <h2 id="w-tags">Tags</h2>
              <div className="tag-cloud">{app.tags.slice(0, 30).map(t => <TagLink key={t.tag} tag={t.tag} count={t.count} href={href({ name: 'notes', tag: t.tag })} />)}</div>
            </section>
          )}
        </div>

        <aside className="home-side" aria-label="Calendar and tasks">
          <section className="widget w-tasks" aria-labelledby="w-tasks">
            <h2 id="w-tasks">{list === 'tasks' ? 'Tasks due' : list === 'reminders' ? 'Reminders today' : 'Habits today'}<span className="grow" /><a href={href({ name: list === 'habits' ? 'habits' : 'tasks' })} className="icon-btn" title={list === 'habits' ? 'All habits' : 'All tasks'} aria-label={list === 'habits' ? 'All habits' : 'All tasks'}><ArrowRight size={18} /></a></h2>
            {list === 'tasks' && (dueTasks.length === 0 ? <div className="empty" style={{ padding: 16 }}>Nothing due. Add a due date to a task in any note.</div> : dueTasks.slice(0, 8).map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />))}
            {list === 'reminders' && (reminders.length === 0 ? <div className="empty" style={{ padding: 16 }}>No reminders today. Set one on a task with the bell.</div> : reminders.slice(0, 8).map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />))}
            {list === 'habits' && (habitsLeft.length === 0 ? <div className="empty" style={{ padding: 16 }}>{app.habits.some(h => !h.archived) ? 'Every habit is met for today.' : 'No habits yet.'}</div> : habitsLeft.map(h => <HabitTaskRow key={h.id} h={h} compact />))}
          </section>
          <section className="widget w-cal" aria-labelledby="w-cal">
            <h2 id="w-cal">Calendar</h2>
            <MiniCalendar />
          </section>
        </aside>
      </div>
    </div>
  );
}
