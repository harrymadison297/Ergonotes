import { useMemo, useState } from 'react';
import { ArrowRight, CalendarPlus, ChevronLeft, ChevronRight, FilePlus2, LayoutTemplate, Send, Upload } from 'lucide-react';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { isoDay } from '../state/util';
import { IconBtn, NoteCard } from '../components/ui';
import { tagStyle } from '../state/tags';
import { TaskRow } from './Tasks';

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
        <button className="icon-btn" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
        <span>{cursor.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</span>
        <button className="icon-btn" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
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

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const app = useApp();
  const [tab, setTab] = useState<'recent' | 'inbox'>('recent');
  const [scratch, setScratch] = useState('');
  const notes = useMemo(() => app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template), [app.items]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes]);
  const inboxId = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id;
  const inbox = useMemo(() => notes.filter(n => n.parent === inboxId).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes, inboxId]);
  const pinned = notes.filter(n => n.pinned).slice(0, 6);
  // what is due first, then everything else that is open
  const open = useMemo(() => app.tasks.filter(t => !t.done)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).slice(0, 6), [app.tasks]);
  const shown = tab === 'recent' ? recent : inbox;
  const today = new Date();

  const saveScratch = async () => {
    if (!scratch.trim()) return;
    const n = await app.run(app.api.capture({ text: scratch }));
    if (n) { setScratch(''); app.toast('Saved to Inbox'); await app.refresh(); }
  };
  const daily = async () => {
    const d = await app.run(app.api.dailyNote(isoDay()));
    if (d) { await app.refresh(); app.go({ name: 'notes', note: d.id, folder: d.parent ?? undefined }); }
  };

  const action = (label: string, icon: JSX.Element, onClick: () => void, primary = false) => (
    <button key={label} className="home-action" onClick={onClick}>
      <span className={primary ? 'icon-btn lg primary' : 'icon-btn lg ring'}>{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <div className="home-date">{today.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting(today)}</h1>
        </div>
        <div className="home-actions" role="group" aria-label="Quick actions">
          {action('New note', <FilePlus2 size={22} />, () => void app.newNote(), true)}
          {action('Daily note', <CalendarPlus size={22} />, () => void daily())}
          {action('Template', <LayoutTemplate size={22} />, () => app.setDialog({ kind: 'templates' }))}
          {action('Import', <Upload size={22} />, () => app.setDialog({ kind: 'import' }))}
        </div>
      </header>

      <div className="home-grid">
        <div className="home-main">
          <section className="widget w-capture" aria-labelledby="w-capture">
            <h2 id="w-capture">Quick capture</h2>
            <div className="scratch">
              <textarea aria-label="Quick capture" placeholder="Jot something down…" maxLength={600} rows={3} value={scratch} onChange={e => setScratch(e.target.value)}
                onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void saveScratch(); }} />
              <div className="foot">
                <span>{scratch.length ? `${scratch.length}/600` : 'Saved to your Inbox'}</span>
                <IconBtn label="Save to Inbox (Ctrl+Enter)" variant="primary" icon={<Send size={16} />} onClick={() => void saveScratch()} disabled={!scratch.trim()} />
              </div>
            </div>
          </section>

          <section className="widget w-notes" aria-labelledby="w-notes">
            <h2 id="w-notes">Notes
              <span className="grow" />
              <span className="seg" role="group" aria-label="Which notes">
                <button aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>Recent</button>
                <button aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>Inbox</button>
              </span>
            </h2>
            {shown.length === 0
              ? <div className="empty" style={{ padding: 24 }}>Nothing here yet. Press + to write your first note.</div>
              : <div className="cards">{shown.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', note: n.id, folder: n.parent ?? undefined })} />)}</div>}
          </section>

          {pinned.length > 0 && (
            <section className="widget w-pinned" aria-labelledby="w-pin">
              <h2 id="w-pin">Pinned</h2>
              <div className="cards">{pinned.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', note: n.id, folder: n.parent ?? undefined })} />)}</div>
            </section>
          )}

          {app.tags.length > 0 && (
            <section className="widget w-tags" aria-labelledby="w-tags">
              <h2 id="w-tags">Tags</h2>
              <div className="tag-cloud">{app.tags.slice(0, 30).map(t => <a key={t.tag} href={href({ name: 'notes', tag: t.tag })} style={tagStyle(t.tag)}><i className="tag-dot" />{t.tag}<small>{t.count}</small></a>)}</div>
            </section>
          )}
        </div>

        <aside className="home-side" aria-label="Calendar and tasks">
          <section className="widget w-tasks" aria-labelledby="w-tasks">
            <h2 id="w-tasks">Tasks<span className="grow" /><a href={href({ name: 'tasks' })} className="icon-btn" title="All tasks" aria-label="All tasks"><ArrowRight size={18} /></a></h2>
            {open.length === 0 ? <div className="empty" style={{ padding: 16 }}>No open tasks. Add a checklist to any note.</div>
              : open.map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />)}
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
