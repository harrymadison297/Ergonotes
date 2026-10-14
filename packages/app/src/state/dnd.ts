import { useState, type DragEvent } from 'react';
import { useApp } from './app';

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
export function dropZone(key: string, state: DropState, onItem: (d: Dragged) => void, ok?: (d: Dragged) => boolean) {
  return {
    onDragOver: (e: DragEvent) => {
      const d = current;
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
