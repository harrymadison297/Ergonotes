import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarPlus } from 'lucide-react';
import type { CalendarData } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, isoDay } from '../state/util';
import { Resizer } from '../components/Resizer';
import { IconBtn } from '../components/ui';
import { NoteEditor } from '../components/NoteEditor';

export function CalendarView({ noteId }: { noteId?: string }) {
  const app = useApp();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(isoDay());
  const [data, setData] = useState<CalendarData>({ tasks: [], notes: [], daily: [] });
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const from = `${isoDay(cells[0])}T00:00`, to = `${isoDay(cells[41])}T23:59`;

  useEffect(() => {
    let live = true;
    void app.api.calendar(from, to).then(d => live && setData(d));
    return () => { live = false; };
  }, [app.api, from, to, app.items, app.tasks]);

  const byDay = useMemo(() => {
    const m = new Map<string, { kind: 'task' | 'note' | 'daily'; label: string; id: string }[]>();
    const add = (day: string, e: { kind: 'task' | 'note' | 'daily'; label: string; id: string }) => (m.get(day) ?? m.set(day, []).get(day)!).push(e);
    for (const t of data.tasks) { const d = (t.due ?? t.remind ?? '').slice(0, 10); if (d) add(d, { kind: 'task', label: t.text, id: t.noteId }); }
    for (const n of data.notes) add(isoDay(new Date(n.created)), { kind: 'note', label: n.title, id: n.id });
    for (const n of data.daily) add(n.title.slice(0, 10), { kind: 'daily', label: n.title, id: n.id });
    return m;
  }, [data]);

  const openDaily = (day: string) => app.openDaily(day, 'calendar');
  const today = isoDay();
  const selEvents = byDay.get(sel) ?? [];

  const grid = (
    <div style={{ padding: '0 20px 20px', overflow: 'auto', flex: 1 }}>
      <div className="cal-grid" role="grid" aria-label="Calendar">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="cal-dow" role="columnheader">{d}</div>)}
        {cells.map(d => {
          const day = isoDay(d);
          const ev = byDay.get(day) ?? [];
          return (
            <button key={day} role="gridcell" className={classNames('cal-cell', day === today && 'today', d.getMonth() !== cursor.getMonth() && 'other', day === sel && 'sel')}
              onClick={() => setSel(day)} onDoubleClick={() => void openDaily(day)} aria-label={`${d.toLocaleDateString('en', { dateStyle: 'full' })}, ${ev.length} item${ev.length === 1 ? '' : 's'}`}>
              <span className="n">{d.getDate()}</span>
              {ev.slice(0, app.isMobile ? 1 : 3).map((e, i) => <span key={i} className={`cal-ev ${e.kind}`}>{e.label}</span>)}
              {ev.length > (app.isMobile ? 1 : 3) && <span className="cal-ev" style={{ color: 'var(--text-2)' }}>+{ev.length - (app.isMobile ? 1 : 3)} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  const side = (
    <aside style={{ padding: 18, borderTop: app.isMobile ? '1px solid var(--border)' : undefined }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--fs-m)' }}>{new Date(sel + 'T12:00').toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      <button className="btn" onClick={() => void openDaily(sel)}><CalendarPlus size={15} /> Open daily note</button>
      <div style={{ marginTop: 14 }}>
        {selEvents.length === 0 && <p className="hint">Nothing scheduled.</p>}
        {selEvents.map((e, i) => <a key={i} className="note-row" href={href({ name: 'calendar', note: e.id })} style={{ padding: '8px 4px' }}><span className="info"><span className="t">{e.label}</span><span className="when">{e.kind === 'task' ? 'Task due' : e.kind === 'daily' ? 'Daily note' : 'Created'}</span></span></a>)}
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
        <div className="pane-list"><Resizer pane="listW" edge="right" label="Resize list" /><div className="list-scroll">{head}{side}</div></div>
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
