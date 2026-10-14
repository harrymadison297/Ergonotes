import { useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowUp, ChevronRight, FilePlus2, Folder as FolderIcon, FolderOpen, FolderPlus, Inbox, LayoutGrid, List, MoreHorizontal, Pin, PinOff, Trash2,
} from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, relTime } from '../state/util';
import { dragSource, dropZone, type Dragged } from '../state/dnd';
import { FileImg } from '../components/FileImg';
import { IconBtn, TagDots, useMenu, type MenuEntry } from '../components/ui';

type ViewMode = 'icons' | 'details';
const coarse = () => window.matchMedia('(pointer: coarse)').matches;

function folderIcon(f: ItemSummary, size: number) {
  if (f.role === 'inbox') return <Inbox size={size} strokeWidth={1.25} />;
  if (f.role === 'archive') return <Archive size={size} strokeWidth={1.25} />;
  return <FolderIcon size={size} strokeWidth={1.25} fill="currentColor" fillOpacity={0.18} />;
}

/**
 * Fills the right-hand pane when a folder (or tag, or search) is open and no note is selected:
 * the contents laid out like a file manager, with drag and drop.
 */
export function Explorer({ heading, parentId, crumbs, folders, notes }: {
  heading: string;
  /** folder being shown; null = top level; undefined = not a folder (tag or search result) */
  parentId: string | null | undefined;
  crumbs: { id: string | null; title: string }[];
  folders: ItemSummary[];
  notes: ItemSummary[];
}) {
  const app = useApp();
  const [mode, setMode] = useState<ViewMode>(() => { try { return localStorage.getItem('ergo.exview') === 'details' ? 'details' : 'icons'; } catch { return 'icons'; } });
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drop = { key: hover, set: setHover };
  const menu = useMenu();
  useEffect(() => { setSel(null); }, [parentId, heading]);

  const setView = (m: ViewMode) => { setMode(m); try { localStorage.setItem('ergo.exview', m); } catch { /* private mode */ } };
  const isFolderCtx = parentId !== undefined;
  const parentOfCurrent = parentId ? app.byId.get(parentId)?.parent ?? null : null;

  const open = (it: ItemSummary) => {
    if (it.type === 'folder') app.go({ name: 'notes', folder: it.id });
    else app.go({ name: 'notes', note: it.id, folder: it.parent ?? undefined });
  };
  const activate = (it: ItemSummary) => { setSel(it.id); if (coarse()) open(it); };

  const moveInto = (target: string | null) => async (d: Dragged) => {
    if (d.id === target) return;
    const cur = app.byId.get(d.id);
    if ((cur?.parent ?? null) === target) return;
    await app.run(app.api.move(d.id, target));
    await app.refresh();
  };

  const entries = (it: ItemSummary): MenuEntry[] => [
    { label: 'Open', icon: <FolderOpen size={16} />, onClick: () => open(it) },
    { sep: true },
    { label: 'Rename…', onClick: () => app.setDialog({ kind: 'rename', id: it.id }) },
    { label: 'Move to…', onClick: () => app.setDialog({ kind: 'move', id: it.id }) },
    ...(it.type === 'note' ? [{ label: it.pinned ? 'Remove from Shortcuts' : 'Add to Shortcuts', icon: it.pinned ? <PinOff size={16} /> : <Pin size={16} />,
      onClick: async () => { await app.run(app.api.setPinned(it.id, !it.pinned)); await app.refresh(); } }] : []),
    { sep: true },
    { label: 'Move to Trash', icon: <Trash2 size={16} />, danger: true, onClick: async () => { await app.run(app.api.trash(it.id)); await app.refresh(); } },
  ];

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })), [folders]);
  const sortedNotes = useMemo(() => [...notes].sort((a, b) => b.updated.localeCompare(a.updated)), [notes]);
  const total = folders.length + notes.length;

  const tile = (it: ItemSummary) => {
    const key = `x:${it.id}`;
    const isFolder = it.type === 'folder';
    return (
      <button key={it.id} className={classNames('ex-tile', sel === it.id && 'sel', hover === key && 'drop-over')} title={it.title}
        {...dragSource({ id: it.id, type: it.type === 'folder' ? 'folder' : 'note' })}
        {...(isFolder ? dropZone(key, drop, moveInto(it.id)) : {})}
        onClick={() => activate(it)} onDoubleClick={() => open(it)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); open(it); } }}
        onContextMenu={e => { e.preventDefault(); setSel(it.id); menu.open({ currentTarget: e.currentTarget }, entries(it)); }}>
        <span className="ex-icon">
          {isFolder ? folderIcon(it, 68) : (
            <span className="ex-paper" aria-hidden>
              {it.thumb ? <FileImg src={it.thumb} /> : <p>{it.snippet.slice(0, 170)}</p>}
            </span>
          )}
        </span>
        <span className="ex-name">{it.title}</span>
        <span className="ex-sub">
          {isFolder ? `${it.childCount} item${it.childCount === 1 ? '' : 's'}` : relTime(it.updated)}
          {!isFolder && <TagDots tags={it.tags} max={3} />}
        </span>
      </button>
    );
  };

  const row = (it: ItemSummary) => {
    const key = `x:${it.id}`;
    const isFolder = it.type === 'folder';
    return (
      <tr key={it.id} className={classNames('clickable', hover === key && 'drop-over')} aria-selected={sel === it.id}
        {...dragSource({ id: it.id, type: isFolder ? 'folder' : 'note' })}
        {...(isFolder ? dropZone(key, drop, moveInto(it.id)) : {})}
        onClick={() => activate(it)} onDoubleClick={() => open(it)}
        onContextMenu={e => { e.preventDefault(); setSel(it.id); menu.open({ currentTarget: e.currentTarget }, entries(it)); }}>
        <td className="name"><div className="name-cell">
          {isFolder ? <FolderIcon size={18} style={{ color: 'var(--green-ink)' }} /> : <span style={{ width: 18 }} />}
          <a href={isFolder ? `#/notes?folder=${it.id}` : `#/notes/${it.id}${it.parent ? `?folder=${it.parent}` : ''}`} onClick={e => { e.preventDefault(); open(it); }}>{it.title}</a>
        </div></td>
        <td>{isFolder ? `${it.childCount} items` : <TagDots tags={it.tags} max={5} />}</td>
        <td>{relTime(it.updated)}</td>
        <td style={{ textAlign: 'right' }}><IconBtn label={`Actions for ${it.title}`} size="sm" icon={<MoreHorizontal size={16} />} onClick={e => { e.stopPropagation(); menu.open(e, entries(it), 'right'); }} /></td>
      </tr>
    );
  };

  return (
    <div className="explorer">
      <div className="ex-bar">
        {isFolderCtx && (
          <IconBtn label="Up one level" icon={<ArrowUp size={18} />} disabled={parentId === null}
            onClick={() => app.go(parentOfCurrent ? { name: 'notes', folder: parentOfCurrent } : { name: 'notes' })} />
        )}
        <nav className="ex-path" aria-label="Location">
          {isFolderCtx ? crumbs.map((c, i) => {
            const key = `c:${c.id ?? 'root'}`;
            return (
              <span key={key} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {i > 0 && <ChevronRight size={14} aria-hidden />}
                <button className={hover === key ? 'drop-over' : undefined} {...dropZone(key, drop, moveInto(c.id))}
                  onClick={() => app.go(c.id ? { name: 'notes', folder: c.id } : { name: 'notes' })}>{c.title}</button>
              </span>
            );
          }) : <button style={{ fontWeight: 600 }}>{heading}</button>}
        </nav>
        <IconBtn label="New note here" icon={<FilePlus2 size={18} />} onClick={() => void app.newNote({ parent: parentId ?? undefined })} />
        {isFolderCtx && <IconBtn label="New folder here" icon={<FolderPlus size={18} />} onClick={() => app.setDialog({ kind: 'newFolder', parent: parentId })} />}
        <IconBtn label={mode === 'icons' ? 'Show as details' : 'Show as icons'} variant="soft" icon={mode === 'icons' ? <List size={18} /> : <LayoutGrid size={18} />} onClick={() => setView(mode === 'icons' ? 'details' : 'icons')} />
      </div>
      {menu.node}

      <div className={classNames('ex-body', hover === 'body' && 'drop-over')} onClick={e => { if (e.target === e.currentTarget) setSel(null); }}
        {...(isFolderCtx ? dropZone('body', drop, moveInto(parentId ?? null)) : {})}>
        {total === 0 ? (
          <div className="ex-empty">
            <FolderOpen size={44} strokeWidth={1.25} />
            <h3>{isFolderCtx ? 'This folder is empty' : 'Nothing here'}</h3>
            <div>{isFolderCtx ? 'Drop notes or folders here, or create one.' : 'No notes match.'}</div>
            <div className="actions">
              <IconBtn label="New note" variant="primary" size="lg" icon={<FilePlus2 size={20} />} onClick={() => void app.newNote({ parent: parentId ?? undefined })} />
              {isFolderCtx && <IconBtn label="New folder" variant="soft" size="lg" icon={<FolderPlus size={20} />} onClick={() => app.setDialog({ kind: 'newFolder', parent: parentId })} />}
            </div>
          </div>
        ) : mode === 'icons' ? (
          <>
            {sortedFolders.length > 0 && <><div className="ex-section">Folders</div><div className="ex-grid">{sortedFolders.map(tile)}</div></>}
            {sortedNotes.length > 0 && <><div className="ex-section">Notes</div><div className="ex-grid">{sortedNotes.map(tile)}</div></>}
          </>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Tags / items</th><th>Updated</th><th /></tr></thead>
            <tbody>{[...sortedFolders, ...sortedNotes].map(row)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
