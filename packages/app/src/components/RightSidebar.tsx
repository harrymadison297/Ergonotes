import { Sparkles, TableOfContents, X } from 'lucide-react';
import { useApp } from '../state/app';
import { editorBridge, useOutline } from '../state/editorBridge';
import { setPrefs, usePrefs } from '../state/prefs';
import { classNames } from '../state/util';
import { AiHeaderActions, AiPanel } from './AiPanel';
import { IconBtn } from './ui';
import { Resizer } from './Resizer';

function Contents() {
  const outline = useOutline();
  const heads = outline?.headings ?? [];
  return (
    <div className="toc">
      <div className="toc-scroll">
        {!outline
          ? <p className="toc-empty">Open a note to see its headings here.</p>
          : heads.length === 0
            ? <p className="toc-empty">Headings you add to this note show up here.</p>
            : <nav aria-label="Table of contents">{heads.map((h, i) => (
              <button key={`${i}-${h.text}`} className={classNames('toc-item', i === outline.active && 'active')} style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
                title={h.text} onClick={() => editorBridge.fns()?.goto(i)}>{h.text}</button>
            ))}</nav>}
      </div>
    </div>
  );
}

/** Whether the right sidebar has anything to show: the assistant always has, the contents need an open note. */
export function useAsideVisible(): boolean {
  const app = useApp();
  const prefs = usePrefs();
  const outline = useOutline();
  if (!prefs.aside) return false;
  return prefs.asideTab === 'ai' || !!outline || ('note' in app.route && !!app.route.note);
}

/**
 * The right sidebar: the note's contents and the AI assistant, as two tabs of one panel that sits beside every page.
 * On a phone only the assistant exists, and it covers the screen.
 */
export function RightSidebar() {
  const app = useApp();
  const prefs = usePrefs();
  const visible = useAsideVisible();
  if (!visible) return null;
  if (app.isMobile && prefs.asideTab !== 'ai') return null;
  const tab = app.isMobile ? 'ai' : prefs.asideTab;
  return (
    <div className={classNames('aside-wrap', app.isMobile && 'mobile')}>
      <aside className="aside" aria-label="Sidebar">
        {!app.isMobile && <Resizer pane="asideW" edge="left" label="Resize right sidebar" />}
        <header className="aside-head">
          <div className="aside-tabs" role="tablist" aria-label="Sidebar">
            {!app.isMobile && <button role="tab" aria-selected={tab === 'toc'} className={classNames('aside-tab', tab === 'toc' && 'on')} onClick={() => setPrefs({ asideTab: 'toc' })}>
              <TableOfContents size={16} /> Contents</button>}
            <button role="tab" aria-selected={tab === 'ai'} className={classNames('aside-tab', tab === 'ai' && 'on')} onClick={() => setPrefs({ asideTab: 'ai' })}>
              <Sparkles size={16} /> Assistant</button>
          </div>
          <span className="grow" />
          {tab === 'ai' && <AiHeaderActions />}
          <IconBtn label="Close sidebar" icon={<X size={18} />} onClick={() => setPrefs({ aside: false })} />
        </header>
        <div className="aside-body">{tab === 'ai' ? <AiPanel /> : <Contents />}</div>
      </aside>
    </div>
  );
}
