// The Dashboard (CONTEXT.md): which Widgets Home shows on this Device, in what order and size. It stays on the Device
// (localStorage), outside the Vault, and is never synced or shared. Everything here is pure except the store at the bottom.
import { useSyncExternalStore } from 'react';

export type WidgetKind =
  | 'greeting' | 'notes' | 'scratch' | 'pinned' | 'tags' | 'recent-files'
  | 'tasks-due' | 'reminders' | 'events' | 'calendar'
  | 'habits-today' | 'habit-calendar' | 'habit-rate' | 'habit-bars' | 'habit-streaks' | 'habit-heat'
  | 'notes-edited' | 'tasks-done';
export type WidgetSize = 'S' | 'M' | 'L';
export type WidgetGroup = 'Start' | 'Notes' | 'Tasks' | 'Habits' | 'Activity';

export interface WidgetDef { kind: WidgetKind; title: string; blurb: string; group: WidgetGroup; size: WidgetSize }

/** Every Widget a person can put on Home, in the order the gallery lists them. */
export const CATALOGUE: readonly WidgetDef[] = [
  { kind: 'greeting', title: 'Greeting', blurb: 'The day and date, a face, and the two things you start most: a note and a habit.', group: 'Start', size: 'S' },
  { kind: 'scratch', title: 'Scratch pad', blurb: 'A place to write before you know where it goes. It lands in your Inbox when you send it.', group: 'Notes', size: 'M' },
  { kind: 'notes', title: 'Notes', blurb: 'Your recent notes, or what is waiting in the Inbox.', group: 'Notes', size: 'M' },
  { kind: 'pinned', title: 'Pinned', blurb: 'The notes you pinned.', group: 'Notes', size: 'S' },
  { kind: 'tags', title: 'Tags', blurb: 'Your tags, as a cloud.', group: 'Notes', size: 'S' },
  { kind: 'recent-files', title: 'Recent files', blurb: 'The pictures, documents and recordings added last.', group: 'Notes', size: 'M' },
  { kind: 'tasks-due', title: 'Tasks due', blurb: 'What is due today or overdue.', group: 'Tasks', size: 'M' },
  { kind: 'reminders', title: 'Reminders today', blurb: 'The tasks that will remind you today.', group: 'Tasks', size: 'S' },
  { kind: 'events', title: 'Upcoming events', blurb: 'The events of the next seven days.', group: 'Tasks', size: 'M' },
  { kind: 'calendar', title: 'Calendar', blurb: 'The month, with a dot on each day that has a task due.', group: 'Tasks', size: 'M' },
  { kind: 'habits-today', title: 'Habits today', blurb: 'What each habit still wants today. Tick one to check in.', group: 'Habits', size: 'M' },
  { kind: 'habit-calendar', title: 'Habit calendar', blurb: 'The month, with a ring on each day for how many habits were met.', group: 'Habits', size: 'M' },
  { kind: 'habit-rate', title: 'Habit rate', blurb: 'How much of this month you kept, against last month, and day by day.', group: 'Habits', size: 'S' },
  { kind: 'habit-bars', title: 'Habit bars', blurb: 'Check-ins of each habit this month, side by side.', group: 'Habits', size: 'M' },
  { kind: 'habit-streaks', title: 'Habit streaks', blurb: 'The habits with the longest run now.', group: 'Habits', size: 'S' },
  { kind: 'habit-heat', title: 'Habit heat map', blurb: 'Every day of the year, darker when more habits were met.', group: 'Habits', size: 'L' },
  { kind: 'notes-edited', title: 'Notes edited', blurb: 'How many notes you changed each day, over the last 30 days.', group: 'Activity', size: 'M' },
  { kind: 'tasks-done', title: 'Tasks done', blurb: 'How many tasks you finished each week, over the last 12 weeks.', group: 'Activity', size: 'M' },
];
export const KINDS: readonly WidgetKind[] = CATALOGUE.map(d => d.kind);
const KIND_SET = new Set<string>(KINDS);
export const defOf = (k: WidgetKind): WidgetDef => CATALOGUE.find(d => d.kind === k)!;

export interface WidgetInstance { id: string; kind: WidgetKind; size: WidgetSize }
/** `layouts[n]`: the ids of the Widgets in each of `n` columns, for a Home that is `n` columns wide. */
export type ColumnCount = 1 | 2 | 3;
export interface Dashboard { widgets: WidgetInstance[]; layouts: Record<ColumnCount, string[][]> }

export const COLUMN_COUNTS: readonly ColumnCount[] = [1, 2, 3];

/** How many columns a Home of this width (px) holds. */
export const columnsFor = (width: number): ColumnCount => (width >= 940 ? 3 : width >= 620 ? 2 : 1);

// ---------------------------------------------------------------- the default
const DEFAULT: { kind: WidgetKind; size: WidgetSize }[] = [
  { kind: 'greeting', size: 'S' }, { kind: 'scratch', size: 'M' }, { kind: 'tasks-due', size: 'M' }, { kind: 'habits-today', size: 'M' }, { kind: 'notes', size: 'M' },
  { kind: 'habit-calendar', size: 'M' }, { kind: 'habit-rate', size: 'S' }, { kind: 'pinned', size: 'S' }, { kind: 'reminders', size: 'S' }, { kind: 'habit-bars', size: 'M' },
];
const DEFAULT_LAYOUT: Record<ColumnCount, WidgetKind[][]> = {
  1: [['greeting', 'scratch', 'tasks-due', 'habits-today', 'notes', 'habit-calendar', 'habit-rate', 'pinned', 'reminders', 'habit-bars']],
  2: [['greeting', 'notes', 'scratch', 'pinned'], ['tasks-due', 'habits-today', 'reminders', 'habit-calendar', 'habit-rate', 'habit-bars']],
  3: [['greeting', 'habit-calendar', 'habit-rate'], ['notes', 'scratch', 'pinned'], ['tasks-due', 'reminders', 'habits-today', 'habit-bars']],
};

export function defaultDashboard(): Dashboard {
  const widgets = DEFAULT.map(d => ({ id: d.kind, kind: d.kind, size: d.size }));
  const layouts = {} as Record<ColumnCount, string[][]>;
  for (const n of COLUMN_COUNTS) layouts[n] = DEFAULT_LAYOUT[n].map(col => [...col]);
  return { widgets, layouts };
}

// ---------------------------------------------------------------- reading what was stored
const isSize = (s: unknown): s is WidgetSize => s === 'S' || s === 'M' || s === 'L';

/** The shortest column (the first of equals): where a new Widget goes. */
const shortest = (cols: string[][]): number => cols.reduce((best, c, i) => (c.length < cols[best].length ? i : best), 0);

/** A Dashboard from what was stored, mended: unknown kinds and repeated ids dropped, every Widget in every layout exactly once. Null when nothing usable. */
export function parseDashboard(raw: unknown): Dashboard | null {
  const o = raw as { widgets?: unknown; layouts?: Record<string, unknown> } | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.widgets)) return null;
  const widgets: WidgetInstance[] = [];
  const seen = new Set<string>();
  for (const w of o.widgets as Partial<WidgetInstance>[]) {
    if (!w || typeof w.id !== 'string' || !w.id || seen.has(w.id) || typeof w.kind !== 'string' || !KIND_SET.has(w.kind)) continue;
    seen.add(w.id);
    widgets.push({ id: w.id, kind: w.kind as WidgetKind, size: isSize(w.size) ? w.size : defOf(w.kind as WidgetKind).size });
  }
  const layouts = {} as Record<ColumnCount, string[][]>;
  for (const n of COLUMN_COUNTS) {
    const stored = o.layouts?.[String(n)];
    const cols: string[][] = Array.from({ length: n }, (_, i) => (Array.isArray(stored) && Array.isArray(stored[i]) ? (stored[i] as unknown[]).filter((x): x is string => typeof x === 'string') : []));
    const placed = new Set<string>();
    for (const c of cols) for (let i = c.length - 1; i >= 0; i--) { if (!seen.has(c[i]) || placed.has(c[i])) c.splice(i, 1); else placed.add(c[i]); }
    for (const w of widgets) if (!placed.has(w.id)) cols[shortest(cols)].push(w.id);
    layouts[n] = cols;
  }
  return { widgets, layouts };
}

// ---------------------------------------------------------------- changing it (each returns a new Dashboard)
const copy = (d: Dashboard): Dashboard => ({
  widgets: d.widgets.map(w => ({ ...w })),
  layouts: { 1: d.layouts[1].map(c => [...c]), 2: d.layouts[2].map(c => [...c]), 3: d.layouts[3].map(c => [...c]) },
});

/** A Widget of `kind` is added: in the shortest column of each layout, at its end. */
export function addWidget(d: Dashboard, kind: WidgetKind, id: string): Dashboard {
  const n = copy(d);
  if (n.widgets.some(w => w.id === id)) return d;
  n.widgets.push({ id, kind, size: defOf(kind).size });
  for (const c of COLUMN_COUNTS) n.layouts[c][shortest(n.layouts[c])].push(id);
  return n;
}

export function removeWidget(d: Dashboard, id: string): Dashboard {
  const n = copy(d);
  n.widgets = n.widgets.filter(w => w.id !== id);
  for (const c of COLUMN_COUNTS) n.layouts[c] = n.layouts[c].map(col => col.filter(x => x !== id));
  return n;
}

export function resizeWidget(d: Dashboard, id: string, size: WidgetSize): Dashboard {
  const n = copy(d);
  const w = n.widgets.find(x => x.id === id);
  if (w) w.size = size;
  return n;
}

/** Put a Widget in column `col` of the `cols`-column layout, before `beforeId` (at the end when null or not there). */
export function moveWidget(d: Dashboard, cols: ColumnCount, id: string, col: number, beforeId: string | null): Dashboard {
  if (!d.widgets.some(w => w.id === id) || id === beforeId || col < 0 || col >= cols) return d;
  const n = copy(d);
  n.layouts[cols] = n.layouts[cols].map(c => c.filter(x => x !== id));
  const target = n.layouts[cols][col];
  const at = beforeId ? target.indexOf(beforeId) : -1;
  if (at >= 0) target.splice(at, 0, id); else target.push(id);
  return n;
}

/** One step: up and down within the column, left and right to the next column (at the same height as far as it goes). */
export function nudgeWidget(d: Dashboard, cols: ColumnCount, id: string, dir: 'up' | 'down' | 'left' | 'right'): Dashboard {
  const layout = d.layouts[cols];
  const col = layout.findIndex(c => c.includes(id));
  if (col < 0) return d;
  const at = layout[col].indexOf(id);
  if (dir === 'up' || dir === 'down') {
    const to = at + (dir === 'up' ? -1 : 1);
    if (to < 0 || to >= layout[col].length) return d;
    const n = copy(d);
    const c = n.layouts[cols][col];
    [c[at], c[to]] = [c[to], c[at]];
    return n;
  }
  const next = col + (dir === 'left' ? -1 : 1);
  if (next < 0 || next >= cols) return d;
  return moveWidget(d, cols, id, next, layout[next][Math.min(at, layout[next].length)] ?? null);
}

/** What a Widget can be moved by, for the buttons that are not possible to press. */
export function canMove(d: Dashboard, cols: ColumnCount, id: string): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const layout = d.layouts[cols];
  const col = layout.findIndex(c => c.includes(id));
  if (col < 0) return { up: false, down: false, left: false, right: false };
  const at = layout[col].indexOf(id);
  return { up: at > 0, down: at < layout[col].length - 1, left: col > 0, right: col < cols - 1 };
}

/** The Widgets of each column of the `cols`-column layout. */
export function columnsOf(d: Dashboard, cols: ColumnCount): WidgetInstance[][] {
  const by = new Map(d.widgets.map(w => [w.id, w]));
  return d.layouts[cols].map(c => c.map(id => by.get(id)).filter((w): w is WidgetInstance => !!w));
}

// ---------------------------------------------------------------- the store on this Device
const STORE = 'ergo.dashboard';

function load(): Dashboard {
  try { return parseDashboard(JSON.parse(localStorage.getItem(STORE) ?? 'null')) ?? defaultDashboard(); } catch { return defaultDashboard(); }
}

let state: Dashboard = load();
const listeners = new Set<() => void>();
export function setDashboard(next: Dashboard) {
  state = next;
  try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private window: the arrangement lasts until it closes */ }
  for (const l of listeners) l();
}
export const dashboardNow = (): Dashboard => state;
export function resetDashboard() { setDashboard(defaultDashboard()); }
export function useDashboard(): Dashboard {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
/** For tests: start from a given Dashboard without writing it. */
export function loadDashboardForTest(next: Dashboard) { state = next; for (const l of listeners) l(); }

export const newWidgetId = (kind: WidgetKind): string => `${kind}-${Math.random().toString(36).slice(2, 8)}`;
