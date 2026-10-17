import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, LayoutGrid, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../state/app';
import { classNames } from '../state/util';
import {
  CATALOGUE, canMove, columnsFor, columnsOf, moveWidget, newWidgetId, nudgeWidget, removeWidget, resetDashboard, resizeWidget, setDashboard, addWidget, useDashboard,
  type ColumnCount, type Dashboard, type WidgetGroup, type WidgetInstance, type WidgetKind, type WidgetSize,
} from '../state/dashboard';
import { FirstRunBanner } from '../components/FirstRunBanner';
import { WIDGETS } from '../components/widgets';
import { Dialog } from '../components/ui';
import { Mood } from '../components/Mood';

const DRAG = 'text/x-ergo-widget';

/** The width of Home, followed, to know how many columns fit. */
function useColumns(ref: React.RefObject<HTMLElement | null>, isMobile: boolean): ColumnCount {
  const [n, setN] = useState<ColumnCount>(() => (isMobile ? 1 : columnsFor(typeof window === 'undefined' ? 1200 : window.innerWidth - 260)));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setN(isMobile ? 1 : columnsFor(el.clientWidth - 56));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, isMobile]);
  return n;
}

function EditBar({ w, cols, dash }: { w: WidgetInstance; cols: ColumnCount; dash: Dashboard }) {
  const can = canMove(dash, cols, w.id);
  const title = WIDGETS[w.kind].title;
  const move = (dir: 'up' | 'down' | 'left' | 'right') => setDashboard(nudgeWidget(dash, cols, w.id, dir));
  const btn = (dir: 'up' | 'down' | 'left' | 'right', icon: JSX.Element) => (
    <button type="button" className="icon-btn" disabled={!can[dir]} aria-label={`Move ${title} ${dir}`} title={`Move ${dir}`} onClick={() => move(dir)}>{icon}</button>
  );
  return (
    <div className="w-edit" role="toolbar" aria-label={`Change ${title}`}>
      <span className="w-grip" aria-hidden title="Drag to move"><GripVertical size={16} /></span>
      {btn('up', <ArrowUp size={15} />)}
      {btn('down', <ArrowDown size={15} />)}
      {cols > 1 && btn('left', <ArrowLeft size={15} />)}
      {cols > 1 && btn('right', <ArrowRight size={15} />)}
      {cols > 1 && (
        <span className="seg" role="group" aria-label={`Size of ${title}`}>
          {(['S', 'M', 'L'] as const).map(s => <button key={s} type="button" aria-pressed={w.size === s} onClick={() => setDashboard(resizeWidget(dash, w.id, s))}>{s}</button>)}
        </span>
      )}
      <span className="grow" />
      <button type="button" className="icon-btn" aria-label={`Remove ${title}`} title="Remove from Home" onClick={() => setDashboard(removeWidget(dash, w.id))}><X size={16} /></button>
    </div>
  );
}

function Frame({ w, editing, cols, dash, dragging, setDragging, over, setOver }: {
  w: WidgetInstance; editing: boolean; cols: ColumnCount; dash: Dashboard;
  dragging: string | null; setDragging: (id: string | null) => void; over: string | null; setOver: (id: string | null) => void;
}) {
  const e = WIDGETS[w.kind];
  const Body = e.Body;
  const headingId = `wh-${w.id}`;
  const onDragStart = (ev: DragEvent) => { setDragging(w.id); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData(DRAG, w.id); };
  return (
    <section
      className={classNames('widget', `w-${w.kind}`, `size-${w.size}`, e.bare && 'bare', e.headless && 'headless', editing && 'editing', dragging === w.id && 'dragging', over === w.id && 'over')}
      aria-labelledby={e.headless ? undefined : headingId} aria-label={e.headless ? e.title : undefined} data-widget={w.kind} data-widget-id={w.id}
      draggable={editing} onDragStart={editing ? onDragStart : undefined} onDragEnd={() => { setDragging(null); setOver(null); }}
      onDragOver={editing ? ev => { if (dragging && dragging !== w.id) { ev.preventDefault(); ev.stopPropagation(); setOver(w.id); } } : undefined}
      onDrop={editing ? ev => {
        const id = ev.dataTransfer.getData(DRAG);
        if (!id) return;
        ev.preventDefault(); ev.stopPropagation();
        const col = dash.layouts[cols].findIndex(c => c.includes(w.id));
        setDashboard(moveWidget(dash, cols, id, col, w.id));
        setDragging(null); setOver(null);
      } : undefined}>
      {editing && <EditBar w={w} cols={cols} dash={dash} />}
      {!e.headless && (
        <h2 id={headingId}>{e.title}<span className="grow" />
          {e.action && !editing && <a href={e.action.href} className="icon-btn" title={e.action.label} aria-label={e.action.label}><ArrowRight size={18} /></a>}
        </h2>
      )}
      <div className={classNames('w-body', editing && 'inert')} {...(editing ? { 'aria-hidden': true } : {})}><Body size={w.size} /></div>
    </section>
  );
}

const GROUPS: WidgetGroup[] = ['Start', 'Notes', 'Tasks', 'Habits', 'Activity'];

/** Every Widget there is, to put one on Home (the same kind can be put twice). */
function Gallery({ dash, onClose }: { dash: Dashboard; onClose: () => void }) {
  const count = (k: WidgetKind) => dash.widgets.filter(w => w.kind === k).length;
  return (
    <Dialog title="Add a widget" onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Done</button>}>
      <div className="gallery">
        {GROUPS.map(g => (
          <section key={g} aria-label={g}>
            <h3>{g}</h3>
            <ul>
              {CATALOGUE.filter(d => d.group === g).map(d => (
                <li key={d.kind}>
                  <div className="info"><b>{d.title}</b><span>{d.blurb}</span></div>
                  {count(d.kind) > 0 && <small className="muted">{count(d.kind)} on Home</small>}
                  <button className="btn" aria-label={`Add ${d.title}`} onClick={() => setDashboard(addWidget(dash, d.kind, newWidgetId(d.kind)))}><Plus size={15} /> Add</button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function Home() {
  const app = useApp();
  const dash = useDashboard();
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cols = useColumns(ref, app.isMobile);
  const columns = columnsOf(dash, cols);
  const dropIn = (col: number) => (ev: DragEvent) => {
    const id = ev.dataTransfer.getData(DRAG);
    if (!editing || !id) return;
    ev.preventDefault();
    setDashboard(moveWidget(dash, cols, id, col, null));
    setDragging(null); setOver(null);
  };
  return (
    <div className="home" ref={ref}>
      <div className="home-head">
        <h1>Home</h1>
        <span className="grow" />
        {editing ? (
          <>
            <button className="btn" onClick={() => setGallery(true)}><Plus size={16} /> Add widget</button>
            <button className="btn" onClick={() => { if (window.confirm('Put Home back as it was at the start?')) resetDashboard(); }}><RotateCcw size={16} /> Reset</button>
            <button className="btn primary" onClick={() => setEditing(false)}>Done</button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}><SlidersHorizontal size={16} /> Customise</button>
        )}
      </div>
      <FirstRunBanner />
      {editing && <p className="dash-hint muted">This arrangement stays on this device. Drag a widget, or use the arrows, to move it.</p>}
      <div className={classNames('dash', `cols-${cols}`, editing && 'editing')}>
        {columns.map((col, i) => (
          <div key={i} className="dash-col" data-col={i}
            onDragOver={editing ? ev => { if (dragging) ev.preventDefault(); } : undefined} onDrop={dropIn(i)}>
            {col.map(w => <Frame key={w.id} w={w} editing={editing} cols={cols} dash={dash} dragging={dragging} setDragging={setDragging} over={over} setOver={setOver} />)}
            {col.length === 0 && editing && <div className="drop-empty"><LayoutGrid size={18} aria-hidden /> Drop a widget here</div>}
          </div>
        ))}
        {dash.widgets.length === 0 && (
          <div className="dash-empty">
            <Mood name="sleeping" size={80} />
            <h3>Home is empty</h3>
            <p>Choose what you want to see here.</p>
            <button className="btn primary" onClick={() => { setEditing(true); setGallery(true); }}><Plus size={16} /> Add a widget</button>
          </div>
        )}
      </div>
      {gallery && <Gallery dash={dash} onClose={() => setGallery(false)} />}
    </div>
  );
}
