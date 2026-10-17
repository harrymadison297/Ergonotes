// The Dashboard of Home: a per-Device arrangement of Widgets, mended when read and changed one step at a time.
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE, COLUMN_COUNTS, addWidget, canMove, columnsFor, columnsOf, defaultDashboard, moveWidget, nudgeWidget, parseDashboard, removeWidget, resizeWidget,
  type ColumnCount, type Dashboard,
} from '../src/state/dashboard';

const ids = (d: Dashboard, n: ColumnCount) => d.layouts[n].map(c => [...c]);
/** every Widget exactly once in every layout */
const consistent = (d: Dashboard) => {
  for (const n of COLUMN_COUNTS) {
    expect(d.layouts[n]).toHaveLength(n);
    expect(d.layouts[n].flat().sort()).toEqual(d.widgets.map(w => w.id).sort());
  }
};

describe('the default', () => {
  it('has the Widgets of the plan, in three columns, in two and in one', () => {
    const d = defaultDashboard();
    consistent(d);
    expect(ids(d, 3)).toEqual([['greeting', 'habit-calendar', 'habit-rate'], ['notes', 'scratch', 'pinned'], ['tasks-due', 'reminders', 'habits-today', 'habit-bars']]);
    expect(ids(d, 1)).toEqual([['greeting', 'scratch', 'tasks-due', 'habits-today', 'notes', 'habit-calendar', 'habit-rate', 'pinned', 'reminders', 'habit-bars']]);
    expect(d.widgets.map(w => w.kind).sort()).toEqual(['greeting', 'habit-bars', 'habit-calendar', 'habit-rate', 'habits-today', 'notes', 'pinned', 'reminders', 'scratch', 'tasks-due']);
  });
  it('leaves the other Widgets for the gallery', () => {
    const d = defaultDashboard();
    const out = CATALOGUE.map(c => c.kind).filter(k => !d.widgets.some(w => w.kind === k));
    expect(out).toEqual(['tags', 'recent-files', 'events', 'calendar', 'habit-streaks', 'habit-heat', 'notes-edited', 'tasks-done']);
  });
  it('is a copy each time', () => {
    const a = defaultDashboard();
    a.layouts[3][0].push('x');
    expect(defaultDashboard().layouts[3][0]).not.toContain('x');
  });
});

describe('how many columns', () => {
  it('follow the width of Home', () => {
    expect(columnsFor(1100)).toBe(3);
    expect(columnsFor(940)).toBe(3);
    expect(columnsFor(939)).toBe(2);
    expect(columnsFor(620)).toBe(2);
    expect(columnsFor(619)).toBe(1);
    expect(columnsFor(360)).toBe(1);
  });
});

describe('reading what was stored', () => {
  it('takes a good Dashboard as it is', () => {
    const d = defaultDashboard();
    expect(parseDashboard(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it('returns null when there is nothing', () => {
    for (const raw of [null, undefined, 'x', 3, {}, { widgets: 'no' }]) expect(parseDashboard(raw)).toBeNull();
  });
  it('drops a kind it does not know, a repeated id and a missing size', () => {
    const d = parseDashboard({ widgets: [{ id: 'a', kind: 'notes', size: 'L' }, { id: 'a', kind: 'tags', size: 'S' }, { id: 'b', kind: 'dragon', size: 'S' }, { id: 'c', kind: 'tags', size: 'huge' }, null, { kind: 'tags' }], layouts: {} })!;
    expect(d.widgets).toEqual([{ id: 'a', kind: 'notes', size: 'L' }, { id: 'c', kind: 'tags', size: 'S' }]);
    consistent(d);
  });
  it('puts a Widget that no layout has in the shortest column, and drops ids that are not Widgets', () => {
    const d = parseDashboard({
      widgets: [{ id: 'a', kind: 'notes', size: 'M' }, { id: 'b', kind: 'tags', size: 'S' }, { id: 'c', kind: 'pinned', size: 'S' }],
      layouts: { 3: [['a', 'ghost', 'a'], [], ['b']] },
    })!;
    consistent(d);
    expect(d.layouts[3]).toEqual([['a'], ['c'], ['b']]);
  });
  it('gives a layout with the wrong number of columns the right number', () => {
    const d = parseDashboard({ widgets: [{ id: 'a', kind: 'notes', size: 'M' }], layouts: { 2: [['a'], ['x'], ['y']], 3: [['a']] } })!;
    expect(d.layouts[2]).toEqual([['a'], []]);
    expect(d.layouts[3]).toEqual([['a'], [], []]);
    consistent(d);
  });
});

describe('changing it', () => {
  it('adds a Widget at the end of the shortest column, in every layout, and may add the same kind twice', () => {
    let d = defaultDashboard();
    d = addWidget(d, 'tags', 'tags-1');
    expect(d.layouts[3][0]).toEqual(['greeting', 'habit-calendar', 'habit-rate', 'tags-1']);
    d = addWidget(d, 'tags', 'tags-2');
    expect(d.layouts[3][1]).toEqual(['notes', 'scratch', 'pinned', 'tags-2']);
    expect(d.layouts[1][0].slice(-2)).toEqual(['tags-1', 'tags-2']);
    expect(d.widgets.filter(w => w.kind === 'tags')).toHaveLength(2);
    expect(d.widgets.find(w => w.id === 'tags-1')!.size).toBe('S');
    consistent(d);
    expect(addWidget(d, 'tags', 'tags-2')).toBe(d);
  });
  it('removes a Widget everywhere', () => {
    const d = removeWidget(defaultDashboard(), 'scratch');
    expect(d.widgets.some(w => w.id === 'scratch')).toBe(false);
    consistent(d);
  });
  it('resizes one Widget and nothing else', () => {
    const a = defaultDashboard();
    const b = resizeWidget(a, 'notes', 'L');
    expect(b.widgets.find(w => w.id === 'notes')!.size).toBe('L');
    expect(a.widgets.find(w => w.id === 'notes')!.size).toBe('M');
    expect(b.layouts).toEqual(a.layouts);
  });
  it('moves a Widget before another, into another column, or to the end', () => {
    const a = defaultDashboard();
    expect(moveWidget(a, 3, 'habit-bars', 0, 'habit-calendar').layouts[3][0]).toEqual(['greeting', 'habit-bars', 'habit-calendar', 'habit-rate']);
    expect(moveWidget(a, 3, 'greeting', 2, null).layouts[3]).toEqual([['habit-calendar', 'habit-rate'], ['notes', 'scratch', 'pinned'], ['tasks-due', 'reminders', 'habits-today', 'habit-bars', 'greeting']]);
    expect(moveWidget(a, 3, 'greeting', 1, 'ghost').layouts[3][1]).toEqual(['notes', 'scratch', 'pinned', 'greeting']);
    consistent(moveWidget(a, 3, 'greeting', 2, 'habits-today'));
  });
  it('changes only the layout it was made in', () => {
    const a = defaultDashboard();
    const b = moveWidget(a, 3, 'greeting', 2, null);
    expect(b.layouts[1]).toEqual(a.layouts[1]);
    expect(b.layouts[2]).toEqual(a.layouts[2]);
  });
  it('refuses a move that makes no sense', () => {
    const a = defaultDashboard();
    expect(moveWidget(a, 3, 'ghost', 0, null)).toBe(a);
    expect(moveWidget(a, 3, 'greeting', 3, null)).toBe(a);
    expect(moveWidget(a, 3, 'greeting', -1, null)).toBe(a);
    expect(moveWidget(a, 3, 'greeting', 0, 'greeting')).toBe(a);
  });
  it('is moved a step at a time', () => {
    const a = defaultDashboard();
    expect(nudgeWidget(a, 3, 'habit-calendar', 'up').layouts[3][0]).toEqual(['habit-calendar', 'greeting', 'habit-rate']);
    expect(nudgeWidget(a, 3, 'habit-calendar', 'down').layouts[3][0]).toEqual(['greeting', 'habit-rate', 'habit-calendar']);
    expect(nudgeWidget(a, 3, 'greeting', 'up')).toBe(a);
    expect(nudgeWidget(a, 3, 'habit-rate', 'down')).toBe(a);
    expect(nudgeWidget(a, 3, 'habit-calendar', 'right').layouts[3]).toEqual([['greeting', 'habit-rate'], ['notes', 'habit-calendar', 'scratch', 'pinned'], ['tasks-due', 'reminders', 'habits-today', 'habit-bars']]);
    expect(nudgeWidget(a, 3, 'greeting', 'left')).toBe(a);
    expect(nudgeWidget(a, 3, 'tasks-due', 'right')).toBe(a);
    expect(nudgeWidget(a, 1, 'scratch', 'up').layouts[1][0].slice(0, 2)).toEqual(['scratch', 'greeting']);
    expect(nudgeWidget(a, 1, 'scratch', 'right')).toBe(a);
    for (const dir of ['up', 'down', 'left', 'right'] as const) consistent(nudgeWidget(a, 3, 'scratch', dir));
  });
  it('knows which steps are possible', () => {
    const a = defaultDashboard();
    expect(canMove(a, 3, 'greeting')).toEqual({ up: false, down: true, left: false, right: true });
    expect(canMove(a, 3, 'habit-bars')).toEqual({ up: true, down: false, left: true, right: false });
    expect(canMove(a, 1, 'greeting')).toEqual({ up: false, down: true, left: false, right: false });
    expect(canMove(a, 3, 'ghost')).toEqual({ up: false, down: false, left: false, right: false });
  });
  it('lists the columns with their Widgets', () => {
    const cols = columnsOf(defaultDashboard(), 2);
    expect(cols.map(c => c.map(w => w.kind))).toEqual([['greeting', 'notes', 'scratch', 'pinned'], ['tasks-due', 'habits-today', 'reminders', 'habit-calendar', 'habit-rate', 'habit-bars']]);
  });
});
