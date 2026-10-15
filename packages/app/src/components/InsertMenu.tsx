import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Star } from 'lucide-react';
import { NodeSelection } from '@tiptap/pm/state';
import { INSERT_GROUPS, INSERT_ITEMS, matchInsert, type InsertCtx, type InsertItem } from '../editor/insertItems';
import { setPrefs, usePrefs } from '../state/prefs';
import { classNames } from '../state/util';

/** The Insert menu: a search box over every element, in groups, with favourites pinned to the top. */
export function InsertMenu({ anchor, ctx, onClose }: { anchor: DOMRect; ctx: InsertCtx; onClose: () => void }) {
  const prefs = usePrefs();
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - r.height - 8)),
    });
  }, [anchor]);

  const favs = prefs.insertFav;
  const sections = useMemo(() => {
    const matched = matchInsert(INSERT_ITEMS, q);
    if (q.trim()) return [{ title: '', items: matched }];
    const pinned = favs.map(id => matched.find(i => i.id === id)).filter((i): i is InsertItem => !!i);
    return [
      ...(pinned.length ? [{ title: 'Pinned', items: pinned }] : []),
      ...INSERT_GROUPS.map(g => ({ title: g as string, items: matched.filter(i => i.group === g) })).filter(s => s.items.length),
    ];
  }, [q, favs]);
  const flat = sections.flatMap(s => s.items);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', down, true);
    return () => document.removeEventListener('mousedown', down, true);
  }, [onClose]);
  useEffect(() => { box.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index, q]);

  const run = (it: InsertItem) => {
    if (it.unavailable?.(ctx)) return;
    onClose();
    // let the menu go and the editor take focus back before the element goes in
    setTimeout(() => {
      // a selected block (a diagram, a contents box) is not replaced: the new element goes below it
      const { selection } = ctx.editor.state;
      if (selection instanceof NodeSelection && !selection.node.isInline) ctx.editor.commands.setTextSelection(selection.to);
      it.run(ctx);
    }, 0);
  };
  const toggleFav = (id: string) => setPrefs({ insertFav: favs.includes(id) ? favs.filter(x => x !== id) : [id, ...favs].slice(0, 12) });

  return createPortal(
    <div ref={box} className="menu insert-menu" role="dialog" aria-label="Insert" style={pos}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => (i + 1) % Math.max(1, flat.length)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (i - 1 + flat.length) % Math.max(1, flat.length)); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = flat[index]; if (it) run(it); }
      }}>
      <label className="insert-search">
        <Search size={16} aria-hidden />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search insert options…" aria-label="Search insert options" />
      </label>
      <div className="insert-list" role="listbox">
        {flat.length === 0 && <p className="hint" style={{ padding: '12px 14px' }}>Nothing matches “{q}”.</p>}
        {sections.map(s => (
          <div key={s.title || 'results'}>
            {s.title && <div className="menu-title">{s.title}</div>}
            {s.items.map(it => {
              const i = flat.indexOf(it);
              const why = it.unavailable?.(ctx) ?? null;
              const fav = favs.includes(it.id);
              return (
                <div key={s.title + it.id} className={classNames('insert-row', i === index && 'on', why && 'off')} data-active={i === index}
                  onMouseMove={() => setIndex(i)}>
                  <button type="button" role="option" aria-selected={i === index} aria-disabled={!!why} className="menu-item" title={why ?? undefined} onClick={() => run(it)}>
                    {it.icon}
                    <span className="grow">{it.label}{why && <span className="insert-why">{why}</span>}</span>
                    {it.hint && <span className="kbd">{it.hint}</span>}
                  </button>
                  <button type="button" className={classNames('insert-star', fav && 'on')} aria-label={fav ? `Unpin ${it.label}` : `Pin ${it.label}`} aria-pressed={fav}
                    onClick={() => toggleFav(it.id)}><Star size={14} fill={fav ? 'currentColor' : 'none'} /></button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
