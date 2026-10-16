import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ChevronsLeft, FileText, FilePlus2, FolderPlus, ListFilter, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { NoteEditor } from '../components/NoteEditor';
import { IconBtn, NoteCard, NoteRow, useMenu } from '../components/ui';
import { Explorer } from './Explorer';
import { folderChain } from '../state/tree';
import { setPrefs, usePrefs } from '../state/prefs';
import { classNames } from '../state/util';
import { Resizer } from '../components/Resizer';
import { PaneList } from '../components/RecorderPanel';


type Sort = 'updated' | 'created' | 'title';

export function useNoteList(opts: { trashed?: boolean }) {
  const app = useApp();
  const { route } = app;
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem('ergo.sort') as Sort) || 'updated'; } catch { return 'updated'; } });
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
  const viewMenu = useMenu();
  const prefs = usePrefs();
  const folder = route.name === 'notes' && route.folder ? app.byId.get(route.folder) : undefined;
  const heading = q ? `Search: ${q}` : folder ? folder.title : route.name === 'notes' && route.tag ? `Tag: ${route.tag}` : 'Notes';
  const shown = tab === 'reminders' ? list.filter(n => n.nextReminder) : list;
  const base = { folder: route.name === 'notes' ? route.folder : undefined, tag: route.name === 'notes' ? route.tag : undefined, q };

  const sortEntries = () => (['updated', 'created', 'title'] as Sort[]).map(s => ({
    label: s === 'updated' ? 'Date updated' : s === 'created' ? 'Date created' : 'Title', checked: sort === s, onClick: () => changeSort(s),
  }));

  // the right-hand pane with no note open: the folder's contents, like a file manager
  const explorer = (() => {
    const inFolder = route.name === 'notes' && !route.tag && !q;
    if (!inFolder) return <Explorer heading={heading} parentId={undefined} crumbs={[]} folders={[]} notes={list} />;
    const real = (id: string | null) => (id && app.byId.get(id)?.type === 'folder' ? id : null);
    const pid = folder?.id ?? null;
    const subs = app.items.filter(i => i.type === 'folder' && !i.inTrash && real(i.parent) === pid);
    const here = app.items.filter(i => i.type === 'note' && !i.inTrash && real(i.parent) === pid && (pid !== null || !i.template));
    const crumbs: { id: string | null; title: string }[] = [{ id: null, title: 'All folders' }, ...folderChain(app.byId, folder?.id)];
    return <Explorer heading={heading} parentId={pid} crumbs={crumbs} folders={subs} notes={here} />;
  })();

  const listPane = (
    <PaneList>
      <Resizer pane="listW" edge="right" label="Resize list" />
      <div className="list-head">
        <h2><span className="ttl">{heading}</span><span className="count" aria-label={`${list.length} note${list.length === 1 ? '' : 's'}`}>{list.length}</span></h2>
        <div className="list-tools">
          <IconBtn label="New note" icon={<FilePlus2 size={18} />} onClick={() => void app.newNote({ parent: folder?.id })} />
          {folder && <IconBtn label="New folder here" icon={<FolderPlus size={18} />} onClick={() => app.setDialog({ kind: 'newFolder', parent: folder.id })} />}
          <IconBtn label="Sort notes" icon={<ListFilter size={18} />} haspopup onClick={e => sortMenu.open(e, sortEntries(), 'right')} />
          <IconBtn label="View options" icon={<SlidersHorizontal size={18} />} haspopup onClick={e => viewMenu.open(e, [
            { title: 'Layout' },
            { label: 'Cards', checked: prefs.listView === 'cards', onClick: () => setPrefs({ listView: 'cards' }) },
            { label: 'List', checked: prefs.listView === 'list', onClick: () => setPrefs({ listView: 'list' }) },
          ], 'right')} />
          {noteId && <IconBtn label="Hide the note list" icon={<ChevronsLeft size={18} />} onClick={() => setPrefs({ listHidden: true })} />}
        </div>
      </div>
      {sortMenu.node}{viewMenu.node}
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}>Notes</button>
        <button className="tab" role="tab" aria-selected={tab === 'reminders'} onClick={() => setTab('reminders')}>Reminders</button>
      </div>
      <div className={classNames('list-scroll', prefs.listView === 'cards' && 'as-cards')}>
        {shown.length === 0 && (
          <div className="empty"><FileText size={32} /><h3>{q ? 'No notes match' : tab === 'reminders' ? 'No reminders' : 'No notes here yet'}</h3>
            <p>{q ? 'Try different words.' : 'Create one with the New note button.'}</p></div>
        )}
        {shown.map(n => <NoteRow key={n.id} n={n} cards={prefs.listView === 'cards'} active={n.id === noteId} href={href({ name: 'notes', ...base, note: n.id })} />)}
      </div>
    </PaneList>
  );

  if (app.isMobile) {
    const mobileList = (
      <div className="m-content">
        <div className="m-list-head"><span>{heading} · {shown.length} note{shown.length === 1 ? '' : 's'}</span><span className="grow" />
          <IconBtn label="Sort notes" icon={<ArrowDownUp size={18} />} haspopup onClick={e => sortMenu.open(e, sortEntries(), 'right')} /></div>
        {sortMenu.node}
        {shown.length === 0
          ? <div className="empty"><FileText size={32} /><h3>{q ? 'No notes match' : 'No notes here yet'}</h3><p>{q ? 'Try different words.' : 'Tap + to write one.'}</p></div>
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
    <div className={classNames('split', prefs.listHidden && !!noteId && 'list-hidden')}>
      {listPane}
      <div className="pane-body">
        {noteId ? <NoteEditor key={noteId} id={noteId} /> : explorer}
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
    if (!confirm('Delete everything in the Trash forever? This can’t be undone.')) return;
    await app.run(app.api.emptyTrash());
    await app.refresh();
  };
  const listPane = (
    <PaneList>
      <Resizer pane="listW" edge="right" label="Resize list" />
      <div className="list-head">
        <h2>Trash</h2>
        <div className="meta"><span>{rows.length} item{rows.length === 1 ? '' : 's'} · removed after 30 days</span><span className="grow" />
          <button className="btn danger" disabled={rows.length === 0} onClick={() => void emptyAll()}><Trash2 size={16} /> Empty trash</button></div>
      </div>
      <div className="list-scroll">
        {rows.length === 0 && <div className="empty"><Trash2 size={32} /><h3>Trash is empty</h3></div>}
        {rows.map(n => n.type === 'folder' ? (
          <div key={n.id} className="note-row">
            <div className="info"><div className="t">{n.title}</div><div className="when">Folder</div></div>
            <button className="btn" onClick={async () => { await app.run(app.api.restore(n.id)); await app.refresh(); }}>Restore</button>
          </div>
        ) : <NoteRow key={n.id} n={n} plain active={n.id === noteId} href={href({ name: 'trash', note: n.id })} />)}
      </div>
    </PaneList>
  );
  if (app.isMobile) return <div className="m-content">{listPane}{noteId && <div className="m-note"><NoteEditor key={noteId} id={noteId} readOnly onBack={() => app.go({ name: 'trash' })} /></div>}</div>;
  return (
    <div className="split">{listPane}
      <div className="pane-body">{noteId ? <NoteEditor key={noteId} id={noteId} readOnly /> : <div className="empty" style={{ margin: 'auto' }}><h3>Select a deleted note</h3></div>}</div>
    </div>
  );
}
