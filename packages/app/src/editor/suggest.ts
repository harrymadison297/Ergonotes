// Tiny dependency-free popup list used by the `[[` link picker and the `/` command menu.
import type { SuggestionOptions } from '@tiptap/suggestion';

export interface PopupItem { id: string; label: string; hint?: string }

export function popupRenderer<T extends PopupItem>(): SuggestionOptions<T>['render'] {
  return () => {
    let el: HTMLDivElement | null = null;
    let items: T[] = [];
    let index = 0;
    let command: ((i: T) => void) | null = null;

    const draw = () => {
      if (!el) return;
      el.innerHTML = '';
      if (items.length === 0) {
        const e = document.createElement('div');
        e.className = 'menu-title';
        e.textContent = 'No matches';
        el.append(e);
        return;
      }
      items.forEach((it, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item';
        b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', String(i === index));
        if (i === index) b.style.background = 'var(--bg-hover)';
        const l = document.createElement('span');
        l.className = 'grow';
        l.textContent = it.label;
        b.append(l);
        if (it.hint) { const h = document.createElement('span'); h.className = 'kbd'; h.textContent = it.hint; b.append(h); }
        b.addEventListener('mousedown', ev => { ev.preventDefault(); command?.(it); });
        el!.append(b);
      });
    };
    const place = (rect: (() => DOMRect | null) | null | undefined) => {
      const r = rect?.();
      if (!el || !r) return;
      el.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
      const below = r.bottom + 6;
      el.style.top = `${below + 240 > window.innerHeight ? Math.max(8, r.top - 6 - (el.offsetHeight || 200)) : below}px`;
    };
    return {
      onStart: props => {
        el = document.createElement('div');
        el.className = 'menu';
        el.setAttribute('role', 'listbox');
        el.style.minWidth = '240px';
        document.body.append(el);
        items = props.items as T[];
        command = props.command as (i: T) => void;
        index = 0;
        draw();
        place(props.clientRect);
      },
      onUpdate: props => {
        items = props.items as T[];
        command = props.command as (i: T) => void;
        index = Math.min(index, Math.max(0, items.length - 1));
        draw();
        place(props.clientRect);
      },
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowDown') { index = (index + 1) % Math.max(1, items.length); draw(); return true; }
        if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') { const it = items[index]; if (it && command) { command(it); return true; } }
        if (event.key === 'Escape') { el?.remove(); el = null; return true; }
        return false;
      },
      onExit: () => { el?.remove(); el = null; },
    };
  };
}
