// The editor's api for the Scratchpad draft (see scratch.ts): a note that exists only in this Device's memory and storage.
import type { ItemSummary, NoteDoc, VaultApi } from '@ergonotes/core';
import { SCRATCH_ID, heldPath, type Draft } from './scratch';

const STILL = new Date(0).toISOString();

export function scratchSummary(): ItemSummary {
  return {
    id: SCRATCH_ID, type: 'note', title: 'Scratchpad', parent: null, tags: [], created: STILL, updated: STILL, trashed: null, inTrash: false, pinned: false,
    template: false, private: false, role: null, filePath: '', snippet: '', thumb: null, conflicted: false, tasksOpen: 0, tasksDone: 0, nextReminder: null, childCount: 0,
  };
}

const unique = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function scratchApi(vault: VaultApi, draft: { current: Draft }, persist: () => void): VaultApi {
  const own: Partial<VaultApi> = {
    getNote: async id => (id === SCRATCH_ID ? ({ ...scratchSummary(), body: draft.current.body, path: [], backlinks: [], links: [], linkMap: {}, fileMap: {} } as NoteDoc) : null),
    saveNote: async (_id, patch) => {
      if (patch.body !== undefined) { draft.current.body = patch.body; persist(); }
      return scratchSummary();
    },
    flush: async () => undefined,
    getFileByPath: async path => draft.current.files[path] ?? null,
    getFile: async () => null,
    addFile: async f => {
      const path = heldPath(f.name, unique());
      draft.current.files[path] = { name: f.name, mime: f.mime, data: f.data };
      persist();
      return { id: '', path };
    },
  };
  return new Proxy(vault, { get: (target, key: string) => (key in own ? (own as Record<string, unknown>)[key] : (target as unknown as Record<string, unknown>)[key]) });
}
