import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, ChevronDown, Loader2, RefreshCw, Search, Wrench } from 'lucide-react';
import type { AiConnectionInfo, ModelInfo, ModelRef } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames } from '../state/util';

const ctxLabel = (n?: number) => (n ? (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`) : '');

interface Listed { models: ModelInfo[] | null; error: string | null; loading: boolean }
const cache = new Map<string, { models: ModelInfo[] }>();
const cacheKey = (c: AiConnectionInfo) => `${c.id}|${c.type}|${c.url}|${c.keyHint ?? ''}`;

/** The models of one connection: fetched when it is first needed, kept while the session lasts, reloadable. */
export function useModels(conn: AiConnectionInfo | undefined, enabled = true): Listed & { reload: () => void } {
  const app = useApp();
  const key = conn ? cacheKey(conn) : '';
  const [state, setState] = useState<Listed>({ models: cache.get(key)?.models ?? null, error: null, loading: false });
  const seq = useRef(0);
  const load = useCallback(async (force: boolean) => {
    if (!conn || !conn.ready) { setState({ models: null, error: conn ? `“${conn.name}” needs ${conn.type === 'custom' ? 'an address' : 'an API key'} first.` : null, loading: false }); return; }
    const hit = cache.get(key);
    if (hit && !force) { setState({ models: hit.models, error: null, loading: false }); return; }
    const mine = ++seq.current;
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const models = await app.aiModels(conn.id);
      cache.set(key, { models });
      if (mine === seq.current) setState({ models, error: null, loading: false });
    } catch (e) {
      if (mine === seq.current) setState({ models: null, error: e instanceof Error ? e.message : String(e), loading: false });
    }
  }, [app, conn, key]);
  useEffect(() => { if (enabled) void load(false); }, [load, enabled]);
  return { ...state, reload: () => void load(true) };
}

const nameOf = (list: ModelInfo[] | null, id: string): string => list?.find(m => m.id === id)?.name ?? id;

/**
 * A model chooser across connections: pick the connection, then search the models it offers (free, tools, thinking,
 * context are shown). A name that is not in the list can still be typed and used.
 */
export function ModelPicker({ id, label, value, connections, needsTools, variant = 'field', onPick }: {
  id?: string;
  label: string;
  value: ModelRef;
  connections: AiConnectionInfo[];
  /** the assistant edits notes through tools: flag models that have none */
  needsTools?: boolean;
  /** `pill`: a compact button for the chat composer */
  variant?: 'field' | 'pill';
  onPick: (ref: ModelRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [conn, setConn] = useState(value.connection);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const own = connections.find(c => c.id === value.connection);
  const current = useModels(own, variant === 'field' || open);
  const viewed = connections.find(c => c.id === conn) ?? own;
  const listed = useModels(viewed, open);
  const models = viewed?.id === own?.id ? current.models ?? listed.models : listed.models;
  const anyFree = !!models?.some(m => m.free);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (models ?? []).filter(m => (!freeOnly || m.free) && (!t || m.id.toLowerCase().includes(t) || (m.name ?? '').toLowerCase().includes(t))).slice(0, 200);
  }, [models, q, freeOnly]);

  useEffect(() => {
    if (!open) return;
    setConn(value.connection);
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 300 && above > below;
      const maxH = Math.max(220, Math.min(460, up ? above : below));
      const width = Math.max(r.width, 360);
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: up ? r.top - maxH - 4 : r.bottom + 4, width, maxH });
    };
    place();
    setTimeout(() => field.current?.focus(), 0);
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); window.removeEventListener('resize', place); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (model: string) => {
    if (!viewed) return;
    onPick({ connection: viewed.id, model });
    setOpen(false); setQ(''); btn.current?.focus();
  };
  const typed = q.trim();
  const shownName = nameOf(current.models, value.model);
  const where = own && connections.length > 1 ? own.name : '';

  return (
    <>
      {variant === 'pill' ? (
        <button ref={btn} id={id} type="button" className="ai-mode ai-model-pill" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${value.model || 'none'}`}
          title={`${label}${where ? ` (${where})` : ''}: ${value.model}`} onClick={() => setOpen(o => !o)}>
          <span className="ai-model-pill-name">{value.model ? shownName : 'Choose a model'}</span> <ChevronDown size={14} />
        </button>
      ) : (
        <button ref={btn} id={id} type="button" className="input model-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${value.model || 'none'}`}
          disabled={connections.length === 0} onClick={() => setOpen(o => !o)}>
          <span className="model-btn-main">
            <span className="model-btn-name">{value.model ? shownName : connections.length ? 'Choose a model' : 'Add a connection first'}</span>
            {value.model && <span className="model-btn-id">{shownName !== value.model ? `${value.model} · ` : ''}{own?.name ?? 'No connection'}</span>}
          </span>
          {current.loading ? <Loader2 size={15} className="spin" /> : <ChevronDown size={16} />}
        </button>
      )}
      {open && pos && (
        <div ref={panel} className="model-panel" role="dialog" aria-label={`Choose the ${label.toLowerCase()}`} style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}>
          {connections.length > 1 && (
            <div className="model-conn">
              <label htmlFor={`${id ?? 'mp'}-conn`}>Connection</label>
              <select id={`${id ?? 'mp'}-conn`} className="input" value={viewed?.id ?? ''} onChange={e => { setConn(e.target.value); setQ(''); setFreeOnly(false); }}>
                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
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
            <button type="button" className="icon-btn" title="Reload the list" aria-label="Reload the model list" onClick={listed.reload}><RefreshCw size={15} className={listed.loading ? 'spin' : undefined} /></button>
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
            {listed.error && <div className="model-note err">{listed.error}</div>}
            {!listed.error && models === null && <div className="model-note"><Loader2 size={14} className="spin" /> Loading the list…</div>}
            {!listed.error && models !== null && shown.length === 0 && !typed && <div className="model-note">This connection lists no models.</div>}
            {shown.map(m => {
              const selected = m.id === value.model && viewed?.id === value.connection;
              return (
                <button key={m.id} type="button" role="option" aria-selected={selected} className={classNames('model-item', selected && 'on')} onClick={() => pick(m.id)}>
                  <span className="model-item-main">
                    <span className="model-item-name">{m.name ?? m.id}</span>
                    {m.name && <span className="model-item-id">{m.id}</span>}
                  </span>
                  <span className="model-item-tags">
                    {m.free && <span className="model-tag free">Free</span>}
                    {m.thinking && <span className="model-tag" title="Can think before answering"><Brain size={11} /> thinks</span>}
                    {needsTools && m.tools === false && <span className="model-tag warn" title="No tool support: it can chat but cannot edit notes"><Wrench size={11} /> no tools</span>}
                    {m.context ? <span className="model-tag">{ctxLabel(m.context)}</span> : null}
                    {selected && <Check size={15} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
