import { useState, type DragEvent } from 'react';
import { useApp } from './app';
import { hasOsFiles, readDropped } from './dropImport';

/** Items (notes, folders) are dragged inside the app. Carried as this type so Firefox starts the drag; the id is read from `current`. */
const ITEM_MIME = 'application/x-ergo-item';

export interface Dragged { id: string; type: 'note' | 'folder' }
let current: Dragged | null = null;

export function dragSource(item: Dragged) {
  return {
    draggable: true as const,
    onDragStart: (e: DragEvent) => {
      current = item;
      e.dataTransfer.setData(ITEM_MIME, item.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => { current = null; },
  };
}

export interface DropState { key: string | null; set: (k: string | null) => void }

/** Handlers that make an element accept a dragged item. `key` identifies it in the shared hover state. */
export function dropZone(key: string, state: DropState, onItem: (d: Dragged) => void, ok?: (d: Dragged) => boolean, onFiles?: (dt: DataTransfer) => void) {
  return {
    onDragOver: (e: DragEvent) => {
      const d = current;
      if (!d && onFiles && hasOsFiles(e.dataTransfer)) {
        // files or folders from the computer, not one of the app's own items
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (state.key !== key) state.set(key);
        return;
      }
      if (!d || (ok && !ok(d))) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (state.key !== key) state.set(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) { if (state.key === key) state.set(null); }
    },
    onDrop: (e: DragEvent) => {
      const d = current;
      if (!d && onFiles && hasOsFiles(e.dataTransfer)) {
        e.preventDefault();
        e.stopPropagation();
        state.set(null);
        onFiles(e.dataTransfer); // read at once: a drop's data is gone when the handler returns
        return;
      }
      if (!d || (ok && !ok(d))) return;
      e.preventDefault();
      e.stopPropagation();
      state.set(null);
      current = null;
      onItem(d);
    },
  };
}

/** Which drop target is under the pointer; one per surface. */
export function useDropState(): DropState {
  const [key, set] = useState<string | null>(null);
  return { key, set };
}

/** The handler every drop target uses to move a dragged item into a folder (null = top level). */
export function useMoveInto() {
  const app = useApp();
  return (target: string | null) => async (d: Dragged) => {
    if (d.id === target || (app.byId.get(d.id)?.parent ?? null) === target) return;
    await app.run(app.api.move(d.id, target));
    await app.refresh();
  };
}

/** Takes what was dropped from the computer into a folder (null: the Vault's default place), folders and attachments with it. */
export function useImportInto() {
  const app = useApp();
  return (target: string | null) => (dt: DataTransfer) => {
    const read = readDropped(dt); // started inside the drop event
    void (async () => {
      const files = await read;
      if (!files.length) return;
      const r = await app.run(app.api.importFiles(files, target));
      if (!r) return;
      await app.refresh();
      const parts = [r.notes && `${r.notes} note${r.notes === 1 ? '' : 's'}`, r.files && `${r.files} file${r.files === 1 ? '' : 's'}`, r.folders && `${r.folders} new folder${r.folders === 1 ? '' : 's'}`].filter(Boolean);
      app.toast(parts.length ? `Imported ${parts.join(', ')}${r.skipped ? ` (${r.skipped} skipped)` : ''}` : `Nothing could be imported (${r.skipped} skipped: only notes and files a note can hold are taken)`);
    })();
  };
}
