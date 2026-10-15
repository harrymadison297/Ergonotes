import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, ChevronDown, Loader2, RefreshCw, Search, Wrench } from 'lucide-react';
import type { ModelInfo } from '@ergonotes/core';
import { classNames } from '../state/util';

const ctxLabel = (n?: number) => (n ? (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`) : '');

/**
 * A model chooser: the models the provider offers, searchable, with what matters about each (free, tools, thinking,
 * context). A name that is not in the list can still be typed and used.
 */
export function ModelPicker({ id, label, value, models, error, loading, needsTools, onPick, onRefresh }: {
  id: string;
  label: string;
  value: string;
  /** null while it has not been loaded */
  models: ModelInfo[] | null;
  error: string | null;
  loading: boolean;
  /** the assistant edits notes through tools: flag models that have none */
  needsTools?: boolean;
  onPick: (id: string) => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const current = models?.find(m => m.id === value);
  const anyFree = !!models?.some(m => m.free);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (models ?? []).filter(m => (!freeOnly || m.free) && (!t || m.id.toLowerCase().includes(t) || (m.name ?? '').toLowerCase().includes(t))).slice(0, 200);
  }, [models, q, freeOnly]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 260 && above > below;
      const maxH = Math.max(200, Math.min(440, up ? above : below));
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 340) - 8)), top: up ? r.top - maxH - 4 : r.bottom + 4, width: Math.max(r.width, 340), maxH });
    };
    place();
    setTimeout(() => field.current?.focus(), 0);
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); window.removeEventListener('resize', place); };
  }, [open]);

  const pick = (m: string) => { onPick(m); setOpen(false); setQ(''); btn.current?.focus(); };
  const typed = q.trim();

  return (
    <>
      <button ref={btn} id={id} type="button" className="input model-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${value}`}
        onClick={() => setOpen(o => !o)}>
        <span className="model-btn-main">
          <span className="model-btn-name">{current?.name ?? value}</span>
          {current?.name && <span className="model-btn-id">{value}</span>}
        </span>
        {loading ? <Loader2 size={15} className="spin" /> : <ChevronDown size={16} />}
      </button>
      {open && pos && (
        <div ref={panel} className="model-panel" role="dialog" aria-label={`Choose the ${label.toLowerCase()}`} style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}>
          <div className="model-search">
            <Search size={15} />
            <input ref={field} value={q} placeholder="Search models, or type a model name" spellCheck={false} aria-label="Search models"
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (shown.length === 1) pick(shown[0].id);
                else if (typed) pick(shown.find(m => m.id === typed)?.id ?? typed);
              }} />
            <button type="button" className="icon-btn" title="Reload the list" aria-label="Reload the model list" onClick={onRefresh}><RefreshCw size={15} className={loading ? 'spin' : undefined} /></button>
          </div>
          {anyFree && (
            <label className="model-free"><input type="checkbox" checked={freeOnly} onChange={e => setFreeOnly(e.target.checked)} style={{ accentColor: 'var(--green-fill)' }} /> Free models only</label>
          )}
          <div className="model-list" role="listbox">
            {typed && !shown.some(m => m.id === typed) && (
              <button type="button" role="option" aria-selected={false} className="model-item" onClick={() => pick(typed)}>
                <span className="model-item-main"><span className="model-item-name">Use “{typed}”</span><span className="model-item-id">Not in the list: use this name as it is</span></span>
              </button>
            )}
            {error && <div className="model-note err">{error}</div>}
            {!error && models === null && <div className="model-note"><Loader2 size={14} className="spin" /> Loading the list…</div>}
            {!error && models !== null && shown.length === 0 && !typed && <div className="model-note">This provider lists no models.</div>}
            {shown.map(m => (
              <button key={m.id} type="button" role="option" aria-selected={m.id === value} className={classNames('model-item', m.id === value && 'on')} onClick={() => pick(m.id)}>
                <span className="model-item-main">
                  <span className="model-item-name">{m.name ?? m.id}</span>
                  {m.name && <span className="model-item-id">{m.id}</span>}
                </span>
                <span className="model-item-tags">
                  {m.free && <span className="model-tag free">Free</span>}
                  {m.thinking && <span className="model-tag" title="Can think before answering"><Brain size={11} /> thinks</span>}
                  {needsTools && m.tools === false && <span className="model-tag warn" title="No tool support: it can chat but cannot edit notes"><Wrench size={11} /> no tools</span>}
                  {m.context ? <span className="model-tag">{ctxLabel(m.context)}</span> : null}
                  {m.id === value && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
