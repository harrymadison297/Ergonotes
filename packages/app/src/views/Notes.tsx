import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, FileText, FilePlus2, Trash2 } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { NoteEditor } from '../components/NoteEditor';
import { NoteCard, NoteRow, useMenu } from '../components/ui';
import { classNames } from '../state/util';

type Sort = 'updated' | 'created' | 'title';

export function useNoteList(opts: { trashed?: boolean }) {
  const app = useApp();
  const { route } = app;
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('ergo.sort') as Sort) || 'updated');
  const [found, setFound] = useState<ItemSummary[] | null>(null);
  const q = route.name === 'notes' ? route.q : undefined;

  useEffect(() => {
    let live = true;
    if (!q) { setFound(null); return; }
    void app.api.search(q).then(r => live && setFound(r));
    return () => { live = false; };
  }, [q, app.api, app.items]);

  const list = useMemo(() => {
    let l = found ?? app.items.filter(i => i.type === 'note');
    if (opts.trashed) l = l.filter(i => i.trashed);
    else {
      l = l.filter(i => !i.inTrash);
      if (route.name === 'notes' && route.folder) {
        const ids = new Set<string>();
        const walk = (id: string) => { ids.add(id); for (const f of app.items) if (f.type === 'folder' && f.parent === id && !ids.has(f.id)) walk(f.id); };
        walk(route.folder);
        l = l.filter(i => i.parent && ids.has(i.parent));
      } else if (route.name === 'notes' && route.tag) {
        const t = route.tag;
        l = l.filter(i => i.tags.some(x => x === t || x.startsWith(t + '/')));
      } else if (!found) l = l.filter(i => !i.template);
    }
    const key = (i: ItemSummary) => (sort === 'title' ? i.title.toLowerCase() : sort === 'created' ? i.created : i.updated);
    return [...l].sort((a, b) => sort === 'title' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a)));
  }, [app.items, found, opts.trashed, route, sort]);

  const changeSort = (s: Sort) => { setSort(s); try { localStorage.setItem('ergo.sort', s); } catch { /* ignore */ } };
  return { list, sort, changeSort, q };
}

export function NotesView({ noteId }: { noteId?: string }) {
  const app = useApp();
  const { route } = app;
  const { list, sort, changeSort, q } = useNoteList({});
  const [tab, setTab] = useState<'notes' | 'reminders'>('notes');
  const sortMenu = useMenu();
  const folder = route.name === 'notes' && route.folder ? app.byId.get(route.folder) : undefined;
  const heading = q ? `Search: ${q}` : folder ? folder.title : route.name === 'notes' && route.tag ? `Tag: ${route.tag}` : 'Notes';
  const shown = tab === 'reminders' ? list.filter(n => n.nextReminder) : list;
  const base = { folder: route.name === 'notes' ? route.folder : undefined, tag: route.name === 'notes' ? route.tag : undefined, q };

  const sortEntries = () => (['updated', 'created', 'title'] as Sort[]).map(s => ({
    label: s === 'updated' ? 'Date updated' : s === 'created' ? 'Date created' : 'Title', checked: sort === s, onClick: () => changeSort(s),
  }));

  const listPane = (
    <div className="pane-list">
      <div className="list-head">
        <h2>{heading}</h2>
        <div className="meta">
          <span>{list.length} note{list.length === 1 ? '' : 's'}</span><span className="grow" />
          <button className="icon-btn" aria-label="Sort notes" onClick={e => sortMenu.open(e, sortEntries(), 'right')}><ArrowDownUp size={18} /></button>
          <button className="icon-btn" aria-label="New note" onClick={() => void app.newNote({ parent: folder?.id })}><FilePlus2 size={18} /></button>
        </div>
      </div>
      {sortMenu.node}
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button>
        <button className="tab" role="tab" aria-selected={tab === 'reminders'} onClick={() => setTab('reminders')}>Reminders</button>
      </div>
      <div className="list-scroll">
        {shown.length === 0 && (
          <div className="empty"><FileText size={32} /><h3>{q ? 'No notes match' : tab === 'reminders' ? 'No reminders' : 'No notes here yet'}</h3>
            <p>{q ? 'Try different words.' : 'Create a note with the New button.'}</p></div>
        )}
        {shown.map(n => (
          <div key={n.id} draggable onDragStart={e => { e.dataTransfer.setData('application/x-ergo-item', n.id); e.dataTransfer.effectAllowed = 'move'; }}>
            <NoteRow n={n} active={n.id === noteId} href={href({ name: 'notes', ...base, note: n.id })} />
          </div>
        ))}
      </div>
    </div>
  );

  if (app.isMobile) {
    const mobileList = (
      <div className="m-content">
        <div className="m-list-head"><span>{heading} · {shown.length} note{shown.length === 1 ? '' : 's'}</span><span className="grow" />
          <button className="icon-btn" aria-label="Sort notes" onClick={e => sortMenu.open(e, sortEntries(), 'right')}><ArrowDownUp size={18} /></button></div>
        {sortMenu.node}
        {shown.length === 0
          ? <div className="empty"><FileText size={32} /><h3>{q ? 'No notes match' : 'No notes here yet'}</h3><p>{q ? 'Try different words.' : 'Tap the green button to write one.'}</p></div>
          : <div className="m-cards">{shown.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', ...base, note: n.id })} />)}</div>}
      </div>
    );
    return (
      <>
        {mobileList}
        {noteId && <div className="m-note"><NoteEditor key={noteId} id={noteId} onBack={() => app.go({ name: 'notes', ...base })} /></div>}
      </>
    );
  }
  return (
    <div className="split">
      {listPane}
      <div className="pane-body">
        {noteId ? <NoteEditor key={noteId} id={noteId} /> : (
          <div className="empty" style={{ margin: 'auto' }}><FileText size={40} /><h3>Select a note</h3><p>Or press <b>New</b> to start writing.</p></div>
        )}
      </div>
    </div>
  );
}

export function TrashView({ noteId }: { noteId?: string }) {
  const app = useApp();
  const { list } = useNoteList({ trashed: true });
  const folders = app.items.filter(i => i.type === 'folder' && i.trashed);
  const rows = [...folders, ...list];
  const emptyAll = async () => {
    if (!confirm('Delete everything in the Trash forever? This cannot be undone.')) return;
    await app.run(app.api.emptyTrash());
    await app.refresh();
  };
  const listPane = (
    <div className="pane-list">
      <div className="list-head">
        <h2>Trash</h2>
        <div className="meta"><span>{rows.length} item{rows.length === 1 ? '' : 's'} · removed after 30 days</span><span className="grow" />
          <button className="btn" disabled={rows.length === 0} onClick={() => void emptyAll()}><Trash2 size={14} /> Empty Trash</button></div>
      </div>
      <div className="list-scroll">
        {rows.length === 0 && <div className="empty"><Trash2 size={32} /><h3>Trash is empty</h3></div>}
        {rows.map(n => n.type === 'folder' ? (
          <div key={n.id} className={classNames('note-row')}>
            <div className="info"><div className="t">{n.title}</div><div className="when">Folder</div></div>
            <button className="btn" onClick={async () => { await app.run(app.api.restore(n.id)); await app.refresh(); }}>Restore</button>
          </div>
        ) : <NoteRow key={n.id} n={n} active={n.id === noteId} href={href({ name: 'trash', note: n.id })} />)}
      </div>
    </div>
  );
  if (app.isMobile) return <div className="m-content">{listPane}{noteId && <div className="m-note"><NoteEditor key={noteId} id={noteId} readOnly onBack={() => app.go({ name: 'trash' })} /></div>}</div>;
  return (
    <div className="split">{listPane}
      <div className="pane-body">{noteId ? <NoteEditor key={noteId} id={noteId} readOnly /> : <div className="empty" style={{ margin: 'auto' }}><h3>Select a deleted note</h3></div>}</div>
    </div>
  );
}
