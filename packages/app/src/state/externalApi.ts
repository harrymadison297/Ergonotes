// A file outside the vault, shown in the note editor (CONTEXT.md, External file). The editor talks to a VaultApi; this is one
// that reads and writes the one file. Nothing is added to the file: no id, no frontmatter, the head is put back as it was.
import { splitDoc, type ItemSummary, type NoteDoc, type VaultApi } from '@ergonotes/core';
import { extRead, extReadBeside, extWrite, extWriteBeside, type ExternalText } from '../backend/external';

export const EXTERNAL_PREFIX = 'ext:';

/** The text before the body (a frontmatter block, as written, or nothing) and the body. */
export function splitHead(text: string): { head: string; body: string } {
  const { body } = splitDoc(text);
  if (body === text || !text.endsWith(body)) return { head: '', body: text };
  return { head: text.slice(0, text.length - body.length), body };
}

/** The path of `file` inside the vault folder `folder` (`Projects/A.md`), or null when it is somewhere else. Windows paths compare without case. */
export function vaultRelative(file: string, folder: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const windows = /^[A-Za-z]:|\\/.test(folder);
  const f = norm(file), d = norm(folder);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (f.length <= d.length + 1 || !same(f.slice(0, d.length), d) || f[d.length] !== '/') return null;
  const rel = f.slice(d.length + 1);
  // the hidden folders belong to the app (history, the trash): such a file is not a note to open
  return rel.split('/').some(seg => seg.startsWith('.')) ? null : rel;
}

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const titleOf = (p: string): string => baseName(p).replace(/\.(md|markdown|mdown|txt)$/i, '');

/** What the editor needs to know of the file now, kept up to date by every save. */
export interface ExternalState {
  path: string;
  head: string;
  bom: boolean;
  crlf: boolean;
  /** the modification time this editor last saw; a save is refused when the file has been changed since */
  mtime: number;
  /** the person chose to keep their version over a change made elsewhere */
  force: boolean;
}

export function externalState(path: string, f: ExternalText): ExternalState {
  return { path, head: splitHead(f.text).head, bom: f.bom, crlf: f.crlf, mtime: f.mtime, force: false };
}

const iso = (ms: number) => new Date(ms).toISOString();

export function externalSummary(st: ExternalState): ItemSummary {
  return {
    id: EXTERNAL_PREFIX + st.path, type: 'note', title: titleOf(st.path), parent: null, tags: [], created: iso(st.mtime), updated: iso(st.mtime),
    trashed: null, inTrash: false, pinned: false, template: false, private: false, role: null, filePath: baseName(st.path), snippet: '', thumb: null,
    conflicted: false, tasksOpen: 0, tasksDone: 0, nextReminder: null, childCount: 0,
  };
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4', pdf: 'application/pdf' };
const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/**
 * The editor's api for one external file. Everything that is about the vault (tags, pins, history, search...) falls
 * through to the vault's own api and is not offered by the editor for such a file.
 */
export function externalApi(st: ExternalState, vault: VaultApi, text: ExternalText): VaultApi {
  const doc = async (): Promise<NoteDoc> => {
    const t = st.mtime === text.mtime ? text.text : (await extRead(st.path)).text;
    return { ...externalSummary(st), body: splitHead(t).body, path: [], backlinks: [], links: [], linkMap: {}, fileMap: {} };
  };
  const own: Partial<VaultApi> = {
    getNote: async id => (id === EXTERNAL_PREFIX + st.path ? doc() : null),
    saveNote: async (_id, patch) => {
      if (patch.body !== undefined) {
        st.mtime = await extWrite(st.path, st.head + patch.body, { bom: st.bom, crlf: st.crlf, expected: st.mtime, force: st.force });
        st.force = false;
      }
      return externalSummary(st);
    },
    flush: async () => undefined,
    getFileByPath: async rel => {
      const bytes = await extReadBeside(st.path, rel);
      if (!bytes) return null;
      const name = baseName(rel);
      return { name, mime: MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream', data: toB64(bytes) };
    },
    getFile: async () => null,
    // a picture pasted into the document lands beside it, in `attachments/`
    addFile: async f => {
      const name = f.name.replace(/[\\/:*?"<>|]/g, '_');
      const rel = `attachments/${Date.now().toString(36)}-${name}`;
      await extWriteBeside(st.path, rel, fromB64(f.data));
      return { id: '', path: rel };
    },
    exportNote: async (_id, format) => {
      const t = await extRead(st.path);
      if (format === 'html') throw new Error('Web page export is available for notes in the vault.');
      return { filename: baseName(st.path), mime: 'text/markdown', content: t.text };
    },
  };
  return new Proxy(vault, { get: (target, key: string) => (key in own ? (own as Record<string, unknown>)[key] : (target as unknown as Record<string, unknown>)[key]) });
}
