import { useSyncExternalStore } from 'react';

/** Per-device display preferences (not synced: a phone and a desktop want different layouts). */
export interface Prefs {
  /** the right sidebar (contents and assistant) is open */
  aside: boolean;
  asideTab: 'toc' | 'ai';
  /** the assistant may only answer (`ask`) or may also propose changes (`edit`) */
  aiMode: 'ask' | 'edit';
  /** note list layout */
  listView: 'cards' | 'list';
  /** hide the note list beside an open note */
  listHidden: boolean;
  /** hide the sidebar and the list: the note on its own */
  focus: boolean;
  /** pane widths in CSS px; null = built-in default */
  sidebarW: number | null;
  listW: number | null;
  asideW: number | null;
  /** note text column: a comfortable reading width, or all the room there is */
  noteWidth: 'readable' | 'full';
  /** Insert menu entries pinned to its top (item ids) */
  insertFav: string[];
  /** size of the text in notes, percent (70-200) */
  textZoom: number;
  /** keys the person set for Commands: id -> bindings; an empty list takes the keys off */
  keys: Record<string, string[]>;
}

export const ZOOM_MIN = 70;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const clampZoom = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(v / ZOOM_STEP) * ZOOM_STEP)) : 100);

type Width = 'sidebarW' | 'listW' | 'asideW';
export const WIDTHS: Record<Width, { min: number; max: number; cssVar: string }> = {
  sidebarW: { min: 200, max: 420, cssVar: '--sidebar-w' },
  listW: { min: 260, max: 560, cssVar: '--list-w' },
  asideW: { min: 280, max: 620, cssVar: '--aside-w' },
};

const KEY = 'ergo.prefs';
const DEFAULTS: Prefs = { aside: true, asideTab: 'toc', aiMode: 'edit', listView: 'cards', listHidden: false, focus: false, sidebarW: null, listW: null, asideW: null, noteWidth: 'readable', insertFav: [], textZoom: 100, keys: {} };
const clampWidth = (k: Width, v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(WIDTHS[k].max, Math.max(WIDTHS[k].min, Math.round(v))) : null;

function cleanKeys(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (v && typeof v === 'object') for (const [id, b] of Object.entries(v as Record<string, unknown>)) if (Array.isArray(b)) out[id] = b.filter((x): x is string => typeof x === 'string').slice(0, 4);
  return out;
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs> & { toc?: boolean; ai?: boolean };
    return {
      // the side panel floats over the note on a small window, so it starts closed there
      aside: raw.aside ?? (raw.toc !== undefined ? raw.toc !== false : window.innerWidth >= 1300),
      asideTab: raw.asideTab === 'ai' || (raw.asideTab === undefined && raw.ai === true) ? 'ai' : 'toc',
      aiMode: raw.aiMode === 'ask' ? 'ask' : 'edit',
      listView: raw.listView === 'list' ? 'list' : 'cards',
      listHidden: raw.listHidden === true,
      focus: raw.focus === true,
      sidebarW: clampWidth('sidebarW', raw.sidebarW),
      listW: clampWidth('listW', raw.listW),
      asideW: clampWidth('asideW', raw.asideW),
      noteWidth: raw.noteWidth === 'full' ? 'full' : 'readable',
      insertFav: Array.isArray(raw.insertFav) ? raw.insertFav.filter((x): x is string => typeof x === 'string').slice(0, 12) : [],
      textZoom: clampZoom(raw.textZoom ?? 100),
      keys: cleanKeys(raw.keys),
    };
  } catch { return { ...DEFAULTS }; }
}

let current: Prefs = load();
const listeners = new Set<() => void>();

/** Push the pane widths into the document as CSS variables. */
export function applyPrefs(p: Prefs = current): void {
  const root = document.documentElement;
  for (const k of Object.keys(WIDTHS) as Width[]) {
    const v = p[k];
    if (v == null) root.style.removeProperty(WIDTHS[k].cssVar); else root.style.setProperty(WIDTHS[k].cssVar, `${v}px`);
  }
  root.style.setProperty('--note-zoom', String(p.textZoom / 100));
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  applyPrefs();
  listeners.forEach(l => l());
}

/** The prefs as they are now, for an event handler that outlives a render. */
export const usePrefsNow = (): Prefs => current;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}
