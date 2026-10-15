// What the open note editor lends to the right sidebar: its headings (contents tab) and its text (assistant tab).
import { useSyncExternalStore } from 'react';

export interface OutlineHeading { text: string; level: number }
export interface Outline { noteId: string; locked: boolean; headings: OutlineHeading[]; active: number }
export interface EditorFns {
  goto(index: number): void;
  /** the note as it is on screen, unsaved typing included */
  live(): { title: string; body: string };
  /** put text into the open note through the editor, so it saves like typing does */
  apply(patch: { title?: string; body?: string }): void;
}

let data: Outline | null = null;
let fns: EditorFns | null = null;
const listeners = new Set<() => void>();
const same = (a: Outline | null, b: Outline | null) =>
  a === b || (!!a && !!b && a.noteId === b.noteId && a.locked === b.locked && a.active === b.active && JSON.stringify(a.headings) === JSON.stringify(b.headings));

export const editorBridge = {
  /** called after every render of the editor; subscribers are only told when something visible changed */
  set(next: { outline: Outline; fns: EditorFns } | null) {
    fns = next?.fns ?? null;
    const o = next?.outline ?? null;
    if (same(data, o)) return;
    data = o;
    listeners.forEach(l => l());
  },
  fns: (): EditorFns | null => fns,
};

export function useOutline(): Outline | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => data);
}
