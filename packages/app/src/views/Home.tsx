import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FilePlus2, Send } from 'lucide-react';
import { useApp } from '../state/app';
import { href, noteHref } from '../state/router';
import { isoDay } from '../state/util';
import { IconBtn, NoteCard, TagLink } from '../components/ui';
import { TaskRow } from './Tasks';
import { FirstRunBanner } from '../components/FirstRunBanner';

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
  const [capture, setCapture] = useState('');
  const notes = useMemo(() => app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template), [app.items]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes]);
  const inboxId = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id;
  const inbox = useMemo(() => notes.filter(n => n.parent === inboxId).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 10), [notes, inboxId]);
  const pinned = notes.filter(n => n.pinned).slice(0, 6);
  // what is due first, then everything else that is open
  const open = useMemo(() => app.tasks.filter(t => !t.done)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')).slice(0, 6), [app.tasks]);
  const shown = tab === 'recent' ? recent : inbox;
  const folderName = (n: { parent: string | null }) => (n.parent ? app.byId.get(n.parent)?.title : undefined);

  const saveCapture = async () => {
    if (!capture.trim()) return;
    const n = await app.run(app.api.capture({ text: capture }));
    if (n) { setCapture(''); app.toast('Saved to Inbox'); await app.refresh(); }
  };

  return (
    <div className="home">
      <h1>Home</h1>
      <FirstRunBanner />

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
          <div className="capture">
            <textarea aria-label="Scratch pad" placeholder="Start writing…" value={capture} onChange={e => setCapture(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void saveCapture(); }} />
            <div className="foot">
              <span>{capture.length ? `${capture.length} characters` : 'Goes to your Inbox'}</span>
              <IconBtn label="Save to Inbox (Ctrl+Enter)" icon={<Send size={16} />} onClick={() => void saveCapture()} disabled={!capture.trim()} />
            </div>
          </div>
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
