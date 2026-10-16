import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, Folder as FolderIcon, FolderPlus, MoreHorizontal } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, relTime, rowClick } from '../state/util';
import { dragSource, dropZone, useDropState, useImportInto, useMoveInto } from '../state/dnd';
import { useItemMenu } from '../state/itemMenu';
import { IconBtn, useMenu } from '../components/ui';

export function FoldersView() {
  const app = useApp();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const menu = useMenu();
  const drop = useDropState();
  const moveInto = useMoveInto();
  const importInto = useImportInto();
  const itemEntries = useItemMenu();
  const folders = app.items.filter(i => i.type === 'folder' && !i.inTrash);
  const notes = app.items.filter(i => i.type === 'note' && !i.inTrash);
  const kids = useMemo(() => {
    const m = new Map<string | null, ItemSummary[]>();
    for (const f of folders) { const k = f.parent && folders.some(x => x.id === f.parent) ? f.parent : null; (m.get(k) ?? m.set(k, []).get(k)!).push(f); }
    for (const l of m.values()) l.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    return m;
  }, [folders]);
  const deepCount = (id: string): number => notes.filter(n => n.parent === id).length + (kids.get(id) ?? []).reduce((a, f) => a + deepCount(f.id), 0);

  const row = (f: ItemSummary, depth: number): JSX.Element[] => {
    if (q && !f.title.toLowerCase().includes(q.toLowerCase()) && !(kids.get(f.id) ?? []).length) return [];
    const children = kids.get(f.id) ?? [];
    const isOpen = open.has(f.id);
    const out = [(
      <tr key={f.id} className={classNames('clickable', drop.key === f.id && 'drop-over')}
        onContextMenu={e => { e.preventDefault(); menu.open({ currentTarget: e.currentTarget }, itemEntries(f)); }}
        {...dragSource({ id: f.id, type: 'folder' })} {...dropZone(f.id, drop, moveInto(f.id), undefined, importInto(f.id))}
        onClick={rowClick(() => app.go({ name: 'notes', folder: f.id }))}>
        <td className="name"><div className="name-cell" style={{ paddingLeft: depth * 22 }}>
          <button className="nav-chevron" aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} style={{ visibility: children.length ? 'visible' : 'hidden' }}>
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <FolderIcon size={18} className="folder-icon" />
          <a href={href({ name: 'notes', folder: f.id })}>{f.title}</a><span className="n">{deepCount(f.id)}</span>
        </div></td>
        <td>{f.created ? new Date(f.created).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</td>
        <td>{relTime(f.updated)}</td>
        <td style={{ textAlign: 'right' }}>
          <IconBtn label={`Actions for ${f.title}`} icon={<MoreHorizontal size={18} />} onClick={e => menu.open(e, itemEntries(f), 'right')} />
        </td>
      </tr>
    )];
    if (isOpen || q) for (const c of children) out.push(...row(c, depth + 1));
    return out;
  };

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div className="page-head">
        <div><h1>Folders</h1><div className="sub">{folders.length} folder{folders.length === 1 ? '' : 's'}</div></div>
        <span className="grow" />
        <input className="input" style={{ width: 240 }} type="search" placeholder="Find folders" aria-label="Find folders" value={q} onChange={e => setQ(e.target.value)} />
        <IconBtn label="New note" icon={<FilePlus2 size={18} />} variant="soft" onClick={() => void app.newNote()} />
        <IconBtn label="New folder" icon={<FolderPlus size={18} />} variant="primary" onClick={() => app.setDialog({ kind: 'newFolder', parent: null })} />
      </div>
      {menu.node}
      <div style={{ padding: '0 28px 40px' }}>
        <table className="table">
          <thead><tr><th>Title</th><th>Created</th><th>Updated</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>{(kids.get(null) ?? []).flatMap(f => row(f, 0))}</tbody>
        </table>
        {folders.length === 0 && <div className="empty"><h3>No folders</h3><p>Create one to organise your notes. Captures go to Inbox, which is recreated when needed.</p></div>}
      </div>
    </div>
  );
}
