import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, FileText, Folder as FolderIcon, Search, X } from 'lucide-react';
import type { SearchHit } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, relTime } from '../state/util';
import { IconBtn, TagDots } from './ui';

/** Bold the parts of `text` that match any query word. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

/** Search popup: folders and notes appear as you type, each with where it lives and the matching passage. */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const query = q.trim();
  const terms = useMemo(() => query.split(/\s+/).filter(Boolean), [query]);

  useEffect(() => {
    let live = true;
    if (!query) { setHits(null); return; }
    const t = setTimeout(() => {
      void app.api.searchHits(query).then(r => { if (live) { setHits(r); setSel(0); } }, () => { if (live) setHits([]); });
    }, 110);
    return () => { live = false; clearTimeout(t); };
  }, [query, app.api]);

  // with nothing typed: the notes touched last
  const recent = useMemo<SearchHit[]>(() => app.items
    .filter(i => i.type === 'note' && !i.inTrash && !i.template)
    .sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8)
    .map(n => ({
      id: n.id, type: 'note' as const, title: n.title, tags: n.tags, in: 'title' as const, context: n.snippet, updated: n.updated,
      path: pathOf(n.parent),
    })), [app.items]); // eslint-disable-line react-hooks/exhaustive-deps

  function pathOf(parent: string | null): { id: string; title: string }[] {
    const out: { id: string; title: string }[] = [];
    const seen = new Set<string>();
    let cur = parent;
    while (cur && !seen.has(cur)) { seen.add(cur); const f = app.byId.get(cur); if (!f) break; out.unshift({ id: f.id, title: f.title }); cur = f.parent; }
    return out;
  }

  const rows = hits ?? recent;
  const folders = rows.filter(r => r.type === 'folder');
  const notes = rows.filter(r => r.type === 'note');
  const ordered = [...folders, ...notes];

  const open = (h: SearchHit) => {
    onClose();
    if (h.type === 'folder') app.go({ name: 'notes', folder: h.id });
    else app.go({ name: 'notes', note: h.id, folder: h.path.at(-1)?.id });
  };
  const seeAll = () => { onClose(); app.go({ name: 'notes', q: query }); };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, rows]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(ordered.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (ordered[sel]) open(ordered[sel]); else if (query) seeAll();
    }
  };

  const item = (h: SearchHit, idx: number) => {
    const path = h.path.map(p => p.title).join(' / ');
    return (
      <button key={h.id} role="option" id={`sp-${h.id}`} aria-selected={idx === sel} className="palette-item"
        onMouseMove={() => { if (sel !== idx) setSel(idx); }} onClick={() => open(h)}>
        <span className={classNames('ico', h.type === 'folder' && 'folder')}>{h.type === 'folder' ? <FolderIcon size={18} /> : <FileText size={18} />}</span>
        <span className="txt">
          {path && <span className="path">{path}</span>}
          <span className="ttl"><Highlight text={h.title} terms={terms} /></span>
          {h.context && <span className="ctx"><Highlight text={h.context} terms={terms} /></span>}
        </span>
        <span className="side">{h.tags.length > 0 && <TagDots tags={h.tags} />}{h.type === 'note' && <span>{relTime(h.updated)}</span>}</span>
      </button>
    );
  };

  return createPortal(
    <div className="palette-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <Search size={20} aria-hidden />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search notes, folders and tags"
            role="combobox" aria-expanded aria-controls="sp-list" aria-activedescendant={ordered[sel] ? `sp-${ordered[sel].id}` : undefined} aria-label="Search" />
          {q && <IconBtn label="Clear" size="sm" icon={<X size={16} />} onClick={() => setQ('')} />}
        </div>
        <div className="palette-list" id="sp-list" role="listbox" ref={listRef}>
          {hits && ordered.length === 0 && <div className="palette-empty">No notes or folders match “{query}”.</div>}
          {!hits && notes.length === 0 && <div className="palette-empty">Type to search every note and folder.</div>}
          {folders.length > 0 && <div className="palette-group">Folders</div>}
          {folders.map((h, i) => item(h, i))}
          {notes.length > 0 && <div className="palette-group">{hits ? 'Notes' : 'Recent notes'}</div>}
          {notes.map((h, i) => item(h, folders.length + i))}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
          <span className="grow" />
          {query && <button className="btn ghost" onClick={seeAll} style={{ minHeight: 28, padding: '0 8px' }}>Show all results <ArrowRight size={14} /></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
