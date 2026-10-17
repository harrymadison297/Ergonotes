// What a key press means: the part of the keyboard that is decided, not drawn. Reads chords (see keymap.ts) and the
// keys each Command has now (see commands.tsx); knows nothing of React or the page.
import { needsModifier, type Bound } from './keymap';

/** How long the second key of a two-key shortcut ("g" then "h") may take. */
export const SEQUENCE_MS = 900;

/** The Command whose keys include this chord, or null. */
export const commandForChord = (chord: string | null, bound: Bound[]): string | null =>
  (chord && bound.find(b => b.keys.includes(chord))?.id) || null;

/**
 * The window-wide shortcuts: one chord, or two in turn. `press` is told when it happened, so the timing of a two-key
 * shortcut is a fact about the arguments and not about a timer.
 */
export class ShortcutMatcher {
  private first: string | null = null;
  private at = 0;

  /** The Command this key press runs, or null. `typing`: the key went to a text field, where a bare key is text. */
  press(chord: string, typing: boolean, bound: Bound[], now: number): string | null {
    const waiting = this.first !== null && now - this.at <= SEQUENCE_MS ? this.first : null;
    this.first = null;
    // the second key of a two-key shortcut
    if (waiting) {
      const hit = commandForChord(`${waiting} ${chord}`, bound);
      if (hit) return hit;
    }
    // a bare key is text while typing; only a chord with Ctrl or Alt (or a function key) is a shortcut there
    if (typing && !needsModifier(chord) && !/^F\d/.test(chord)) return null;
    const hit = commandForChord(chord, bound);
    if (hit) return hit;
    // the first key of a two-key shortcut (never while typing)
    if (!typing && bound.some(b => b.keys.some(k => k.startsWith(`${chord} `)))) { this.first = chord; this.at = now; }
    return null;
  }
}
