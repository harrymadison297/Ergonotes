// Node-only pieces: file persistence for the Server peer and a plain-folder Store.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Commit } from './graph.ts';
import type { Persist, PersistedState } from './persist.ts';
import type { Store, StoredKey } from './store.ts';
import type { FsEntry, FsStat, LocalMeta, VaultFs } from './vaultfs.ts';

/** Write via a temporary file. `priv` keeps the result readable by this user only (the replica holds secrets). */
async function writeAtomic(path: string, data: string | Uint8Array, priv = false) {
  await mkdir(dirname(path), priv ? { recursive: true, mode: 0o700 } : { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, priv ? { mode: 0o600 } : undefined);
  await rename(tmp, path);
}

async function walk(dir: string, rel = ''): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(join(dir, rel), { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else if (!e.name.endsWith('.tmp')) out.push(r);
  }
  return out;
}

/** Replica persistence as JSON files: commits/<item>/<id>.json, heads.json, meta.json. */
export class FilePersist implements Persist {
  private dir: string;
  private heads: Record<string, string> = {};
  private meta: Record<string, unknown> = {};
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  constructor(dir: string) { this.dir = dir; }

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(join(this.dir, name), 'utf8')) as T; } catch { return fallback; }
  }
  private async ensure() {
    if (this.loaded) return;
    this.heads = await this.readJson('heads.json', {});
    this.meta = await this.readJson('meta.json', {});
    this.loaded = true;
  }
  private path(c: Pick<Commit, 'item' | 'id'>) { return join(this.dir, 'commits', c.item, `${c.id}.json`); }

  async loadMeta() { await this.ensure(); return structuredClone(this.meta); }

  async load(): Promise<PersistedState> {
    await this.ensure();
    const commits: Commit[] = [];
    const pushed: string[] = [];
    for (const f of await walk(join(this.dir, 'commits'))) {
      try {
        const o = JSON.parse(await readFile(join(this.dir, 'commits', f), 'utf8')) as { c: Commit; pushed: boolean };
        commits.push(o.c);
        if (o.pushed) pushed.push(o.c.id);
      } catch { /* skip a torn file */ }
    }
    return { commits, pushed, heads: { ...this.heads }, meta: structuredClone(this.meta) };
  }

  async putCommit(c: Commit, pushed: boolean) { await writeAtomic(this.path(c), JSON.stringify({ c, pushed }), true); }

  async removeCommits(cs: Commit[]) { for (const c of cs) await rm(this.path(c), { force: true }); }

  async markPushed(cs: Commit[]) {
    for (const c of cs) {
      try {
        const o = JSON.parse(await readFile(this.path(c), 'utf8')) as { c: Commit; pushed: boolean };
        if (!o.pushed) await writeAtomic(this.path(c), JSON.stringify({ c: o.c, pushed: true }), true);
      } catch { /* the commit was replaced or removed meanwhile */ }
    }
  }

  private queue(fn: () => Promise<void>) {
    this.writing = this.writing.then(fn, fn);
    return this.writing;
  }
  async setHead(item: string, id: string) {
    await this.ensure();
    this.heads[item] = id;
    await this.queue(() => writeAtomic(join(this.dir, 'heads.json'), JSON.stringify(this.heads), true));
  }
  async close() { await this.writing; }
  async setMeta(key: string, value: unknown) {
    await this.ensure();
    if (value === undefined) delete this.meta[key]; else this.meta[key] = value;
    await this.queue(() => writeAtomic(join(this.dir, 'meta.json'), JSON.stringify(this.meta), true));
  }
}

/** A Store that is a plain folder: a mounted share, a Syncthing/Dropbox folder, or local disk. */
export class FolderStore implements Store {
  private root: string;
  constructor(root: string) { this.root = root; }
  private p(key: string) {
    const base = resolve(this.root);
    const full = resolve(base, key);
    if (full !== base && !full.startsWith(base + sep)) throw new Error('bad key');
    return full;
  }
  async put(key: string, data: Uint8Array) { await writeAtomic(this.p(key), data); }
  async get(key: string) {
    try { return new Uint8Array(await readFile(this.p(key))); } catch { return null; }
  }
  async delete(key: string) { await rm(this.p(key), { force: true }); }
  async list(prefix: string, startAfter = ''): Promise<StoredKey[]> {
    const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
    const out: StoredKey[] = [];
    for (const rel of await walk(this.root, dir)) {
      if (!rel.startsWith(prefix) || rel <= startAfter) continue;
      const st = await stat(join(this.root, rel)).catch(() => null);
      out.push({ key: rel, lastModified: st ? Math.floor(st.mtimeMs) : 0 });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}

/** The vault folder on a real disk. Paths are relative to `root`; nothing outside it can be reached. */
export class NodeFs implements VaultFs {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private p(rel: string) {
    const full = resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new Error('bad path');
    return full;
  }
  async readdir(dir: string): Promise<FsEntry[]> {
    const base = this.p(dir);
    let ents: import('node:fs').Dirent[];
    try { ents = await readdir(base, { withFileTypes: true }); } catch { return []; }
    const out: FsEntry[] = [];
    for (const e of ents) {
      if (e.name.endsWith('.tmp') && /\.\d+\.[a-z0-9]+\.tmp$/.test(e.name)) continue;
      const isDir = e.isDirectory() || (e.isSymbolicLink() && (await stat(join(base, e.name)).catch(() => null))?.isDirectory() === true);
      if (isDir) { out.push({ name: e.name, kind: 'dir', size: 0, mtime: 0 }); continue; }
      const st = await stat(join(base, e.name)).catch(() => null);
      if (st?.isFile()) out.push({ name: e.name, kind: 'file', size: st.size, mtime: Math.floor(st.mtimeMs) });
    }
    return out;
  }
  async read(path: string) { try { return new Uint8Array(await readFile(this.p(path))); } catch { return null; } }
  async write(path: string, data: Uint8Array | string, o: { private?: boolean } = {}) { await writeAtomic(this.p(path), data, o.private); }
  async remove(path: string) { await rm(this.p(path), { recursive: true, force: true }); }
  async rename(from: string, to: string) {
    await mkdir(dirname(this.p(to)), { recursive: true });
    await rename(this.p(from), this.p(to));
  }
  async mkdir(path: string) { await mkdir(this.p(path), { recursive: true }); }
  async stat(path: string): Promise<FsStat | null> {
    const st = await stat(this.p(path)).catch(() => null);
    if (!st) return null;
    return { kind: st.isDirectory() ? 'dir' : 'file', size: st.size, mtime: Math.floor(st.mtimeMs) };
  }
}

/** Device-local metadata as one private JSON file outside the vault folder. */
export class FileLocalMeta implements LocalMeta {
  private path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<Record<string, unknown>> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>; } catch { return {}; }
  }
  async save(meta: Record<string, unknown>): Promise<void> { await writeAtomic(this.path, JSON.stringify(meta), true); }
}
