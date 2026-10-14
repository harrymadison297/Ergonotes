import { useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronRight, CloudOff, FileText, Folder as FolderIcon, FolderPlus, Home, Keyboard, LayoutTemplate,
  Loader2, MoreHorizontal, Plus, RefreshCw, Search, Settings as SettingsIcon, Star, Tag as TagIcon, Trash2, CheckCircle2, FilePlus2, Upload, Cloud,
} from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, isoDay, relTime } from '../state/util';
import { useMenu, type MenuEntry } from './ui';

const ROLE_ORDER = ['inbox', 'projects', 'areas', 'resources', 'archive', 'templates'];
const sortFolders = (a: ItemSummary, b: ItemSummary) => {
  const ra = a.role ? ROLE_ORDER.indexOf(a.role) : -1, rb = b.role ? ROLE_ORDER.indexOf(b.role) : -1;
  if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  return a.title.localeCompare(b.title, undefined, { numeric: true });
};

function useStoredSet(key: string): [Set<string>, (id: string) => void] {
  const [s, setS] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const toggle = (id: string) => setS(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem(key, JSON.stringify([...n])); } catch { /* private mode */ }
    return n;
  });
  return [s, toggle];
}

export function useNewMenu() {
  const app = useApp();
  const m = useMenu();
  const open = (e: { currentTarget: Element }, parent?: string | null) => {
    const entries: MenuEntry[] = [
      { label: 'New note', icon: <FilePlus2 size={16} />, kbd: 'Ctrl+N', onClick: () => void app.newNote({ parent }) },
      { label: 'New folder', icon: <FolderPlus size={16} />, onClick: () => app.setDialog({ kind: 'newFolder', parent: parent ?? null }) },
      { label: 'New from template…', icon: <LayoutTemplate size={16} />, onClick: () => app.setDialog({ kind: 'templates' }) },
      { label: "Today's daily note", icon: <CalendarDays size={16} />, onClick: async () => {
        const d = await app.run(app.api.dailyNote(isoDay()));
        if (d) { await app.refresh(); app.go({ name: 'notes', note: d.id, folder: d.parent ?? undefined }); }
      } },
      { sep: true },
      { label: 'Import Markdown files…', icon: <Upload size={16} />, onClick: () => app.setDialog({ kind: 'import' }) },
    ];
    m.open(e, entries);
  };
  return { open, node: m.node };
}

function SyncPill() {
  const app = useApp();
  const st = app.status;
  const noStore = !st.store;
  let icon = <Cloud size={14} />;
  let text = 'Synced';
  let err = false;
  if (st.syncing) { icon = <Loader2 size={14} className="spin" />; text = 'Syncing…'; }
  else if (noStore) { icon = <CloudOff size={14} />; text = 'Local only'; }
  else if (st.lastSyncError) { icon = <AlertTriangle size={14} />; text = 'Sync problem'; err = true; }
  else if (st.pending > 0) { icon = <RefreshCw size={14} />; text = `${st.pending} waiting`; }
  else if (st.lastSyncAt) text = `Synced ${relTime(st.lastSyncAt)}`;
  return (
    <button className={classNames('sync-pill', err && 'err')} title={st.lastSyncError ?? (noStore ? 'Choose storage to sync between devices' : 'Sync now')}
      onClick={async () => {
        if (noStore) return app.setDialog({ kind: 'settings', tab: 'sync' });
        const r = await app.run(app.api.sync());
        await app.refresh();
        if (r?.error) app.toast(r.error, 'error'); else if (r) app.toast(r.pulled || r.pushed ? `Synced: ${r.pulled} received, ${r.pushed} sent` : 'Everything is up to date');
      }}>
      {icon}<span>{text}</span>
    </button>
  );
}

export function Sidebar() {
  const app = useApp();
  const { items, route, tags, conflicts, status, go } = app;
  const [openFolders, toggleFolder] = useStoredSet('ergo.openFolders');
  const [openTags, toggleTag] = useStoredSet('ergo.openTags');
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(true);
  const [q, setQ] = useState('');
  const newMenu = useNewMenu();
  const folderMenu = useMenu();
  const tagMenu = useMenu();
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const folders = useMemo(() => items.filter(i => i.type === 'folder' && !i.inTrash), [items]);
  const childrenOf = useMemo(() => {
    const m = new Map<string | null, ItemSummary[]>();
    for (const f of folders) {
      const key = f.parent && folders.some(x => x.id === f.parent) ? f.parent : null;
      (m.get(key) ?? m.set(key, []).get(key)!).push(f);
    }
    for (const l of m.values()) l.sort(sortFolders);
    return m;
  }, [folders]);
  const pinned = useMemo(() => items.filter(i => i.type === 'note' && i.pinned && !i.inTrash), [items]);
  const trashCount = items.filter(i => i.trashed).length;
  const tagTree = useMemo(() => {
    const names = new Set<string>();
    for (const t of tags) { const p = t.tag.split('/'); for (let i = 1; i <= p.length; i++) names.add(p.slice(0, i).join('/')); }
    const count = (n: string) => tags.filter(t => t.tag === n || t.tag.startsWith(n + '/')).reduce((a, t) => a + t.count, 0);
    return { names: [...names].sort(), count };
  }, [tags]);

  const isActive = (r: string, extra?: boolean) => route.name === r && extra !== false;

  const folderNode = (f: ItemSummary, depth: number): JSX.Element => {
    const kids = childrenOf.get(f.id) ?? [];
    const open = openFolders.has(f.id);
    const active = route.name === 'notes' && route.folder === f.id;
    return (
      <div key={f.id}>
        <div className={classNames('nav-item', active && 'active')} style={{ paddingLeft: 8 + depth * 14, outline: dropTarget === f.id ? '2px solid var(--blue)' : undefined }}
          onContextMenu={e => { e.preventDefault(); folderMenu.open({ currentTarget: e.currentTarget }, folderEntries(f)); }}
          onDragOver={e => { if (e.dataTransfer.types.includes('application/x-ergo-item')) { e.preventDefault(); setDropTarget(f.id); } }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={async e => {
            e.preventDefault(); setDropTarget(null);
            const id = e.dataTransfer.getData('application/x-ergo-item');
            if (id && id !== f.id) { await app.run(app.api.move(id, f.id)); await app.refresh(); }
          }}>
          <button className="nav-chevron" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => toggleFolder(f.id)} style={{ visibility: kids.length ? 'visible' : 'hidden' }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <a className="label" href={href({ name: 'notes', folder: f.id })} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <FolderIcon size={16} /><span className="label">{f.title}</span>
          </a>
          <span className="count">{f.childCount || ''}</span>
          <button className="nav-chevron" aria-label={`Actions for ${f.title}`} onClick={e => folderMenu.open(e, folderEntries(f), 'right')}><MoreHorizontal size={14} /></button>
        </div>
        {open && kids.map(k => folderNode(k, depth + 1))}
      </div>
    );
  };

  function folderEntries(f: ItemSummary): MenuEntry[] {
    return [
      { label: 'New note here', icon: <FilePlus2 size={16} />, onClick: () => void app.newNote({ parent: f.id }) },
      { label: 'New subfolder', icon: <FolderPlus size={16} />, onClick: () => app.setDialog({ kind: 'newFolder', parent: f.id }) },
      { sep: true },
      { label: 'Rename…', onClick: () => app.setDialog({ kind: 'rename', id: f.id }) },
      { label: 'Move to…', onClick: () => app.setDialog({ kind: 'move', id: f.id }) },
      { label: 'Use for new captures', onClick: async () => { await app.run(app.api.setSettings({ captureFolder: f.id })); await app.refresh(); app.toast(`New captures go to “${f.title}”`); } },
      { sep: true },
      { label: 'Move to Trash', danger: true, icon: <Trash2 size={16} />, onClick: async () => { await app.run(app.api.trash(f.id)); await app.refresh(); } },
    ];
  }

  const initial = (status.deviceName || 'E').trim().charAt(0).toUpperCase();
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="account">
        <div className="avatar" aria-hidden>{initial}</div>
        <div className="names"><b>{status.deviceName}</b><span>{status.store ? status.store.label : 'This device only'}</span></div>
        <button className="icon-btn" aria-label="Settings" onClick={() => app.setDialog({ kind: 'settings' })}><SettingsIcon size={18} /></button>
      </div>

      <form className="search-box" role="search" onSubmit={e => { e.preventDefault(); go({ name: 'notes', q: q.trim() || undefined }); }}>
        <Search size={16} />
        <input id="global-search" aria-label="Search notes" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} />
        <kbd>Ctrl K</kbd>
      </form>

      <button className="new-btn" onClick={e => newMenu.open(e)} aria-haspopup="menu">
        <span><Plus size={18} /> New</span><ChevronDown size={16} />
      </button>
      {newMenu.node}
      {folderMenu.node}
      {tagMenu.node}

      <nav className="nav" aria-label="Main">
        <a className={classNames('nav-item', isActive('home') && 'active')} href={href({ name: 'home' })}><span className="nav-chevron" /><Home size={18} /><span className="label">Home</span></a>

        <div className="nav-item" role="button" tabIndex={0} onClick={() => setShortcutsOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setShortcutsOpen(o => !o); }}>
          <span className="nav-chevron">{shortcutsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          <Star size={18} /><span className="label">Shortcuts</span>
        </div>
        {shortcutsOpen && (
          <div className="nav-children">
            {pinned.length === 0 && <div className="nav-item" style={{ color: 'var(--text-3)', fontSize: 12.5 }}>Star a note to pin it here</div>}
            {pinned.map(p => (
              <a key={p.id} className="nav-item" href={href({ name: 'notes', note: p.id, folder: p.parent ?? undefined })}><FileText size={16} /><span className="label">{p.title}</span></a>
            ))}
          </div>
        )}
        <div className="nav-sep" />
        <a className={classNames('nav-item', route.name === 'notes' && !route.folder && !route.tag && 'active')} href={href({ name: 'notes' })}><span className="nav-chevron" /><FileText size={18} /><span className="label">Notes</span></a>
        <a className={classNames('nav-item', isActive('tasks') && 'active')} href={href({ name: 'tasks' })}><span className="nav-chevron" /><CheckCircle2 size={18} /><span className="label">Tasks</span></a>
        <a className={classNames('nav-item', isActive('calendar') && 'active')} href={href({ name: 'calendar' })}><span className="nav-chevron" /><CalendarDays size={18} /><span className="label">Calendar</span></a>
        <div className="nav-sep" />

        <div className={classNames('nav-item', route.name === 'folders' && 'active')}>
          <button className="nav-chevron" aria-label="Toggle folders" onClick={() => setFoldersOpen(o => !o)}>{foldersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          <a className="label" href={href({ name: 'folders' })} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', gap: 10, alignItems: 'center' }}><FolderIcon size={18} /><span className="label">Folders</span></a>
        </div>
        {foldersOpen && <div className="nav-children" style={{ marginLeft: 6 }}>{(childrenOf.get(null) ?? []).map(f => folderNode(f, 0))}</div>}

        <div className="nav-item">
          <button className="nav-chevron" aria-label="Toggle tags" onClick={() => setTagsOpen(o => !o)}>{tagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          <span className="label" style={{ display: 'flex', gap: 10, alignItems: 'center' }} onClick={() => setTagsOpen(o => !o)}><TagIcon size={18} /> Tags</span>
        </div>
        {tagsOpen && (
          <div className="nav-children">
            {tagTree.names.length === 0 && <div className="nav-item" style={{ color: 'var(--text-3)', fontSize: 12.5 }}>No tags yet</div>}
            {tagTree.names.filter(n => { const p = n.split('/'); return p.length === 1 || openTags.has(p.slice(0, -1).join('/')); }).map(n => {
              const depth = n.split('/').length - 1;
              const hasKids = tagTree.names.some(x => x.startsWith(n + '/'));
              return (
                <div key={n} className={classNames('nav-item', route.name === 'notes' && route.tag === n && 'active')} style={{ paddingLeft: 8 + depth * 14 }}>
                  <button className="nav-chevron" style={{ visibility: hasKids ? 'visible' : 'hidden' }} aria-label="Toggle" onClick={() => toggleTag(n)}>{openTags.has(n) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                  <a className="label" href={href({ name: 'notes', tag: n })} style={{ color: 'inherit', textDecoration: 'none' }}
                    onContextMenu={e => { e.preventDefault(); tagMenu.open({ currentTarget: e.currentTarget }, [{ label: 'Rename tag…', onClick: () => app.setDialog({ kind: 'renameTag', tag: n }) }]); }}>{n.split('/').pop()}</a>
                  <span className="count">{tagTree.count(n)}</span>
                  <button className="nav-chevron" aria-label={`Actions for tag ${n}`} onClick={e => tagMenu.open(e, [{ label: 'Rename tag…', onClick: () => app.setDialog({ kind: 'renameTag', tag: n }) }], 'right')}><MoreHorizontal size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
        <div className="nav-sep" />
        {conflicts.length > 0 && (
          <a className={classNames('nav-item', isActive('conflicts') && 'active')} href={href({ name: 'conflicts' })}>
            <span className="nav-chevron" /><AlertTriangle size={18} style={{ color: 'var(--red)' }} /><span className="label">Conflicts</span><span className="badge">{conflicts.length}</span>
          </a>
        )}
        <a className={classNames('nav-item', isActive('trash') && 'active')} href={href({ name: 'trash' })}><span className="nav-chevron" /><Trash2 size={18} /><span className="label">Trash</span>{trashCount > 0 && <span className="count">{trashCount}</span>}</a>
      </nav>

      <div className="sidebar-foot">
        <SyncPill />
        <span className="grow" />
        <button className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts" onClick={() => app.setDialog({ kind: 'shortcuts' })}><Keyboard size={18} /></button>
      </div>
    </aside>
  );
}
