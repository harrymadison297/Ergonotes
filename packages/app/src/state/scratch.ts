// The Scratchpad's draft (CONTEXT.md, Scratchpad): kept on this Device, outside the Vault, until it is sent. Pictures and files
// dropped on it are held here too, and only reach `attachments/` of the Vault when the draft becomes a Note.
import { dirname, encodeDest, relativePath } from '@ergonotes/core';

export interface HeldFile { name: string; mime: string; data: string }
export interface Draft { body: string; files: Record<string, HeldFile> }

export const SCRATCH_ID = 'scratch';
/** where a held file is said to be, inside the draft */
export const HELD_DIR = 'scratch-files';

export const emptyDraft = (): Draft => ({ body: '', files: {} });

const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file';
/** A path inside the draft for a file that was dropped on it, written in the draft as `scratch-files/<key>-<name>`. */
export function heldPath(name: string, key: string): string { return `${HELD_DIR}/${key}-${safe(name)}`; }

/** The held files a body still mentions (one that was deleted from the text is dropped). */
export function mentioned(body: string, files: Draft['files']): string[] {
  return Object.keys(files).filter(p => body.includes(p));
}

/**
 * The body as it is written once it is a Note in `noteDir` (a Vault folder, `Inbox`): every held file mentioned in it is replaced by the
 * path it was given in the Vault (`attachments/…`), written relative to the note as the editor writes links.
 */
export function bodyForNote(body: string, vaultPaths: Record<string, string>, noteDir: string): string {
  let out = body;
  for (const [held, vault] of Object.entries(vaultPaths)) out = out.split(held).join(encodeDest(relativePath(noteDir, vault)));
  return out;
}

// ---- storage on this Device (IndexedDB: pictures do not fit in localStorage)
const DB = 'ergo-scratch';
const KEY = 'draft';
function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
export async function loadDraft(): Promise<Draft> {
  try {
    const db = await open();
    const v = await new Promise<unknown>((ok, fail) => { const q = db.transaction('kv').objectStore('kv').get(KEY); q.onsuccess = () => ok(q.result); q.onerror = () => fail(q.error); });
    db.close();
    const d = v as Partial<Draft> | undefined;
    return { body: typeof d?.body === 'string' ? d.body : '', files: d?.files && typeof d.files === 'object' ? d.files : {} };
  } catch { return emptyDraft(); }
}
export async function storeDraft(d: Draft): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((ok, fail) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(d, KEY); tx.oncomplete = () => ok(); tx.onerror = () => fail(tx.error); });
    db.close();
  } catch { /* a private window keeps the draft until it closes */ }
}

export { dirname };
