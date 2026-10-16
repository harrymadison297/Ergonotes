import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Star, X } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { classNames, dueLabel, firstSentence, relTime } from '../state/util';
import { tagStyle } from '../state/tags';
import { dragSource } from '../state/dnd';
import { useItemMenu } from '../state/itemMenu';
import { FileImg } from './FileImg';

// ---------------------------------------------------------------- menus
export type MenuEntry =
  | { sep: true }
  | { title: string }
  | { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; kbd?: string; disabled?: boolean; checked?: boolean };

export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number; w: number; entries: MenuEntry[]; variant?: string } | null>(null);
  const open = useCallback((e: { currentTarget: Element }, entries: MenuEntry[], align: 'left' | 'right' = 'left', variant?: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setState({ x: align === 'left' ? r.left : r.right, y: r.bottom + 4, w: align === 'left' ? 0 : 1, entries, variant });
  }, []);
  const close = useCallback(() => setState(null), []);
  const node = state ? <MenuView {...state} onClose={close} /> : null;
  return { open, node };
}

function MenuView({ x, y, w, entries, variant, onClose }: { x: number; y: number; w: number; entries: MenuEntry[]; variant?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = w ? x - r.width : x;
    let top = y;
    left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8));
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [x, y, w]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    if (document.documentElement.classList.contains('kbd')) ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={classNames('menu', variant)} role="menu" style={pos}>
      {entries.map((e, i) =>
        'sep' in e ? <div key={i} className="menu-sep" role="separator" />
        : 'title' in e ? <div key={i} className="menu-title">{e.title}</div>
        : (
          <button key={i} role="menuitem" className={classNames('menu-item', e.danger && 'danger')} disabled={e.disabled}
            onClick={() => { onClose(); e.onClick(); }}>
            {e.icon}
            <span className="grow">{e.label}</span>
            {e.checked && <Check size={16} />}
            {e.kbd && <span className="kbd">{e.kbd}</span>}
          </button>
        ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- dialogs
export function Dialog({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // parents re-render often; focus and typed text must not reset when they do
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // the first field, else the main action; never the header's Close button
    const root = ref.current;
    (root?.querySelector<HTMLElement>('.content input, .content textarea, .content select')
      ?? root?.querySelector<HTMLElement>('footer button.primary, .content button.primary')
      ?? root?.querySelector<HTMLElement>('.content button, footer button'))?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return createPortal(
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={classNames('dialog', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <IconBtn label="Close" icon={<X size={18} />} onClick={onClose} />
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Toasts({ toasts }: { toasts: { id: number; msg: string; kind: string; action?: { label: string; run: () => void } }[] }) {
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={classNames('toast', t.kind === 'error' && 'error')}>
          {t.msg}
          {t.action && <button className="toast-action" onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- buttons
/** Round icon button: the default way to issue a command. Always labelled (tooltip + aria-label). */
export function IconBtn({ label, icon, onClick, variant, size, active, disabled, dot, haspopup, className }: {
  label: string; icon: ReactNode; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'soft'; size?: 'lg'; active?: boolean; disabled?: boolean;
  dot?: 'ok' | 'err' | 'busy' | null; haspopup?: boolean; className?: string;
}) {
  return (
    <button type="button" className={classNames('icon-btn', variant, size, active && 'active', className)} title={label} aria-label={label}
      aria-haspopup={haspopup ? 'menu' : undefined} disabled={disabled} onClick={onClick}>
      {icon}
      {dot && <i className={classNames('dot', dot === 'err' && 'err', dot === 'busy' && 'busy')} aria-hidden />}
    </button>
  );
}

// ---------------------------------------------------------------- note presentation
/** Coloured dots for tags, for compact views. Names are in the tooltip and the accessible label. */
export function TagDots({ tags, max = 4 }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className="tag-dots" role="img" aria-label={`Tags: ${tags.join(', ')}`} title={tags.join(', ')}>
      {shown.map(t => <i key={t} className="tag-dot" style={tagStyle(t)} />)}
      {rest > 0 && <small>+{rest}</small>}
    </span>
  );
}

/** A tag with its colour dot and name, for roomy views. */
export function TagPill({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const style = tagStyle(tag);
  return (
    <span className="tag-pill" style={style}>
      <i className="tag-dot" />{tag}
      {onRemove && <button type="button" aria-label={`Remove tag ${tag}`} onClick={onRemove}><X size={12} /></button>}
    </span>
  );
}

/**
 * A note's tags and the field to add one. With room, every tag is a pill with its name. When the pills and the field
 * would not fit on one line they become coloured dots, and pointing at (or tabbing to) the dots opens a panel above with
 * the pills, names and remove buttons included. The choice is made by measuring a hidden copy of the pills against the
 * width this bar is given (which does not depend on what is inside), so it cannot flip back and forth by itself.
 */
export function TagBar({ tags, onRemove, children }: { tags: string[]; onRemove?: (tag: string) => void; children?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [dots, setDots] = useState(false);
  const FIELD = children ? 90 + 8 : 0; // the add-tag field keeps this much beside the pills
  const SLACK = 12; // coming back to pills needs this much more room than leaving them did
  useLayoutEffect(() => {
    const el = bar.current, m = measure.current;
    if (!el || !m) return;
    const fit = () => {
      const need = m.getBoundingClientRect().width + (tags.length ? FIELD : 0);
      const have = el.clientWidth;
      setDots(d => tags.length > 0 && (d ? need + SLACK > have : need > have));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tags, FIELD]);
  const pill = (t: string) => <TagPill key={t} tag={t} onRemove={onRemove && (() => onRemove(t))} />;
  const shown = dots && tags.length > 0;
  return (
    <div className="tag-bar" ref={bar}>
      <span className="tag-measure" ref={measure} aria-hidden>{tags.map(t => <TagPill key={t} tag={t} onRemove={onRemove && (() => undefined)} />)}</span>
      {shown ? (
        <span className="tag-cluster" tabIndex={0} role="group" aria-label={`Tags: ${tags.join(', ')}`}>
          <span className="tag-dots">{tags.map(t => <i key={t} className="tag-dot" style={tagStyle(t)} />)}</span>
          <span className="tag-pop"><span className="tag-pop-in">{tags.map(pill)}</span></span>
        </span>
      ) : tags.map(pill)}
      {children}
    </div>
  );
}

export function NoteChips({ n }: { n: ItemSummary }) {
  return (
    <>
      {n.tasksOpen + n.tasksDone > 0 && <span className="chip tasks" title="Checklist progress">{n.tasksDone}/{n.tasksOpen + n.tasksDone}</span>}
      {n.nextReminder && <span className="chip reminder"><Bell size={12} />{dueLabel(n.nextReminder).text.replace('Due ', '')}</span>}
      <TagDots tags={n.tags} />
    </>
  );
}

export function NoteRow({ n, active, href, onClick, cards, plain }: { n: ItemSummary; active?: boolean; href: string; onClick?: () => void; cards?: boolean; plain?: boolean }) {
  // cards show the opening of the note over a few lines; list rows only its first sentence
  const s = cards ? n.snippet : firstSentence(n.snippet);
  const menu = useMenu();
  const entries = useItemMenu();
  return (
    <>
    {menu.node}
    <a className={classNames('note-row', active && 'active')} href={href} onClick={onClick} aria-current={active ? 'true' : undefined}
      onContextMenu={plain ? undefined : e => { e.preventDefault(); menu.open({ currentTarget: e.currentTarget }, entries(n)); }}
      {...dragSource({ id: n.id, type: 'note' })}>
      <div className="info">
        <div className="t">{n.title}{n.conflicted && <span className="chip warn" title="Conflicted revision">conflict</span>}</div>
        {s && <div className="s">{s}</div>}
        <div className="chips">
          <span className="when">{relTime(n.updated)}</span>
          <NoteChips n={n} />
        </div>
      </div>
      {n.thumb && <FileImg className="thumb" src={n.thumb} alt="" />}
    </a>
    </>
  );
}

export function NoteCard({ n, href, folder }: { n: ItemSummary; href: string; folder?: string }) {
  const menu = useMenu();
  const entries = useItemMenu();
  return (
    <>
    {menu.node}
    <a className="card" href={href} onContextMenu={e => { e.preventDefault(); menu.open({ currentTarget: e.currentTarget }, entries(n)); }}
      {...dragSource({ id: n.id, type: 'note' })}>
      {folder && <span className="crumb">{folder}</span>}
      <span className="t">{n.title}</span>
      {n.snippet && <span className="s">{n.snippet}</span>}
      <span className="foot">
        <NoteChips n={n} />
        {n.conflicted && <span className="chip warn">conflict</span>}
        {n.pinned && <Star size={12} aria-label="Pinned" fill="currentColor" />}
        <span className="date">{relTime(n.updated)}</span>
      </span>
    </a>
    </>
  );
}

/** A tag as a link, with how many notes carry it: tag cloud on Home and on the phone's More page. */
export function TagLink({ tag, count, href }: { tag: string; count: number; href: string }) {
  return <a className="tag-pill" href={href} style={tagStyle(tag)}><i className="tag-dot" />{tag}<small>{count}</small></a>;
}
