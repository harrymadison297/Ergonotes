// The Item clipboard: Notes and Folders set aside by Copy or Cut, to be put somewhere by Paste. Inside the app only;
// the editor's text clipboard is a different thing.
import { useSyncExternalStore } from 'react';
import type { ItemSummary } from '@ergonotes/core';
import { useApp } from './app';

export interface ItemClip { mode: 'copy' | 'cut'; ids: string[] }

let clip: ItemClip | null = null;
const listeners = new Set<() => void>();
const set = (c: ItemClip | null) => { clip = c; for (const l of listeners) l(); };

export const useItemClip = (): ItemClip | null => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => clip);

const count = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/** What Copy, Cut, Paste and Duplicate do to items; the same for a key, a menu entry and a button. */
export function useItemOps() {
  const app = useApp();

  const copy = (ids: string[]) => { if (!ids.length) return; set({ mode: 'copy', ids }); app.toast(`Copied ${count(ids.length)}`); };
  const cut = (ids: string[]) => { if (!ids.length) return; set({ mode: 'cut', ids }); app.toast(`Cut ${count(ids.length)}: paste to move`); };

  const duplicate = async (items: ItemSummary[]) => {
    let last: ItemSummary | null = null;
    for (const it of items) last = (await app.run(app.api.duplicate(it.id))) ?? last;
    if (!last) return;
    await app.refresh();
    app.toast(items.length === 1 ? `Duplicated “${items[0].title}”` : `Duplicated ${count(items.length)}`);
  };

  /** Put the clipboard in `target` (a folder id; null: the top of the Vault). A copy puts a copy there, a cut moves. */
  const paste = async (target: string | null): Promise<void> => {
    const c = clip;
    if (!c) return;
    let done = 0;
    for (const id of c.ids) {
      const it = app.byId.get(id);
      if (!it || it.inTrash) continue;
      if (c.mode === 'cut') {
        if ((it.parent ?? null) === target) continue;
        if (await app.run(app.api.move(id, target).then(() => true))) done++;
      } else {
        if (await app.run(app.api.copy(id, target))) done++;
      }
    }
    if (c.mode === 'cut') set(null);
    await app.refresh();
    app.toast(done ? `${c.mode === 'cut' ? 'Moved' : 'Pasted'} ${count(done)}` : 'Nothing to paste here');
  };

  const trash = async (items: ItemSummary[]) => { for (const it of items) await app.trashItem(it.id); };

  return { copy, cut, paste, duplicate, trash };
}
