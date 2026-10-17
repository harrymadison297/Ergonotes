// Tabs (CONTEXT.md, Tab): the open Notes and External files of this Device, in the strip above the content.
// The address (route) stays the truth about what is shown; the tabs follow it.
import { useSyncExternalStore } from 'react';
import { href, type Route } from './router';

export interface Tab {
  /** `note:<id>` or `ext:<path>` */
  key: string;
  kind: 'note' | 'external';
  /** the note id, or the full path of the file */
  ref: string;
  /** where the tab leads: the address it was last at (keeps the folder a note was opened in) */
  href: string;
}

export interface TabsState { tabs: Tab[]; active: string | null; closed: Tab[] }

const STORE = 'ergo.tabs';
export const MAX_CLOSED = 20;
export const MAX_TABS = 40;

const empty = (): TabsState => ({ tabs: [], active: null, closed: [] });

function valid(t: unknown): t is Tab {
  const x = t as Partial<Tab> | null;
  return !!x && typeof x.key === 'string' && (x.kind === 'note' || x.kind === 'external') && typeof x.ref === 'string' && typeof x.href === 'string';
}

function load(): TabsState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<TabsState> | null;
    if (!raw) return empty();
    const tabs = (raw.tabs ?? []).filter(valid);
    const active = typeof raw.active === 'string' && tabs.some(t => t.key === raw.active) ? raw.active : null;
    return { tabs, active, closed: (raw.closed ?? []).filter(valid).slice(-MAX_CLOSED) };
  } catch { return empty(); }
}

let state: TabsState = load();
const listeners = new Set<() => void>();
function set(next: TabsState) {
  state = next;
  try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private window: tabs last until it closes */ }
  for (const l of listeners) l();
}

export const tabsState = (): TabsState => state;
export function useTabs(): TabsState {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
/** For tests: start from a given state. */
export function resetTabs(next: TabsState = empty()) { state = next; for (const l of listeners) l(); }

/** The tab an address stands for, if any: only an open Note or an External file is a tab; Home, Calendar and the rest are not. */
export function tabFor(r: Route): Tab | null {
  if (r.name === 'notes' && r.note) return { key: `note:${r.note}`, kind: 'note', ref: r.note, href: href(r) };
  if (r.name === 'external' && r.path) return { key: `ext:${r.path}`, kind: 'external', ref: r.path, href: href(r) };
  return null;
}

let newTabNext = 0;
/** The next address that is a tab opens a new one instead of taking over the current one (Ctrl+click, middle click). */
export function openInNewTabNext() { newTabNext = Date.now() + 400; }

/** The address changed: make the tabs agree with it. */
export function followRoute(r: Route) {
  const t = tabFor(r);
  if (!t) { if (state.active !== null) set({ ...state, active: null }); return; }
  const fresh = newTabNext > Date.now();
  newTabNext = 0;
  const at = state.tabs.findIndex(x => x.key === t.key);
  if (at >= 0) {
    set({ ...state, tabs: state.tabs.map((x, i) => (i === at ? { ...x, href: t.href } : x)), active: t.key });
    return;
  }
  const cur = state.tabs.findIndex(x => x.key === state.active);
  let tabs = state.tabs.slice();
  if (fresh || cur < 0) tabs.splice(cur < 0 ? tabs.length : cur + 1, 0, t);
  else tabs[cur] = t; // clicking in a tab takes it over, as in a browser
  if (tabs.length > MAX_TABS) tabs = tabs.slice(tabs.length - MAX_TABS);
  set({ ...state, tabs, active: t.key });
}

/** Close a tab. Returns the address to go to when the closed tab was the one shown (`#/` when none is left). */
export function closeTab(key: string, o: { remember?: boolean } = {}): string | null {
  const at = state.tabs.findIndex(x => x.key === key);
  if (at < 0) return null;
  const gone = state.tabs[at];
  const tabs = state.tabs.filter(x => x.key !== key);
  const closed = o.remember === false ? state.closed : [...state.closed, gone].slice(-MAX_CLOSED);
  if (state.active !== key) { set({ ...state, tabs, closed }); return null; }
  const next = tabs[at] ?? tabs[at - 1] ?? null;
  set({ tabs, active: next?.key ?? null, closed });
  return next ? next.href : '#/';
}

/** Open the tab closed last again. Returns its address. */
export function reopenTab(): string | null {
  const closed = state.closed.slice();
  const t = closed.pop();
  if (!t) return null;
  if (state.tabs.some(x => x.key === t.key)) { set({ ...state, closed }); return t.href; }
  const cur = state.tabs.findIndex(x => x.key === state.active);
  const tabs = state.tabs.slice();
  tabs.splice(cur < 0 ? tabs.length : cur + 1, 0, t);
  set({ tabs, active: t.key, closed });
  return t.href;
}

/** The address of the tab `by` places after the shown one (wrapping round). */
export function neighbourTab(by: 1 | -1): string | null {
  const n = state.tabs.length;
  if (n === 0) return null;
  const cur = state.tabs.findIndex(x => x.key === state.active);
  return state.tabs[cur < 0 ? (by === 1 ? 0 : n - 1) : (cur + by + n) % n].href;
}

/** Notes that are gone (deleted, purged) have no tab. They are not offered for reopening either. */
export function dropMissingNotes(known: Set<string>) {
  const gone = state.tabs.filter(t => t.kind === 'note' && !known.has(t.ref));
  if (gone.length === 0 && !state.closed.some(t => t.kind === 'note' && !known.has(t.ref))) return;
  const keep = (t: Tab) => t.kind !== 'note' || known.has(t.ref);
  const tabs = state.tabs.filter(keep);
  const active = state.active && tabs.some(t => t.key === state.active) ? state.active : null;
  set({ tabs, active, closed: state.closed.filter(keep) });
}

/** Move a tab to the place of another (dragging in the strip). */
export function moveTab(key: string, beforeKey: string | null) {
  const from = state.tabs.findIndex(t => t.key === key);
  if (from < 0 || key === beforeKey) return;
  const tabs = state.tabs.slice();
  const [t] = tabs.splice(from, 1);
  const to = beforeKey ? tabs.findIndex(x => x.key === beforeKey) : tabs.length;
  tabs.splice(to < 0 ? tabs.length : to, 0, t);
  set({ ...state, tabs });
}
