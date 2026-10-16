// Files and folders dropped from the computer onto the app: read into the shape `importFiles` takes.
import { toB64, type ImportFile } from '@ergonotes/core';

/** The parts of the File System Entry API this needs (what `webkitGetAsEntry` returns). */
export interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?(ok: (f: File) => void, fail: (e: unknown) => void): void;
  createReader?(): { readEntries(ok: (es: DroppedEntry[]) => void, fail: (e: unknown) => void): void };
}

const MAX_ENTRIES = 5000;

/** True while something from outside the app (not one of its own items) is being dragged. */
export const hasOsFiles = (dt: DataTransfer | null | undefined): boolean => !!dt && Array.from(dt.types ?? []).includes('Files');

/** A directory's entries come in batches: read until it says there are no more. */
async function children(dir: DroppedEntry): Promise<DroppedEntry[]> {
  const reader = dir.createReader?.();
  if (!reader) return [];
  const all: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

/** Every file under the entries, with its path relative to where it was dropped (`Folder/sub/a.md`). */
export async function walkEntries(entries: DroppedEntry[], read: (f: File) => Promise<ImportFile>, limit = MAX_ENTRIES): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  const visit = async (e: DroppedEntry, prefix: string): Promise<void> => {
    if (out.length >= limit) return;
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, fail) => e.file!(ok, fail));
      out.push(await read(f).then(r => ({ ...r, path: prefix + e.name })));
    } else if (e.isDirectory) {
      for (const c of await children(e)) await visit(c, `${prefix}${e.name}/`);
    }
  };
  for (const e of entries) await visit(e, '');
  return out;
}

const TEXT = /\.(md|markdown|txt)$/i;

/** One file as an ImportFile: text for Markdown, bytes for the rest. */
export async function readFile(f: File): Promise<ImportFile> {
  return TEXT.test(f.name) ? { path: f.name, content: await f.text() } : { path: f.name, data: toB64(new Uint8Array(await f.arrayBuffer())) };
}

/** What was dropped, folders walked through. Falls back to the plain file list where entries are not offered. */
export async function readDropped(dt: DataTransfer): Promise<ImportFile[]> {
  const entries: DroppedEntry[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    const e = (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  if (entries.length) return walkEntries(entries, readFile);
  return Promise.all(Array.from(dt.files ?? []).map(async f => {
    const r = await readFile(f);
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    return rel ? { ...r, path: rel } : r;
  }));
}
