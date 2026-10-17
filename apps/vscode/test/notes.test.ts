import { describe, expect, it } from 'vitest';
import { asTask, chipFor, encodeDest, eventToken, habitOf, isHabitFile, markdownLink, matchNotes, minimalEdit, newHabitText, relativePath, withCheckIn, withRemark, withToken } from '../src/notes.ts';
import { readFileSync } from 'node:fs';

const T = '2026-10-17';

describe('links between notes', () => {
  it('are written relative to the note that holds them', () => {
    expect(relativePath('', 'Plan.md')).toBe('Plan.md');
    expect(relativePath('Projects', 'Projects/Plan.md')).toBe('Plan.md');
    expect(relativePath('Projects/Acme', 'Areas/Home.md')).toBe('../../Areas/Home.md');
    expect(relativePath('Projects', 'Resources/Books/Dune.md')).toBe('../Resources/Books/Dune.md');
    expect(markdownLink('Projects', { title: 'My Plan (v2)', path: 'Areas/My Plan (v2).md' })).toBe('[My Plan (v2)](../Areas/My%20Plan(v2).md)'.replace('Plan(v2)', 'Plan%20(v2)').replace('%20(', '%20('));
    expect(encodeDest('a b/c#d.md')).toBe('a%20b/c%23d.md');
  });

  it('are offered by the name, starting with what was typed', () => {
    const notes = ['Quarterly report', 'Report card', 'Notes on reporting', 'Other'].map(t => ({ title: t, path: `${t}.md` }));
    expect(matchNotes(notes, 'rep').map(n => n.title)).toEqual(['Report card', 'Notes on reporting', 'Quarterly report']);
    expect(matchNotes(notes, '').length).toBe(4);
    expect(matchNotes(notes, 'zzz')).toEqual([]);
  });
});

describe('the lines of a note', () => {
  it('become tasks', () => {
    expect(asTask('buy milk')).toBe('- [ ] buy milk');
    expect(asTask('- buy milk')).toBe('- [ ] buy milk');
    expect(asTask('  * nested')).toBe('  - [ ] nested');
    expect(asTask('- [ ] already')).toBe('- [ ] already');
    expect(asTask('- [x] done')).toBe('- [x] done');
  });

  it('get a due date or a reminder, one at a time', () => {
    expect(withToken('- [ ] call', 'due', '2026-10-20')).toBe('- [ ] call @due(2026-10-20)');
    expect(withToken('- [ ] call @due(2026-10-01)  ', 'due', '2026-10-20')).toBe('- [ ] call @due(2026-10-20)');
    expect(withToken('- [ ] call @due(2026-10-20)', 'remind', '2026-10-19T09:00')).toBe('- [ ] call @due(2026-10-20) @remind(2026-10-19T09:00)');
  });

  it('write an event as the app does', () => {
    expect(eventToken('2026-10-20')).toBe('@event(2026-10-20)');
    expect(eventToken('2026-10-20', '09:00')).toBe('@event(2026-10-20T09:00)');
    expect(eventToken('2026-10-20', '09:00', '10:30')).toBe('@event(2026-10-20T09:00-10:30)');
  });
});

describe('a link to a habit', () => {
  it('is typed with type_habit, as the app writes it', () => {
    expect(markdownLink('', { title: 'Run', path: '.habits/Run.md' }, 'type_habit')).toBe('[Run](.habits/Run.md "type_habit")');
    expect(markdownLink('Projects', { title: 'Drink water', path: '.habits/Drink water.md' }, 'type_habit')).toBe('[Drink water](../.habits/Drink%20water.md "type_habit")');
    expect(markdownLink('Projects', { title: 'Plan', path: 'Areas/Plan.md' })).toBe('[Plan](../Areas/Plan.md)');
  });
  it('is a file of .habits, one level deep', () => {
    expect(isHabitFile('.habits/Run.md')).toBe(true);
    expect(isHabitFile('Habits/Run.md')).toBe(false);
    expect(isHabitFile('.habits/sub/Run.md')).toBe(false);
    expect(isHabitFile('Projects/.habits/Run.md')).toBe(false);
  });
});

describe('a habit note', () => {
  const note = newHabitText({ title: 'Run', target: 2, per: 3, start: '2026-10-10' });

  it('is what the new habit command writes', () => {
    expect(note).toBe('---\nhabit: true\ntarget: 2\nper: 3\nstart: 2026-10-10\n---\n\n## Log\n');
    expect(habitOf(note, T)!.def).toMatchObject({ target: 2, per: 3, start: '2026-10-10' });
    expect(habitOf('# Not a habit', T)).toBeNull();
  });

  it('gets a check-in in its log and nothing else changes', () => {
    const after = withCheckIn(note, T, '07:42', 'easy');
    expect(after).toBe(note + '\n- [x] @done(2026-10-17T07:42) easy\n');
    expect(after.startsWith('---\nhabit: true')).toBe(true);
    const h = habitOf(after, T)!;
    expect(h.status.doneToday).toBe(1);
    expect(chipFor(h).text).toMatch(/to go|met today/);
  });

  it('keeps its frontmatter byte for byte, comments included', () => {
    const t = '---\n# mine\nhabit: true   # yes\ntarget: 1\nper: 1\n---\nBody\n\n## Log\n';
    expect(withCheckIn(t, T, '08:00').startsWith('---\n# mine\nhabit: true   # yes\ntarget: 1\nper: 1\n---\n')).toBe(true);
  });

  it('takes and gives back a remark', () => {
    const r = withRemark(note, '2026-10-16', 'rain');
    expect(r).toContain('- 2026-10-16: rain');
    expect(withRemark(r, '2026-10-16', '')).toBe(note + '\n');
  });

  it('is edited with the least change', () => {
    const before = 'a\nb\nc\n';
    const after = 'a\nb\nNEW\nc\n';
    expect(minimalEdit(before, after)).toEqual({ start: 4, end: 4, text: 'NEW\n' });
    expect(minimalEdit(before, before)).toBeNull();
    expect(minimalEdit('abc', 'xyz')).toEqual({ start: 0, end: 3, text: 'xyz' });
  });
});

describe('the syntax the extension adds to Markdown', () => {
  const g = JSON.parse(readFileSync(new URL('../syntaxes/ergonotes.injection.json', import.meta.url), 'utf8')) as {
    repository: Record<string, { match?: string; begin?: string; patterns?: { match: string }[] }>;
  };
  const rx = (m: string) => new RegExp(m, 'g');

  it('finds the tokens, the wiki links and the comments', () => {
    const tokens = g.repository.tokens.patterns!.map(p => rx(p.match));
    const text = 'x @due(2026-10-20) @remind(2026-10-20T09:00) @done(2026-10-17T07:42) @event(2026-10-21) @flag';
    expect(tokens.map(r => (text.match(r) ?? []).length)).toEqual([2, 1, 1, 1]);
    expect('see [[Plan]] and ![[pic.png]]'.match(rx(g.repository.wikilink.match!))).toEqual(['[[Plan]]', '![[pic.png]]']);
    expect('a %%hidden%% b'.match(rx(g.repository.comment.match!))).toEqual(['%%hidden%%']);
  });

  it('opens the fence of a drawing and nothing else', () => {
    const begin = new RegExp(g.repository.drawing.begin!);
    expect(begin.test('```ergonote-excalidraw')).toBe(true);
    expect(begin.test('```ts')).toBe(false);
  });
});
