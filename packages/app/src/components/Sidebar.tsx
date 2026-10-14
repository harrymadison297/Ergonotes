import { useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarDays, ChevronDown, ChevronRight, FileText, Folder as FolderIcon, FolderPlus, Home, Keyboard, LayoutTemplate,
  MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Settings as SettingsIcon, Star, Tag as TagIcon, Trash2,
  CheckCircle2, FilePlus2,
} from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { activateKeys, classNames, rowClick } from '../state/util';
import { tagStyle } from '../state/tags';
import { dragSource, dropZone, useDropState, useMoveInto, type Dragged } from '../state/dnd';
import { IconBtn, useMenu, type MenuEntry } from './ui';
import { Resizer } from './Resizer';
import { useSync } from './useSync';

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

export function Sidebar() {
  const app = useApp();
  const { items, route, tags, conflicts, go, rail, toggleRail } = app;
  const [openFolders, toggleFolder] = useStoredSet('ergo.openFolders');
  const [openTags, toggleTag] = useStoredSet('ergo.openTags');
  const [foldersOpen, setFoldersOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const folderMenu = useMenu();
  const tagMenu = useMenu();
  const pinnedMenu = useMenu();
  const sync = useSync();
  const drop = useDropState();
  const hover = drop.key;
  const moveInto = useMoveInto();

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

  const isActive = (r: string) => route.name === r;

  // ---- what dropping an item on a row does
  const trashIt = (d: Dragged) => app.trashItem(d.id);
  const pinIt = async (d: Dragged) => { await app.run(app.api.setPinned(d.id, true)); await app.refresh(); };
  const tagIt = (tag: string) => async (d: Dragged) => {
    const cur = app.byId.get(d.id)?.tags ?? [];
    if (cur.includes(tag)) return;
    await app.run(app.api.setTags(d.id, [...cur, tag]));
    await app.refresh();
    app.toast(`Tagged “${tag}”`);
  };
  const notesOnly = (d: Dragged) => d.type === 'note';

  const folderNode = (f: ItemSummary, depth: number): JSX.Element => {
    const kids = childrenOf.get(f.id) ?? [];
    const open = openFolders.has(f.id);
    const active = route.name === 'notes' && route.folder === f.id;
    const key = `f:${f.id}`;
    return (
      <div key={f.id}>
        <div className={classNames('nav-item', active && 'active', hover === key && 'drop-over')} style={{ paddingLeft: depth * 14 }} title={f.title}
          {...dragSource({ id: f.id, type: 'folder' })} {...dropZone(key, drop, moveInto(f.id))}
          onClick={rowClick(() => go({ name: 'notes', folder: f.id }))}
          onContextMenu={e => { e.preventDefault(); folderMenu.open({ currentTarget: e.currentTarget }, folderEntries(f)); }}>
          <button className="nav-chevron" aria-label={open ? 'Collapse' : 'Expand'} onClick={() => toggleFolder(f.id)} style={{ visibility: kids.length ? 'visible' : 'hidden' }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <a className="nav-link" href={href({ name: 'notes', folder: f.id })} draggable={false}>
            <FolderIcon size={18} /><span className="label">{f.title}</span>
          </a>
          <span className="count">{f.childCount || ''}</span>
          <button className="nav-more" aria-label={`Actions for ${f.title}`} onClick={e => folderMenu.open(e, folderEntries(f), 'right')}><MoreHorizontal size={16} /></button>
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
      { label: 'Move to trash', danger: true, icon: <Trash2 size={16} />, onClick: () => void app.trashItem(f.id) },
    ];
  }

  const pinnedEntries = (): MenuEntry[] => pinned.length
    ? pinned.map(p => ({ label: p.title, icon: <FileText size={16} />, onClick: () => go({ name: 'notes', note: p.id, folder: p.parent ?? undefined }) }))
    : [{ label: 'Pin a note to see it here', disabled: true, onClick: () => undefined }];

  const topTags = tagTree.names.filter(n => !n.includes('/'));
  const tagsMenuEntries = (): MenuEntry[] => topTags.length
    ? tagTree.names.map(n => ({ label: n, icon: <i className="tag-dot" style={tagStyle(n)} />, onClick: () => go({ name: 'notes', tag: n }) }))
    : [{ label: 'No tags yet', disabled: true, onClick: () => undefined }];

  const link = (to: string, icon: JSX.Element, label: string, active: boolean, extra?: React.ReactNode) => (
    <a className={classNames('nav-item', active && 'active')} href={to} title={label} aria-current={active ? 'page' : undefined}>
      <span className="nav-chevron blank" aria-hidden />{icon}<span className="label">{label}</span>{extra}
    </a>
  );

  return (
    <aside className={classNames('sidebar', rail && 'rail')} aria-label="Sidebar">
      <div className="quick">
        <button className="new-pill" onClick={() => void app.newNote()} title="New note (Ctrl+N)" aria-label="New note (Ctrl+N)">
          <FilePlus2 size={20} /><span className="new-pill-label">New note</span>
        </button>
        <IconBtn label="Search (Ctrl+K)" className="ring ring-indigo" icon={<Search size={18} />} onClick={() => app.setDialog({ kind: 'search' })} />
        <IconBtn label="New from template" className="ring ring-orange" icon={<LayoutTemplate size={18} />} onClick={() => app.setDialog({ kind: 'templates' })} />
      </div>
      {folderMenu.node}
      {tagMenu.node}
      {pinnedMenu.node}

      <nav className="nav" aria-label="Main">
        {link(href({ name: 'home' }), <Home size={18} />, 'Home', isActive('home'))}

        <div className={classNames('nav-item', hover === 'pinned' && 'drop-over')} role="button" tabIndex={0} title="Pinned"
          aria-expanded={rail ? undefined : pinnedOpen} aria-haspopup={rail ? 'menu' : undefined}
          {...dropZone('pinned', drop, pinIt, notesOnly)}
          onClick={e => { if (rail) pinnedMenu.open(e, pinnedEntries(), 'left'); else setPinnedOpen(o => !o); }}
          onKeyDown={e => activateKeys(() => { if (rail) pinnedMenu.open({ currentTarget: e.currentTarget }, pinnedEntries(), 'left'); else setPinnedOpen(o => !o); })(e)}>
          <span className="nav-chevron">{pinnedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          <Star size={18} /><span className="label">Pinned</span>
        </div>
        {pinnedOpen && (
          <div className="nav-children">
            {pinned.length === 0 && <div className="nav-hint">Pin a note, or drop one here</div>}
            {pinned.map(p => (
              <a key={p.id} className="nav-item" href={href({ name: 'notes', note: p.id, folder: p.parent ?? undefined })} title={p.title}
                {...dragSource({ id: p.id, type: 'note' })}>
                <span className="nav-chevron blank" aria-hidden /><FileText size={16} /><span className="label">{p.title}</span>
              </a>
            ))}
          </div>
        )}
        <div className="nav-sep" />
        {link(href({ name: 'notes' }), <FileText size={18} />, 'Notes', route.name === 'notes' && !route.folder && !route.tag)}
        {link(href({ name: 'tasks' }), <CheckCircle2 size={18} />, 'Tasks', isActive('tasks'))}
        {link(href({ name: 'calendar' }), <CalendarDays size={18} />, 'Calendar', isActive('calendar'))}
        <div className="nav-sep" />

        <div className={classNames('nav-item', route.name === 'folders' && 'active', hover === 'root' && 'drop-over')} title="Folders"
          {...dropZone('root', drop, moveInto(null))}
          onClick={rowClick(() => go({ name: 'folders' }))}>
          <button className="nav-chevron" aria-label="Toggle folders" onClick={() => setFoldersOpen(o => !o)}>{foldersOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
          <a className="nav-link" href={href({ name: 'folders' })}><FolderIcon size={18} /><span className="label">Folders</span></a>
        </div>
        {foldersOpen && <div className="nav-children" style={{ marginLeft: 6 }}>{(childrenOf.get(null) ?? []).map(f => folderNode(f, 0))}</div>}

        <div className="nav-item" role="button" tabIndex={0} title="Tags"
          aria-expanded={rail ? undefined : tagsOpen} aria-haspopup={rail ? 'menu' : undefined}
          onClick={e => { if (rail) tagMenu.open(e, tagsMenuEntries(), 'left'); else setTagsOpen(o => !o); }}
          onKeyDown={e => activateKeys(() => { if (rail) tagMenu.open({ currentTarget: e.currentTarget }, tagsMenuEntries(), 'left'); else setTagsOpen(o => !o); })(e)}>
          <span className="nav-chevron">{tagsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          <TagIcon size={18} /><span className="label">Tags</span>
        </div>
        {tagsOpen && (
          <div className="nav-children">
            {tagTree.names.length === 0 && <div className="nav-hint">No tags yet</div>}
            {tagTree.names.filter(n => { const p = n.split('/'); return p.length === 1 || openTags.has(p.slice(0, -1).join('/')); }).map(n => {
              const depth = n.split('/').length - 1;
              const hasKids = tagTree.names.some(x => x.startsWith(n + '/'));
              const key = `t:${n}`;
              const rename = () => app.setDialog({ kind: 'renameTag', tag: n });
              return (
                <div key={n} className={classNames('nav-item', route.name === 'notes' && route.tag === n && 'active', hover === key && 'drop-over')} style={{ paddingLeft: depth * 14 }} title={n}
                  {...dropZone(key, drop, tagIt(n), notesOnly)}
                  onClick={rowClick(() => go({ name: 'notes', tag: n }))}
                  onContextMenu={e => { e.preventDefault(); tagMenu.open({ currentTarget: e.currentTarget }, [{ label: 'Rename tag…', onClick: rename }]); }}>
                  <button className="nav-chevron" style={{ visibility: hasKids ? 'visible' : 'hidden' }} aria-label="Toggle" onClick={() => toggleTag(n)}>{openTags.has(n) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                  <a className="nav-link" href={href({ name: 'notes', tag: n })}>
                    <i className="tag-dot" style={tagStyle(n)} /><span className="label">{n.split('/').pop()}</span>
                  </a>
                  <span className="count">{tagTree.count(n)}</span>
                  <button className="nav-more" aria-label={`Actions for tag ${n}`} onClick={e => tagMenu.open(e, [{ label: 'Rename tag…', onClick: rename }], 'right')}><MoreHorizontal size={16} /></button>
                </div>
              );
            })}
          </div>
        )}
        <div className="nav-sep" />
        {conflicts.length > 0 && link(href({ name: 'conflicts' }), <AlertTriangle size={18} className="warn-icon" />, 'Conflicts', isActive('conflicts'),
          <><span className="badge">{conflicts.length}</span><i className="alert-dot" /></>)}
        <a className={classNames('nav-item', isActive('trash') && 'active', hover === 'trash' && 'drop-over')} href={href({ name: 'trash' })} title="Trash"
          {...dropZone('trash', drop, trashIt)}>
          <span className="nav-chevron blank" aria-hidden /><Trash2 size={18} /><span className="label">Trash</span>{trashCount > 0 && <span className="count">{trashCount}</span>}
        </a>
      </nav>

      <div className="sidebar-foot">
        <IconBtn label={sync.label} icon={sync.icon} dot={sync.dot} onClick={() => void sync.run()} />
        <span className={classNames('grow', 'sync-text', sync.err && 'err')} title={sync.label}>{sync.text}</span>
        <IconBtn label="Keyboard shortcuts" icon={<Keyboard size={18} />} onClick={() => app.setDialog({ kind: 'shortcuts' })} />
        <IconBtn label="Settings" icon={<SettingsIcon size={18} />} onClick={() => app.setDialog({ kind: 'settings' })} />
        <IconBtn label={rail ? 'Expand sidebar' : 'Collapse sidebar'} icon={rail ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} onClick={toggleRail} />
      </div>
      {!rail && <Resizer pane="sidebarW" edge="right" label="Resize sidebar" />}
    </aside>
  );
}
