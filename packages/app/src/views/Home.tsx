import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, FilePlus2, LayoutTemplate, Send } from 'lucide-react';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { isoDay } from '../state/util';
import { IconBtn, NoteCard } from '../components/ui';
import { tagColor } from '../state/tags';
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

export function Home() {
  const app = useApp();
  const [tab, setTab] = useState<'recent' | 'inbox'>('recent');
  const [scratch, setScratch] = useState('');
  const notes = useMemo(() => app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template), [app.items]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 12), [notes]);
  const inboxId = app.settings.captureFolder ?? app.items.find(i => i.role === 'inbox')?.id;
  const inbox = useMemo(() => notes.filter(n => n.parent === inboxId).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 12), [notes, inboxId]);
  const pinned = notes.filter(n => n.pinned).slice(0, 6);
  const open = app.tasks.filter(t => !t.done).slice(0, 6);
  const shown = tab === 'recent' ? recent : inbox;

  const saveScratch = async () => {
    if (!scratch.trim()) return;
    const n = await app.run(app.api.capture({ text: scratch }));
    if (n) { setScratch(''); app.toast('Saved to Inbox'); await app.refresh(); }
  };

  return (
    <div className="home">
      <h1>Home</h1>

      <section className="widget" aria-labelledby="w-notes">
        <h2 id="w-notes">Notes
          <span className="grow" />
          <span className="seg" role="group" aria-label="Which notes">
            <button aria-pressed={tab === 'recent'} onClick={() => setTab('recent')}>Recent</button>
            <button aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>Inbox</button>
          </span>
          <IconBtn label="New note" variant="primary" icon={<FilePlus2 size={18} />} onClick={() => void app.newNote()} />
        </h2>
        {shown.length === 0
          ? <div className="empty" style={{ padding: 24 }}>Nothing here yet. Press the green + to write your first note.</div>
          : <div className="cards row">{shown.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', note: n.id, folder: n.parent ?? undefined })} />)}</div>}
      </section>

      <div className="widgets">
        <section className="widget" aria-labelledby="w-scratch">
          <h2 id="w-scratch">Scratch Pad</h2>
          <div className="scratch">
            <textarea aria-label="Scratch pad" placeholder="Jot something down…" maxLength={600} value={scratch} onChange={e => setScratch(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void saveScratch(); }} />
            <div className="foot">
              <span>{scratch.length}/600</span>
              <IconBtn label="Save to Inbox (Ctrl+Enter)" variant="primary" icon={<Send size={16} />} onClick={() => void saveScratch()} disabled={!scratch.trim()} />
            </div>
          </div>
        </section>

        <section className="widget" aria-labelledby="w-cal">
          <h2 id="w-cal">Calendar</h2>
          <MiniCalendar />
        </section>

        <section className="widget" aria-labelledby="w-tasks">
          <h2 id="w-tasks">My Tasks<span className="grow" /><a href={href({ name: 'tasks' })} className="icon-btn" title="All tasks" aria-label="All tasks"><ArrowRight size={18} /></a></h2>
          {open.length === 0 ? <div className="empty" style={{ padding: 16 }}>No open tasks. Add a checklist to any note.</div>
            : open.map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} compact />)}
        </section>
      </div>

      {pinned.length > 0 && (
        <section className="widget" aria-labelledby="w-pin">
          <h2 id="w-pin">Pinned notes</h2>
          <div className="cards">{pinned.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', note: n.id, folder: n.parent ?? undefined })} />)}</div>
        </section>
      )}

      {app.tags.length > 0 && (
        <section className="widget" aria-labelledby="w-tags">
          <h2 id="w-tags">Tags</h2>
          <div className="tag-cloud">{app.tags.slice(0, 30).map(t => <a key={t.tag} href={href({ name: 'notes', tag: t.tag })} style={{ ['--c' as string]: tagColor(t.tag) }}><i className="tag-dot" />{t.tag}<small>{t.count}</small></a>)}</div>
        </section>
      )}
      <IconBtn label="Start from a template" variant="soft" icon={<LayoutTemplate size={18} />} onClick={() => app.setDialog({ kind: 'templates' })} />
    </div>
  );
}
