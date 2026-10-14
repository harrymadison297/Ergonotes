import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import type { ItemSummary } from '@ergonotes/core';
import { Bell, Flag } from 'lucide-react';
import { classNames, dueLabel, relTime } from '../state/util';
import { FileImg } from './FileImg';

// ---------------------------------------------------------------- menus
export type MenuEntry =
  | { sep: true }
  | { title: string }
  | { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; kbd?: string; disabled?: boolean; checked?: boolean };

export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number; w: number; entries: MenuEntry[] } | null>(null);
  const open = useCallback((e: { currentTarget: Element }, entries: MenuEntry[], align: 'left' | 'right' = 'left') => {
    const r = e.currentTarget.getBoundingClientRect();
    setState({ x: align === 'left' ? r.left : r.right, y: r.bottom + 4, w: align === 'left' ? 0 : 1, entries });
  }, []);
  const close = useCallback(() => setState(null), []);
  const node = state ? <MenuView {...state} onClose={close} /> : null;
  return { open, close, node, isOpen: !!state };
}

function MenuView({ x, y, w, entries, onClose }: { x: number; y: number; w: number; entries: MenuEntry[]; onClose: () => void }) {
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
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key); };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="menu" role="menu" style={pos}>
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
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary, button')?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return createPortal(
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={classNames('dialog', wide && 'wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Toasts({ toasts }: { toasts: { id: number; msg: string; kind: string }[] }) {
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={classNames('toast', t.kind === 'error' && 'error')}>{t.msg}</div>)}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- note presentation
export function NoteChips({ n, max = 2 }: { n: ItemSummary; max?: number }) {
  const shown = n.tags.slice(0, max);
  const rest = n.tags.length - shown.length;
  return (
    <>
      {n.tasksOpen + n.tasksDone > 0 && <span className="chip tasks">{n.tasksDone}/{n.tasksOpen + n.tasksDone}</span>}
      {n.nextReminder && <span className="chip reminder"><Bell size={12} />{dueLabel(n.nextReminder).text.replace('Due ', '')}</span>}
      {shown.map(t => <span key={t} className="chip">{t}</span>)}
      {rest > 0 && <span className="chip">+{rest}</span>}
    </>
  );
}

export function NoteRow({ n, active, href, onClick }: { n: ItemSummary; active?: boolean; href: string; onClick?: () => void }) {
  return (
    <a className={classNames('note-row', active && 'active')} href={href} onClick={onClick} aria-current={active ? 'true' : undefined}>
      <div className="info">
        <div className="t">{n.title}{n.conflicted && <span className="chip warn" title="Conflicted revision">conflict</span>}</div>
        {n.snippet && <div className="s">{n.snippet}</div>}
        <div className="chips">
          <span className="when">{relTime(n.updated)}</span>
          <NoteChips n={n} />
        </div>
      </div>
      {n.thumb && <FileImg className="thumb" src={n.thumb} alt="" />}
    </a>
  );
}

export function NoteCard({ n, href }: { n: ItemSummary; href: string }) {
  return (
    <a className="card" href={href}>
      <span className="t">{n.title}</span>
      {n.snippet && <span className="s">{n.snippet}</span>}
      <span className="chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><NoteChips n={n} /></span>
      <span className="foot">
        <span>{relTime(n.updated)}</span>
        <span className="grow" />
        {n.conflicted && <span className="chip warn">conflict</span>}
        {n.pinned && <span aria-label="Pinned">★</span>}
      </span>
    </a>
  );
}

export function FlagIcon() { return <Flag size={14} className="flag" aria-label="Flagged" />; }
