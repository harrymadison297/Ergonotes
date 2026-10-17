import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Circle, FileText } from 'lucide-react';
import type { CalendarData, EventEntry, ItemSummary, TaskEntry } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, isoDay } from '../state/util';
import { Resizer } from '../components/Resizer';
import { IconBtn } from '../components/ui';
import { NoteEditor } from '../components/NoteEditor';
import { PaneList } from '../components/RecorderPanel';

/** What one day of the Calendar holds: counted in its cell, listed when the day is opened. */
interface DayContent { open: TaskEntry[]; done: TaskEntry[]; reminders: TaskEntry[]; notes: ItemSummary[]; events: EventEntry[] }

export function CalendarView({ noteId }: { noteId?: string }) {
  const app = useApp();
  const dayParam = app.route.name === 'calendar' ? app.route.day : undefined;
  const startDay = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : isoDay();
  const [cursor, setCursor] = useState(() => { const d = new Date(`${startDay}T12:00`); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(startDay);
  // a date mention in a note sends us here: show that day
  useEffect(() => {
    if (!dayParam || !/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) return;
    const d = new Date(`${dayParam}T12:00`);
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSel(dayParam);
  }, [dayParam]);
  const [data, setData] = useState<CalendarData>({ tasks: [], events: [], notes: [], daily: [] });
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const from = `${isoDay(cells[0])}T00:00`, to = `${isoDay(cells[41])}T23:59`;

  useEffect(() => {
    let live = true;
    void app.api.calendar(from, to).then(d => live && setData(d));
    return () => { live = false; };
  }, [app.api, from, to, app.items, app.tasks]);

  // what each day holds: a number of each thing, and the things themselves for when the day is opened
  const days = useMemo(() => {
    const m = new Map<string, DayContent>();
    const at = (day: string) => m.get(day) ?? m.set(day, { open: [], done: [], reminders: [], notes: [], events: [] }).get(day)!;
    for (const t of data.tasks) {
      const day = (t.done ? t.doneAt ?? t.due ?? t.remind : t.due ?? t.remind)?.slice(0, 10);
      if (day) (t.done ? at(day).done : at(day).open).push(t);
      const r = t.remind?.slice(0, 10);
      if (r) at(r).reminders.push(t);
    }
    for (const e of data.events) at(e.date).events.push(e);
    for (const n of data.notes) at(isoDay(new Date(n.created))).notes.push(n);
    for (const n of data.daily) at(n.title.slice(0, 10)).notes.push(n);
    return m;
  }, [data]);

  const openDaily = (day: string) => app.openDaily(day, 'calendar');
  const today = app.today;
  const dailyIds = new Set(data.daily.map(n => n.id));
  const none: DayContent = { open: [], done: [], reminders: [], notes: [], events: [] };
  const selDay = days.get(sel) ?? none;

  const grid = (
    <div style={{ padding: '0 20px 20px', overflow: 'auto', flex: 1 }}>
      <div className="cal-grid" role="grid" aria-label="Calendar">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
        {cells.map(d => {
          const day = isoDay(d);
          const c = days.get(day) ?? none;
          const label = [
            c.open.length && `${c.open.length} open task${c.open.length === 1 ? '' : 's'}`, c.done.length && `${c.done.length} done`,
            c.reminders.length && `${c.reminders.length} reminder${c.reminders.length === 1 ? '' : 's'}`, c.notes.length && `${c.notes.length} note${c.notes.length === 1 ? '' : 's'}`,
            c.events.length && `${c.events.length} event${c.events.length === 1 ? '' : 's'}`,
          ].filter(Boolean).join(', ') || 'nothing';
          return (
            <button key={day} role="gridcell" className={classNames('cal-cell', day === today && 'today', d.getMonth() !== cursor.getMonth() && 'other', day === sel && 'sel')}
              onClick={() => setSel(day)} onDoubleClick={() => void openDaily(day)} aria-label={`${d.toLocaleDateString('en', { dateStyle: 'full' })}: ${label}`}>
              <span className="n">{d.getDate()}</span>
              <span className="cal-counts" aria-hidden>
                {c.done.length > 0 && <span className="cnt done" title="Tasks done"><Check size={12} />{c.done.length}</span>}
                {c.open.length > 0 && <span className="cnt open" title="Tasks not done"><Circle size={12} />{c.open.length}</span>}
                {c.reminders.length > 0 && <span className="cnt remind" title="Reminders"><Bell size={12} />{c.reminders.length}</span>}
                {c.notes.length > 0 && <span className="cnt note" title="Notes"><FileText size={12} />{c.notes.length}</span>}
                {c.events.length > 0 && <span className="cnt event" title="Events"><CalendarDays size={12} />{c.events.length}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const section = (title: string, children: React.ReactNode, n: number) => n > 0 && <section className="cal-section"><h3>{title} <span>{n}</span></h3>{children}</section>;
  const noteLink = (id: string, text: string, sub?: string, key?: string | number) => (
    <a key={key} className="note-row" href={href({ name: 'calendar', note: id })} style={{ padding: '8px 4px' }}><span className="info"><span className="t">{text || 'Untitled'}</span>{sub && <span className="when">{sub}</span>}</span></a>
  );
  const side = (
    <aside style={{ padding: 18, borderTop: app.isMobile ? '1px solid var(--border)' : undefined }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--fs-m)' }}>{new Date(sel + 'T12:00').toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      <button className="btn" onClick={() => void openDaily(sel)}><CalendarPlus size={15} /> Open daily note</button>
      <div style={{ marginTop: 14 }}>
        {selDay === none && <p className="hint">Nothing on this day.</p>}
        {section('Tasks not done', selDay.open.map((t, i) => noteLink(t.noteId, t.text, t.due ? 'Due' : 'Reminder', i)), selDay.open.length)}
        {section('Tasks done', selDay.done.map((t, i) => noteLink(t.noteId, t.text || t.noteTitle, t.doneAt ? `Done${t.doneAt.length > 10 ? ' at ' + t.doneAt.slice(11, 16) : ''}` : 'Done', i)), selDay.done.length)}
        {section('Reminders', selDay.reminders.map((t, i) => noteLink(t.noteId, t.text, t.remind && t.remind.length > 10 ? `At ${t.remind.slice(11, 16)}` : 'All day', i)), selDay.reminders.length)}
        {section('Events', selDay.events.map((e, i) => noteLink(e.noteId, e.text, e.start ? (e.end ? `${e.start}–${e.end}` : e.start) : 'All day', i)), selDay.events.length)}
        {section('Notes', selDay.notes.map((n, i) => noteLink(n.id, n.title, dailyIds.has(n.id) ? 'Daily note' : 'Created', i)), selDay.notes.length)}
      </div>
    </aside>
  );

  const head = (
    <div className="page-head">
      <h1>{cursor.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</h1>
      <span className="grow" />
      <button className="btn" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(isoDay()); }}>Today</button>
      <IconBtn label="Previous month" icon={<ChevronLeft size={20} />} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} />
      <IconBtn label="Next month" icon={<ChevronRight size={20} />} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} />
    </div>
  );

  if (app.isMobile) {
    return <div className="m-content">{head}{grid}{side}{noteId && <div className="m-note"><NoteEditor key={noteId} id={noteId} onBack={() => app.go({ name: 'calendar' })} /></div>}</div>;
  }
  if (noteId) {
    return (
      <div className="split">
        <PaneList><Resizer pane="listW" edge="right" label="Resize list" /><div className="list-scroll">{head}{side}</div></PaneList>
        <div className="pane-body"><NoteEditor key={noteId} id={noteId} /></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>{head}{grid}</div>
      <div style={{ borderLeft: '1px solid var(--border)', overflow: 'auto' }}>{side}</div>
    </div>
  );
}
