import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Circle, FileText, Folder as FolderIcon, Hash, Search, X } from 'lucide-react';
import type { SearchHit, TaskEntry } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, dueLabel, relTime } from '../state/util';
import { folderChain } from '../state/tree';
import { COMMANDS, keysFor, useCommands, type Command } from '../state/commands';
import { formatBinding } from '../state/keymap';
import { arrangeRows, fit, parseQuery, type GroupName } from '../state/paletteRank';
import { IconBtn, TagDots } from './ui';

/** Bold the parts of `text` that match any query word. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  const parts = text.split(re);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

interface Row {
  id: string;
  group: GroupName;
  /** 0: starts with what was typed, 1: a word does, 2: it is somewhere inside */
  rank: number;
  icon: ReactNode;
  folder?: boolean;
  path?: string;
  title: string;
  context?: string;
  side?: ReactNode;
  dim?: boolean;
  run: () => void;
}

/**
 * The search popup (Ctrl+K): Notes and Folders as you type, each with where it lives and the matching passage, and with
 * them the Tasks, Tags, Pages and Commands that match. `>` shows only Commands, `#` only Tags, `-` only Tasks.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const cmds = useCommands();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { mode, query } = parseQuery(q);
  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const words = useMemo(() => query.split(/\s+/).filter(Boolean), [query]);

  useEffect(() => {
    let live = true;
    if (!query || mode !== 'all') { setHits(null); return; }
    const t = setTimeout(() => {
      void app.api.searchHits(query).then(r => { if (live) { setHits(r); setSel(0); } }, () => { if (live) setHits([]); });
    }, 110);
    return () => { live = false; clearTimeout(t); };
  }, [query, mode, app.api]);

  // with nothing typed: the notes touched last
  const recent = useMemo<SearchHit[]>(() => app.items
    .filter(i => i.type === 'note' && !i.inTrash && !i.template)
    .sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8)
    .map(n => ({ id: n.id, type: 'note' as const, title: n.title, tags: n.tags, context: n.snippet, updated: n.updated, path: folderChain(app.byId, n.parent) })),
  [app.items, app.byId]);

  const go = (r: Parameters<typeof app.go>[0]) => { onClose(); app.go(r); };
  const hitRow = (h: SearchHit, group: GroupName): Row => ({
    id: h.id, group, rank: 1, folder: h.type === 'folder', icon: h.type === 'folder' ? <FolderIcon size={18} /> : <FileText size={18} />,
    path: h.path.map(p => p.title).join(' / '), title: h.title, context: h.context,
    side: <>{h.tags.length > 0 && <TagDots tags={h.tags} />}{h.type === 'note' && <span>{relTime(h.updated)}</span>}</>,
    run: () => go(h.type === 'folder' ? { name: 'notes', folder: h.id } : { name: 'notes', note: h.id, folder: h.path.at(-1)?.id }),
  });
  const taskRow = (t: TaskEntry): Row => {
    const due = t.due ? dueLabel(t.due) : null;
    return {
      id: `task:${t.noteId}:${t.index}`, group: 'Tasks', rank: terms.length ? fit(t.text, terms) : 1, dim: t.done,
      icon: t.done ? <Check size={18} /> : <Circle size={18} />, title: t.text || 'Untitled task', context: t.noteTitle,
      side: due ? <span className={classNames(due.overdue && !t.done && 'overdue')}>{due.text}</span> : undefined,
      run: () => go({ name: 'tasks', note: t.noteId, task: t.index }),
    };
  };
  const tagRow = (t: { tag: string; count: number }): Row => ({
    id: `tag:${t.tag}`, group: 'Tags', rank: terms.length ? fit(t.tag, terms) : 1, icon: <Hash size={18} />, title: t.tag,
    side: <span>{t.count} note{t.count === 1 ? '' : 's'}</span>, run: () => go({ name: 'notes', tag: t.tag }),
  });
  const cmdRow = (c: Command): Row => {
    const key = keysFor(c, cmds.prefs.keys)[0];
    return {
      id: `cmd:${c.id}`, group: c.group === 'Navigate' ? 'Pages' : 'Commands', rank: terms.length ? Math.min(fit(c.title, terms), fit(`${c.title} ${c.keywords ?? ''}`, terms) + 1) : 1,
      icon: c.icon ?? <Search size={18} />, title: c.title, side: key ? <kbd>{formatBinding(key)}</kbd> : undefined,
      run: () => { onClose(); cmds.run(c.id); },
    };
  };
  const runnable = COMMANDS.filter(c => !c.scoped && c.id !== 'search.open');

  const rows: Row[] = useMemo(() => {
    let out: Row[] = [];
    if (mode === 'tags') out = app.tags.map(tagRow);
    else if (mode === 'tasks') out = [...app.tasks].sort((a, b) => Number(a.done) - Number(b.done)).map(taskRow);
    else if (mode === 'commands') out = runnable.map(cmdRow);
    else if (!query) out = recent.map(h => hitRow(h, 'Recent notes'));
    else {
      out = [
        ...(hits ?? []).map(h => hitRow(h, h.type === 'folder' ? 'Folders' : 'Notes')),
        ...app.tasks.map(taskRow).slice(0, 400),
        ...app.tags.map(tagRow),
        ...runnable.map(cmdRow),
      ];
    }
    return arrangeRows(out, { mode, query, terms });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query, hits, app.tasks, app.tags, recent, cmds.prefs.keys]);

  useEffect(() => { setSel(0); }, [q]);
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
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(rows.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[sel]) rows[sel].run(); else if (query && mode === 'all') seeAll();
    }
  };

  const item = (r: Row, idx: number) => (
    <button key={r.id} role="option" id={`sp-${idx}`} aria-selected={idx === sel} className={classNames('palette-item', r.dim && 'dim')}
      onMouseMove={() => { if (sel !== idx) setSel(idx); }} onClick={r.run}>
      <span className={classNames('ico', r.folder && 'folder')}>{r.icon}</span>
      <span className="txt">
        {r.path && <span className="path">{r.path}</span>}
        <span className="ttl"><Highlight text={r.title} terms={words} /></span>
        {r.context && <span className="ctx"><Highlight text={r.context} terms={words} /></span>}
      </span>
      <span className="side">{r.side}</span>
    </button>
  );

  let last: GroupName | null = null;
  const empty = mode === 'tags' ? 'No tags yet.' : mode === 'tasks' ? 'No tasks match.' : mode === 'commands' ? 'No command matches.' : `Nothing matches “${query}”.`;
  return createPortal(
    <div className="palette-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="palette-input">
          <Search size={20} aria-hidden />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search notes, tasks, tags and commands"
            role="combobox" aria-expanded aria-controls="sp-list" aria-activedescendant={rows[sel] ? `sp-${sel}` : undefined} aria-label="Search" />
          {q && <IconBtn label="Clear" icon={<X size={16} />} onClick={() => setQ('')} />}
        </div>
        <div className="palette-list" id="sp-list" role="listbox" ref={listRef}>
          {rows.length === 0 && (query || mode !== 'all') && <div className="palette-empty">{hits === null && mode === 'all' && query ? 'Searching…' : empty}</div>}
          {rows.length === 0 && !query && mode === 'all' && <div className="palette-empty">Type to search every note and folder.</div>}
          {rows.map((r, i) => {
            const head = r.group !== last ? <div key={`g-${r.group}`} className="palette-group">{r.group}</div> : null;
            last = r.group;
            return <Fragment key={r.id}>{head}{item(r, i)}</Fragment>;
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span>
          {mode === 'all' && !query && <span><kbd>&gt;</kbd> commands <kbd>#</kbd> tags <kbd>-</kbd> tasks</span>}
          <span className="grow" />
          {query && mode === 'all' && <button className="btn ghost" onClick={seeAll} style={{ padding: '0 10px' }}>Show all results <ArrowRight size={14} /></button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
