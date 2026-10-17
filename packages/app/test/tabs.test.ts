import { beforeEach, describe, expect, it } from 'vitest';
import { closeTab, dropMissingNotes, followRoute, moveTab, neighbourTab, openInNewTabNext, reopenTab, resetTabs, tabFor, tabsState } from '../src/state/tabs';

const note = (id: string) => ({ name: 'notes' as const, note: id });
const keys = () => tabsState().tabs.map(t => t.key);

beforeEach(() => resetTabs());

describe('which addresses are tabs', () => {
  it('a note and an external file are; pages are not', () => {
    expect(tabFor(note('a'))?.key).toBe('note:a');
    expect(tabFor({ name: 'external', path: 'C:\\x\\a.md' })?.key).toBe('ext:C:\\x\\a.md');
    expect(tabFor({ name: 'home' })).toBeNull();
    expect(tabFor({ name: 'calendar', note: 'a' })).toBeNull();
    expect(tabFor({ name: 'notes' })).toBeNull();
  });
});

describe('following the address', () => {
  it('opens a tab for the first note and takes it over for the next one, as a browser does', () => {
    followRoute(note('a'));
    followRoute(note('b'));
    expect(keys()).toEqual(['note:b']);
    expect(tabsState().active).toBe('note:b');
  });

  it('opens a new tab next to the shown one when asked', () => {
    followRoute(note('a'));
    followRoute(note('c'));
    openInNewTabNext();
    followRoute(note('b'));
    expect(keys()).toEqual(['note:c', 'note:b']);
    openInNewTabNext();
    followRoute(note('d'));
    expect(keys()).toEqual(['note:c', 'note:b', 'note:d']);
  });

  it('goes to a tab that is already open instead of opening it twice', () => {
    followRoute(note('a'));
    openInNewTabNext();
    followRoute(note('b'));
    followRoute(note('a'));
    expect(keys()).toEqual(['note:a', 'note:b']);
    expect(tabsState().active).toBe('note:a');
  });

  it('shows no tab as active on a page, and keeps the tabs', () => {
    followRoute(note('a'));
    followRoute({ name: 'calendar' });
    expect(tabsState().active).toBeNull();
    expect(keys()).toEqual(['note:a']);
  });

  it('remembers where in a folder the note was opened', () => {
    followRoute({ name: 'notes', note: 'a', folder: 'f1' });
    expect(tabsState().tabs[0].href).toContain('folder=f1');
  });
});

describe('closing and reopening', () => {
  const three = () => { followRoute(note('a')); openInNewTabNext(); followRoute(note('b')); openInNewTabNext(); followRoute(note('c')); };

  it('closing the shown tab leads to its neighbour, the right one first', () => {
    three();
    followRoute(note('b'));
    expect(closeTab('note:b')).toBe(tabFor(note('c'))!.href);
    expect(keys()).toEqual(['note:a', 'note:c']);
    expect(closeTab('note:c')).toBe(tabFor(note('a'))!.href);
    expect(closeTab('note:a')).toBe('#/');
    expect(keys()).toEqual([]);
  });

  it('closing another tab changes nothing about what is shown', () => {
    three();
    expect(closeTab('note:a')).toBeNull();
    expect(tabsState().active).toBe('note:c');
  });

  it('reopens the closed tabs last first, up to 20', () => {
    three();
    closeTab('note:c');
    closeTab('note:b');
    expect(reopenTab()).toBe(tabFor(note('b'))!.href);
    expect(reopenTab()).toBe(tabFor(note('c'))!.href);
    expect(reopenTab()).toBeNull();
    expect(keys()).toEqual(['note:a', 'note:b', 'note:c']);

    resetTabs();
    for (let i = 0; i < 30; i++) { openInNewTabNext(); followRoute(note(`n${i}`)); }
    for (let i = 0; i < 30; i++) closeTab(`note:n${i}`);
    expect(tabsState().closed).toHaveLength(20);
  });

  it('does not open a tab twice when reopening one that is open again', () => {
    followRoute(note('a'));
    closeTab('note:a');
    followRoute(note('a'));
    expect(reopenTab()).toBe(tabFor(note('a'))!.href);
    expect(keys()).toEqual(['note:a']);
  });
});

describe('moving between tabs and keeping them tidy', () => {
  it('cycles with wrapping in both directions', () => {
    followRoute(note('a')); openInNewTabNext(); followRoute(note('b')); openInNewTabNext(); followRoute(note('c'));
    expect(neighbourTab(1)).toBe(tabFor(note('a'))!.href);
    expect(neighbourTab(-1)).toBe(tabFor(note('b'))!.href);
    resetTabs();
    expect(neighbourTab(1)).toBeNull();
  });

  it('forgets notes that no longer exist, also among the closed ones', () => {
    followRoute(note('a')); openInNewTabNext(); followRoute(note('b')); closeTab('note:b');
    dropMissingNotes(new Set(['a']));
    expect(keys()).toEqual(['note:a']);
    expect(reopenTab()).toBeNull();
  });

  it('moves a tab before another', () => {
    followRoute(note('a')); openInNewTabNext(); followRoute(note('b')); openInNewTabNext(); followRoute(note('c'));
    moveTab('note:c', 'note:a');
    expect(keys()).toEqual(['note:c', 'note:a', 'note:b']);
    moveTab('note:c', null);
    expect(keys()).toEqual(['note:a', 'note:b', 'note:c']);
  });
});
