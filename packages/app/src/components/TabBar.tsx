import { useEffect, useState, type DragEvent } from 'react';
import { FileText, X } from 'lucide-react';
import { useApp } from '../state/app';
import { classNames } from '../state/util';
import { closeTab, dropMissingNotes, followRoute, moveTab, showsTabBar, useTabs, type Tab } from '../state/tabs';

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Keeps the tabs in step with the address and with the notes that exist. Render once, near the top. */
export function useTabsFollowRoute() {
  const app = useApp();
  useEffect(() => { followRoute(app.route); }, [app.route]);
  useEffect(() => {
    // before the first list has arrived nothing is known, and no tab should be taken for a missing note
    if (app.items.length > 0) dropMissingNotes(new Set(app.items.filter(i => i.type === 'note' && !i.inTrash).map(i => i.id)));
  }, [app.items]);
}

export function TabBar() {
  const app = useApp();
  const { tabs, active } = useTabs();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // one open Item needs no strip; it appears when a second is opened
  if (!showsTabBar(tabs)) return null;
  const title = (t: Tab) => (t.kind === 'note' ? app.byId.get(t.ref)?.title || 'Untitled' : baseName(t.ref));
  const close = (t: Tab) => { const h = closeTab(t.key); if (h) location.hash = h; };
  const onDrop = (e: DragEvent, before: string | null) => { e.preventDefault(); if (dragging) moveTab(dragging, before); setDragging(null); setOver(null); };
  return (
    <div className="tabbar" role="tablist" aria-label="Open notes" onDragOver={e => { if (dragging) e.preventDefault(); }} onDrop={e => onDrop(e, null)}>
      {tabs.map(t => (
        <div key={t.key} role="presentation" className={classNames('tab-item', t.key === active && 'active', over === t.key && 'over', t.kind === 'external' && 'ext')}
          draggable onDragStart={e => { setDragging(t.key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ergo-tab', t.key); }}
          onDragEnd={() => { setDragging(null); setOver(null); }}
          onDragOver={e => { if (dragging) { e.preventDefault(); e.stopPropagation(); setOver(t.key); } }}
          onDrop={e => { e.stopPropagation(); onDrop(e, t.key); }}
          onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
          onAuxClick={e => { if (e.button === 1) { e.preventDefault(); close(t); } }}>
          <a role="tab" aria-selected={t.key === active} href={t.href} title={t.kind === 'external' ? t.ref : title(t)}>
            <FileText size={14} aria-hidden />
            <span>{title(t)}</span>
          </a>
          <button type="button" className="tab-close" aria-label="Close tab" title="Close (Ctrl+W)" onClick={() => close(t)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
