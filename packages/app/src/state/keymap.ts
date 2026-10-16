// Keyboard shortcuts as text ("Mod+K", "Mod+Shift+\", "g h"): read from a key event, compared, shown, and checked for
// two commands wanting the same keys. Nothing here knows what a shortcut does (see commands.tsx).
//
// A *chord* is modifiers plus one key: `Mod+Alt+Shift+<key>`. Mod is Ctrl (Cmd on a Mac, where Ctrl also counts so that
// a shortcut written for Windows keeps working). A *binding* is one chord, or two chords typed in turn with a space
// between them ("g h"); the second kind has no modifiers.

const NAMED = new Set(['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);
/** Punctuation is read from the key's place on the keyboard, so Shift or a layout does not change what a shortcut is called. */
const BY_CODE: Record<string, string> = {
  Backslash: '\\', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
};

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface KeyLike { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

/** The key part of an event, or null for a modifier pressed alone. */
function keyOf(e: KeyLike): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'OS', 'Dead', 'Unidentified'].includes(e.key)) return null;
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];
  if (/^[a-z0-9]$/i.test(e.key)) return e.key.toLowerCase();
  if (e.code && /^Numpad(\d)$/.test(e.code)) return e.code.slice(-1);
  if (NAMED.has(e.key) || /^F\d{1,2}$/.test(e.key)) return e.key === ' ' ? 'Space' : e.key;
  return e.key.length === 1 ? e.key : null;
}

/** The chord an event is, e.g. `Mod+Shift+s`; null while only modifiers are down. */
export function chordOf(e: KeyLike): string | null {
  const k = keyOf(e);
  if (!k) return null;
  return [(e.ctrlKey || e.metaKey) && 'Mod', e.altKey && 'Alt', e.shiftKey && 'Shift', k].filter(Boolean).join('+');
}

/** A chord as written by a person or an older file, put in the one form events are compared in. */
export function normalizeChord(s: string): string {
  const parts = s.trim().split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map(p => p.toLowerCase()).map(p => (p === 'ctrl' || p === 'cmd' || p === 'meta' || p === 'control' ? 'mod' : p)));
  const k = key.length === 1 ? key.toLowerCase() : key;
  return [mods.has('mod') && 'Mod', mods.has('alt') && 'Alt', mods.has('shift') && 'Shift', k].filter(Boolean).join('+');
}

export const normalizeBinding = (s: string): string => s.trim().split(/\s+/).map(normalizeChord).join(' ');

/** Words for a person: `Ctrl+Shift+\` (`⌘⇧\` on a Mac). */
export function formatBinding(binding: string, mac = isMac()): string {
  const one = (c: string) => {
    const parts = c.split('+');
    const k = parts.pop()!;
    const key = k.length === 1 ? k.toUpperCase() : k === 'Space' ? 'Space' : k.replace('Arrow', '');
    if (mac) return `${parts.includes('Alt') ? '⌥' : ''}${parts.includes('Shift') ? '⇧' : ''}${parts.includes('Mod') ? '⌘' : ''}${key}`;
    return [...parts.map(p => (p === 'Mod' ? 'Ctrl' : p)), key].join('+');
  };
  return binding.split(' ').map(one).join(' then ');
}

/** A chord with a modifier can be pressed while typing; a bare key cannot (it would be text). */
export const needsModifier = (binding: string): boolean => /^(Mod|Alt)\+/.test(binding);
export const isSequence = (binding: string): boolean => binding.includes(' ');
/** Bare keys that may not be a shortcut: they are how text is written. */
export function reasonNotAllowed(binding: string): string | null {
  const first = binding.split(' ')[0];
  const bare = !/^(Mod|Alt)\+/.test(first);
  if (isSequence(binding) && binding.split(' ').some(c => /^(Mod|Alt|Shift)\+/.test(c))) return 'A two-key shortcut cannot use Ctrl, Alt or Shift';
  if (bare && !isSequence(binding) && !/^(F\d{1,2}|Delete|Insert|Escape)$/.test(first) && !/^Shift\+\//.test(first)) return 'Add Ctrl or Alt, or press two keys one after the other';
  return null;
}

export interface Bound { id: string; keys: string[] }
/** The commands whose keys are also `binding` (or start with it, or are the start of it): they could not both work. */
export function conflicts(binding: string, bound: Bound[], exceptId?: string): string[] {
  const b = normalizeBinding(binding);
  return bound.filter(c => c.id !== exceptId && c.keys.some(k => {
    const n = normalizeBinding(k);
    return n === b || n.startsWith(`${b} `) || b.startsWith(`${n} `);
  })).map(c => c.id);
}
