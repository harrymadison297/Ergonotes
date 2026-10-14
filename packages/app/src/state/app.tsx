import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ItemSummary, Settings, TaskEntry, VaultApi, VaultStatus } from '@ergonotes/core';
import type { Backend } from '../backend';
import { debounce } from './util';
import { useRoute, type Route } from './router';
import { setApiRef } from './appRef';

export interface Toast { id: number; msg: string; kind: 'info' | 'error' }

export interface AppCtx {
  api: VaultApi;
  mode: 'local' | 'remote';
  status: VaultStatus;
  items: ItemSummary[];
  byId: Map<string, ItemSummary>;
  tasks: TaskEntry[];
  tags: { tag: string; count: number }[];
  conflicts: { id: string; title: string; heads: number }[];
  settings: Settings;
  route: Route;
  go: (r: Route, replace?: boolean) => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  toast: (msg: string, kind?: 'info' | 'error') => void;
  toasts: Toast[];
  isMobile: boolean;
  /** sidebar collapsed to an icon rail */
  rail: boolean;
  toggleRail: () => void;
  /** run an api call, surfacing errors as toasts */
  run: <T>(p: Promise<T>) => Promise<T | undefined>;
  dialog: DialogState;
  setDialog: (d: DialogState) => void;
  newNote: (opts?: { parent?: string | null; title?: string; body?: string }) => Promise<void>;
}

export type DialogState =
  | null
  | { kind: 'settings'; tab?: string }
  | { kind: 'shortcuts' }
  | { kind: 'search' }
  | { kind: 'templates' }
  | { kind: 'move'; id: string }
  | { kind: 'conflict'; id: string }
  | { kind: 'history'; id: string }
  | { kind: 'newFolder'; parent: string | null }
  | { kind: 'rename'; id: string }
  | { kind: 'renameTag'; tag: string }
  | { kind: 'import' }
  | { kind: 'file'; id: string };

const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('outside AppProvider');
  return c;
};

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

const EMPTY_SETTINGS: Settings = { captureFolder: null, dailyFolder: null, theme: 'system' };

export function AppProvider({ backend, status: initial, children }: { backend: Backend; status: VaultStatus; children: ReactNode }) {
  const api = backend.api;
  setApiRef(api);
  const [status, setStatus] = useState(initial);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [conflicts, setConflicts] = useState<{ id: string; title: string; heads: number }[]>([]);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [route, go] = useRoute();
  const isMobile = useMedia('(max-width: 767px)');
  const seq = useRef(0);
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('ergo.rail') === '1'; } catch { return false; } });
  const toggleRail = useCallback(() => setRail(r => {
    try { localStorage.setItem('ergo.rail', r ? '0' : '1'); } catch { /* private mode */ }
    return !r;
  }), []);

  const toast = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.status()); } catch { /* offline server */ }
  }, [api]);

  const refresh = useCallback(async () => {
    try {
      const [st, it, tk, tg, cf, se] = await Promise.all([api.status(), api.listItems(), api.tasks(), api.tags(), api.conflicts(), api.getSettings()]);
      setStatus(st); setItems(it); setTasks(tk); setTags(tg); setConflicts(cf); setSettings(se);
    } catch (e) {
      if ((e as { status?: number }).status !== 401) console.warn('refresh failed', e);
    }
  }, [api]);

  const refreshSoon = useMemo(() => debounce(() => void refresh(), 200), [refresh]);
  const statusSoon = useMemo(() => debounce(() => void refreshStatus(), 200), [refreshStatus]);

  useEffect(() => {
    void refresh();
    backend.start();
    return backend.onEvent(e => { if (e.type === 'items') refreshSoon(); else statusSoon(); });
  }, [backend, refresh, refreshSoon, statusSoon]);

  // keep the badge/pending counters fresh even when only the sync state changes
  useEffect(() => {
    const t = setInterval(() => void refreshStatus(), 15_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const run = useCallback(async <T,>(p: Promise<T>): Promise<T | undefined> => {
    try { return await p; } catch (e) { toast(e instanceof Error ? e.message : String(e), 'error'); return undefined; }
  }, [toast]);

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const newNote = useCallback(async (opts: { parent?: string | null; title?: string; body?: string } = {}) => {
    const n = await run(api.createNote({ parent: opts.parent, title: opts.title ?? '', body: opts.body ?? '' }));
    if (n) { await refresh(); go({ name: 'notes', note: n.id, folder: n.parent ?? undefined }); }
  }, [api, run, refresh, go]);

  const value: AppCtx = { api, mode: backend.mode, status, items, byId, tasks, tags, conflicts, settings, route, go, refresh, refreshStatus, toast, toasts, isMobile, rail, toggleRail, run, dialog, setDialog, newNote };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
