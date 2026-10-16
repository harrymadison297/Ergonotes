// Shortcuts as text: read from key events, written for people, compared.
import { describe, expect, it } from 'vitest';
import { chordOf, conflicts, formatBinding, needsModifier, normalizeBinding, reasonNotAllowed, type KeyLike } from '../src/state/keymap.ts';

const ev = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, code: undefined, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('reading a key event', () => {
  it('names the chord with the modifiers in one order, letters in lower case', () => {
    expect(chordOf(ev('K', { ctrlKey: true }))).toBe('Mod+k');
    expect(chordOf(ev('s', { ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+s');
    expect(chordOf(ev('d', { ctrlKey: true, altKey: true }))).toBe('Mod+Alt+d');
    expect(chordOf(ev('k', { metaKey: true }))).toBe('Mod+k');
    expect(chordOf(ev('g'))).toBe('g');
    expect(chordOf(ev('F2'))).toBe('F2');
    expect(chordOf(ev('Delete'))).toBe('Delete');
  });
  it('reads punctuation by where the key is, so Shift and layouts do not rename it', () => {
    expect(chordOf(ev('|', { code: 'Backslash', ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+\\');
    expect(chordOf(ev('+', { code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+=');
    expect(chordOf(ev('=', { code: 'Equal', ctrlKey: true }))).toBe('Mod+=');
    expect(chordOf(ev('?', { code: 'Slash', shiftKey: true }))).toBe('Shift+/');
    expect(chordOf(ev(',', { code: 'Comma', ctrlKey: true }))).toBe('Mod+,');
  });
  it('is nothing while only a modifier is down', () => {
    expect(chordOf(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(chordOf(ev('Shift', { shiftKey: true }))).toBeNull();
  });
});

describe('writing and comparing bindings', () => {
  it('puts what a person typed in the form events are compared in', () => {
    expect(normalizeBinding('Ctrl+Shift+S')).toBe('Mod+Shift+s');
    expect(normalizeBinding('cmd+alt+D')).toBe('Mod+Alt+d');
    expect(normalizeBinding('G  H')).toBe('g h');
  });
  it('shows them for the platform', () => {
    expect(formatBinding('Mod+Shift+\\', false)).toBe('Ctrl+Shift+\\');
    expect(formatBinding('Mod+k', false)).toBe('Ctrl+K');
    expect(formatBinding('Mod+Shift+\\', true)).toBe('⇧⌘\\');
    expect(formatBinding('g h', false)).toBe('G then H');
  });
  it('knows what can be pressed while typing, and what cannot be a shortcut at all', () => {
    expect(needsModifier('Mod+k')).toBe(true);
    expect(needsModifier('g h')).toBe(false);
    expect(reasonNotAllowed('Mod+k')).toBeNull();
    expect(reasonNotAllowed('g h')).toBeNull();
    expect(reasonNotAllowed('F2')).toBeNull();
    expect(reasonNotAllowed('a')).toMatch(/Ctrl or Alt/);
    expect(reasonNotAllowed('Mod+g h')).toMatch(/two-key/);
  });
  it('finds the commands that would fight over the same keys', () => {
    const bound = [{ id: 'a', keys: ['Mod+k'] }, { id: 'b', keys: ['g h'] }, { id: 'c', keys: ['g'] }, { id: 'd', keys: [] }];
    expect(conflicts('Ctrl+K', bound)).toEqual(['a']);
    expect(conflicts('Mod+k', bound, 'a')).toEqual([]);
    expect(conflicts('g', bound)).toEqual(['b', 'c']); // "g" alone would start "g h"
    expect(conflicts('g h', bound)).toEqual(['b', 'c']); // and "g h" cannot be typed when "g" runs something
    expect(conflicts('Mod+j', bound)).toEqual([]);
  });
});
