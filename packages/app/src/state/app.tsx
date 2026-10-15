import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AiSettings, AiTransport, AudioFile, ModelInfo, TimedTranscript, ItemSummary, Settings, TaskEntry, VaultApi, VaultStatus } from '@ergonotes/core';
import type { Backend } from '../backend';
import { debounce, isoDay } from './util';
import { useRoute, type Route } from './router';
import { setRecordHost } from '../record/host';
import { setApiRef } from './appRef';

export interface Toast { id: number; msg: string; kind: 'info' | 'error'; action?: { label: string; run: () => void } }

export interface AppCtx {
  api: VaultApi;
  mode: 'local' | 'remote';
  /** where the notes live on this device (installed apps only) */
  folder?: Backend['folder'];
  status: VaultStatus;
  items: ItemSummary[];
  byId: Map<string, ItemSummary>;
  tasks: TaskEntry[];
  tags: { tag: string; count: number }[];
  conflicts: { id: string; title: string; heads: number }[];
  settings: Settings;
  /** AI provider settings (the key itself never reaches the UI) */
  ai: AiSettings;
  aiTransport: AiTransport;
  aiModels: (connection: string) => Promise<ModelInfo[]>;
  aiTranscribe: (file: AudioFile, signal?: AbortSignal) => Promise<string>;
  aiTranscribeTimed: (file: AudioFile, signal?: AbortSignal) => Promise<TimedTranscript>;
  route: Route;
  go: (r: Route, replace?: boolean) => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  toast: (msg: string, kind?: 'info' | 'error', action?: Toast['action']) => void;
  /** move a note or folder to the Trash, with an Undo in the toast */
  trashItem: (id: string) => Promise<void>;
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
  /** open (creating when needed) the daily note of a day, today by default */
  openDaily: (day?: string, where?: 'notes' | 'calendar') => Promise<void>;
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
const EMPTY_AI: AiSettings = { connections: [], chatModel: { connection: '', model: '' }, suggestModel: { connection: '', model: '' }, speechModel: { connection: '', model: '' }, speechReady: false, visionModel: { connection: '', model: '' }, visionReady: false, chatReady: false, suggestReady: false, chatThinking: 'auto', suggestThinking: 'off', wholeVault: false, autoApply: false, suggest: false, suggestDelay: 400 };

export function AppProvider({ backend, status: initial, children }: { backend: Backend; status: VaultStatus; children: ReactNode }) {
  const api = backend.api;
  setApiRef(api);
  const [status, setStatus] = useState(initial);
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [conflicts, setConflicts] = useState<{ id: string; title: string; heads: number }[]>([]);
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [ai, setAi] = useState<AiSettings>(EMPTY_AI);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [route, go] = useRoute();
  const isMobile = useMedia('(max-width: 767px)');
  const seq = useRef(0);
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('ergo.rail') !== '0'; } catch { return true; } });
  const toggleRail = useCallback(() => setRail(r => {
    try { localStorage.setItem('ergo.rail', r ? '0' : '1'); } catch { /* private mode */ }
    return !r;
  }), []);

  const toast = useCallback((msg: string, kind: 'info' | 'error' = 'info', action?: Toast['action']) => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, msg, kind, action }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' || action ? 7000 : 3000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await api.status()); } catch { /* offline server */ }
  }, [api]);

  const refresh = useCallback(async () => {
    try {
      const [st, it, tk, tg, cf, se, aiS] = await Promise.all([api.status(), api.listItems(), api.tasks(), api.tags(), api.conflicts(), api.getSettings(), api.getAiSettings()]);
      setStatus(st); setItems(it); setTasks(tk); setTags(tg); setConflicts(cf); setSettings(se); setAi(aiS);
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

  const trashItem = useCallback(async (id: string) => {
    const done = await run(api.trash(id).then(() => true));
    if (!done) return;
    await refresh();
    toast('Moved to trash', 'info', { label: 'Undo', run: () => { void run(api.restore(id)).then(() => refresh()); } });
  }, [api, run, refresh, toast]);

  const newNote = useCallback(async (opts: { parent?: string | null; title?: string; body?: string } = {}) => {
    const n = await run(api.createNote({ parent: opts.parent, title: opts.title ?? '', body: opts.body ?? '' }));
    if (n) { await refresh(); go({ name: 'notes', note: n.id, folder: n.parent ?? undefined }); }
  }, [api, run, refresh, go]);

  const openDaily = useCallback(async (day: string = isoDay(), where: 'notes' | 'calendar' = 'notes') => {
    const d = await run(api.dailyNote(day));
    if (!d) return;
    await refresh();
    go(where === 'calendar' ? { name: 'calendar', note: d.id } : { name: 'notes', note: d.id, folder: d.parent ?? undefined });
  }, [api, run, refresh, go]);

  setRecordHost({
    speechReady: ai.speechReady, visionReady: ai.visionReady, chatReady: ai.chatReady,
    visionName: ai.visionModel.connection ? ai.visionModel.model : ai.chatModel.model,
    transcribe: backend.aiTranscribeTimed, transport: backend.aiTransport, toast,
    openNote: id => go({ name: 'notes', note: id }),
  });
  const value: AppCtx = { api, mode: backend.mode, folder: backend.folder, status, items, byId, tasks, tags, conflicts, settings, ai, aiTransport: backend.aiTransport, aiModels: backend.aiModels, aiTranscribe: backend.aiTranscribe, aiTranscribeTimed: backend.aiTranscribeTimed, route, go, refresh, refreshStatus, toast, trashItem, toasts, isMobile, rail, toggleRail, run, dialog, setDialog, newNote, openDaily };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
