import type { DragEvent } from 'react';

/** Items (notes, folders) are dragged inside the app with this type; files from the OS use the browser's own. */
export const ITEM_MIME = 'application/x-ergo-item';

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
