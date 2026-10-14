import { useSyncExternalStore } from 'react';

/** Per-device display preferences (not synced: a phone and a desktop want different sizes). */
export interface Prefs {
  /** interface scale in percent, 50..200 */
  scale: number;
  /** show the table of contents beside an open note */
  toc: boolean;
  /** pane widths in CSS px; null = built-in default */
  sidebarW: number | null;
  listW: number | null;
  tocW: number | null;
}

export const DEFAULT_SCALE = 90;
export const SCALE_MIN = 50;
export const SCALE_MAX = 200;
export const WIDTHS = {
  sidebarW: { min: 200, max: 420, def: 264 },
  listW: { min: 260, max: 560, def: 352 },
  tocW: { min: 170, max: 420, def: 240 },
} as const;

const KEY = 'ergo.prefs';
const DEFAULTS: Prefs = { scale: DEFAULT_SCALE, toc: true, sidebarW: null, listW: null, tocW: null };

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { ...DEFAULTS, ...raw, scale: clampScale(raw.scale ?? DEFAULT_SCALE) };
  } catch { return { ...DEFAULTS }; }
}
const clampScale = (n: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(Number.isFinite(n) ? n : DEFAULT_SCALE)));

let current: Prefs = load();
const listeners = new Set<() => void>();

/** Push the preferences into the document: zoom and the pane-width variables. */
export function applyPrefs(p: Prefs = current): void {
  const root = document.documentElement;
  root.style.setProperty('zoom', String(p.scale / 100));
  for (const k of ['sidebarW', 'listW', 'tocW'] as const) {
    const name = k === 'sidebarW' ? '--sidebar-w' : k === 'listW' ? '--list-w' : '--toc-w';
    const v = p[k];
    if (v == null) root.style.removeProperty(name); else root.style.setProperty(name, `${v}px`);
  }
}

export function setPrefs(patch: Partial<Prefs>): void {
  const next = { ...current, ...patch };
  next.scale = clampScale(next.scale);
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  applyPrefs(next);
  listeners.forEach(l => l());
}

export const getPrefs = (): Prefs => current;
/** CSS zoom factor in effect; pointer and rect coordinates are in real pixels, layout values are not. */
export const zoomFactor = (): number => current.scale / 100;

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}
