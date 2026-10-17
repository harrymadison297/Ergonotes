// What a key press means: two-key shortcuts and their timing, the typing guard, which list command a chord is, and
// which rows the search palette lists.
import { describe, expect, it } from 'vitest';
import { SEQUENCE_MS, ShortcutMatcher, commandForChord } from '../src/state/shortcuts.ts';
import { arrangeRows, fit, parseQuery, type GroupName } from '../src/state/paletteRank.ts';

const bound = [
  { id: 'search', keys: ['Mod+k'] },
  { id: 'home', keys: ['g h'] },
  { id: 'tasks', keys: ['g t'] },
  { id: 'help', keys: ['Shift+/'] },
  { id: 'rename', keys: ['F2'] },
  { id: 'none', keys: [] },
];

describe('a shortcut of one chord', () => {
  it('runs the command that has it', () => {
    expect(new ShortcutMatcher().press('Mod+k', false, bound, 0)).toBe('search');
    expect(new ShortcutMatcher().press('Mod+j', false, bound, 0)).toBeNull();
  });
  it('is still a shortcut while typing when it has Ctrl or Alt, or is a function key', () => {
    expect(new ShortcutMatcher().press('Mod+k', true, bound, 0)).toBe('search');
    expect(new ShortcutMatcher().press('F2', true, bound, 0)).toBe('rename');
  });
  it('is text while typing when it is a bare key', () => {
    expect(new ShortcutMatcher().press('Shift+/', true, bound, 0)).toBeNull();
    expect(new ShortcutMatcher().press('Shift+/', false, bound, 0)).toBe('help');
  });
});

describe('a shortcut of two keys', () => {
  it('runs on the second key, and the first key alone runs nothing', () => {
    const m = new ShortcutMatcher();
    expect(m.press('g', false, bound, 1000)).toBeNull();
    expect(m.press('h', false, bound, 1200)).toBe('home');
  });
  it('is forgotten when the second key is late', () => {
    const m = new ShortcutMatcher();
    m.press('g', false, bound, 1000);
    expect(m.press('h', false, bound, 1000 + SEQUENCE_MS)).toBe('home');
    m.press('g', false, bound, 5000);
    expect(m.press('h', false, bound, 5000 + SEQUENCE_MS + 1)).toBeNull();
  });
  it('is forgotten when another key comes in between, and that key counts for itself', () => {
    const m = new ShortcutMatcher();
    m.press('g', false, bound, 0);
    expect(m.press('Mod+k', false, bound, 100)).toBe('search');
    expect(m.press('h', false, bound, 200)).toBeNull();
  });
  it('can be started again right away by the same first key', () => {
    const m = new ShortcutMatcher();
    m.press('g', false, bound, 0);
    expect(m.press('g', false, bound, 100)).toBeNull();
    expect(m.press('t', false, bound, 200)).toBe('tasks');
  });
  it('does not start while typing, so "g" is text there', () => {
    const m = new ShortcutMatcher();
    expect(m.press('g', true, bound, 0)).toBeNull();
    expect(m.press('h', false, bound, 100)).toBeNull();
  });
});

describe('which command a chord is', () => {
  it('is the command that has it, and nothing for a chord nobody has or no chord', () => {
    expect(commandForChord('F2', bound)).toBe('rename');
    expect(commandForChord('F3', bound)).toBeNull();
    expect(commandForChord(null, bound)).toBeNull();
  });
});

describe('what the search palette lists', () => {
  const row = (id: string, group: GroupName, rank: number) => ({ id, group, rank });

  it('reads the first character as a mode', () => {
    expect(parseQuery('plan')).toEqual({ mode: 'all', query: 'plan' });
    expect(parseQuery('> sync')).toEqual({ mode: 'commands', query: 'sync' });
    expect(parseQuery('#work')).toEqual({ mode: 'tags', query: 'work' });
    expect(parseQuery('-  call ')).toEqual({ mode: 'tasks', query: 'call' });
  });
  it('rates how a word fits: start of the text, start of a word, inside, not at all', () => {
    expect(fit('Weekly plan', ['weekly'])).toBe(0);
    expect(fit('Weekly plan', ['plan'])).toBe(1);
    expect(fit('Weekly plan', ['eekl'])).toBe(2);
    expect(fit('Weekly plan', ['plan', 'zzz'])).toBe(3);
  });
  it('keeps the better fits of a group first and drops what does not fit', () => {
    const rows = [row('a', 'Notes', 2), row('b', 'Notes', 0), row('c', 'Notes', 3)];
    expect(arrangeRows(rows, { mode: 'all', query: 'x', terms: ['x'] }).map(r => r.id)).toEqual(['b', 'a']);
  });
  it('shows a command, page or tag next to notes only when it starts a word with what was typed', () => {
    const rows = [row('n', 'Notes', 2), row('c', 'Commands', 2), row('p', 'Pages', 1), row('t', 'Tags', 0)];
    expect(arrangeRows(rows, { mode: 'all', query: 'x', terms: ['x'] }).map(r => r.id)).toEqual(['t', 'p', 'n']);
    // the Commands list (">") is looser
    expect(arrangeRows([row('c', 'Commands', 2)], { mode: 'commands', query: 'x', terms: ['x'] }).map(r => r.id)).toEqual(['c']);
  });
  it('lists at most 5 tasks, 5 tags, 4 pages and 5 commands next to the notes, but all of them in their own mode', () => {
    const many = (g: GroupName, n: number) => Array.from({ length: n }, (_, i) => row(`${g}${i}`, g, 0));
    expect(arrangeRows(many('Tasks', 9), { mode: 'all', query: 'x', terms: ['x'] })).toHaveLength(5);
    expect(arrangeRows(many('Pages', 9), { mode: 'all', query: 'x', terms: ['x'] })).toHaveLength(4);
    expect(arrangeRows(many('Tasks', 9), { mode: 'tasks', query: 'x', terms: ['x'] })).toHaveLength(9);
  });
  it('puts the group with the best fit first, and the usual order when nothing was typed', () => {
    const rows = [row('n', 'Notes', 2), row('f', 'Folders', 0), row('t', 'Tasks', 1)];
    expect(arrangeRows(rows, { mode: 'all', query: 'x', terms: ['x'] }).map(r => r.id)).toEqual(['f', 't', 'n']);
    expect(arrangeRows(rows, { mode: 'all', query: '', terms: [] }).map(r => r.id)).toEqual(['n', 'f', 't']);
  });
});
