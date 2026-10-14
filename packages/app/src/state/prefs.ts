import { useSyncExternalStore } from 'react';

/** Per-device display preferences (not synced: a phone and a desktop want different layouts). */
export interface Prefs {
  /** show the table of contents beside an open note */
  toc: boolean;
  /** note list layout */
  listView: 'cards' | 'list';
  /** hide the note list beside an open note */
  listHidden: boolean;
  /** hide the sidebar and the list: the note on its own */
  focus: boolean;
  /** the AI chat panel is open beside a note */
  ai: boolean;
  /** grey next-words suggestion while typing (off until asked for: each one is a request to the provider) */
  ghost: boolean;
  /** pause in typing before a suggestion is requested, ms */
  ghostDelay: number;
  /** pane widths in CSS px; null = built-in default */
  sidebarW: number | null;
  listW: number | null;
  tocW: number | null;
  aiW: number | null;
}

type Width = 'sidebarW' | 'listW' | 'tocW' | 'aiW';
export const WIDTHS: Record<Width, { min: number; max: number; cssVar: string }> = {
  sidebarW: { min: 200, max: 420, cssVar: '--sidebar-w' },
  listW: { min: 260, max: 560, cssVar: '--list-w' },
  tocW: { min: 170, max: 420, cssVar: '--toc-w' },
  aiW: { min: 280, max: 560, cssVar: '--ai-w' },
};

const KEY = 'ergo.prefs';
const DEFAULTS: Prefs = { toc: true, listView: 'cards', listHidden: false, focus: false, ai: false, ghost: false, ghostDelay: 400, sidebarW: null, listW: null, tocW: null, aiW: null };
const clampWidth = (k: Width, v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(WIDTHS[k].max, Math.max(WIDTHS[k].min, Math.round(v))) : null;

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      toc: raw.toc !== false,
      listView: raw.listView === 'list' ? 'list' : 'cards',
      listHidden: raw.listHidden === true,
      focus: raw.focus === true,
      ai: raw.ai === true,
      ghost: raw.ghost === true,
      ghostDelay: typeof raw.ghostDelay === 'number' && raw.ghostDelay >= 150 && raw.ghostDelay <= 3000 ? Math.round(raw.ghostDelay) : 400,
      sidebarW: clampWidth('sidebarW', raw.sidebarW),
      listW: clampWidth('listW', raw.listW),
      tocW: clampWidth('tocW', raw.tocW),
      aiW: clampWidth('aiW', raw.aiW),
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
}

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode */ }
  applyPrefs();
  listeners.forEach(l => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}
