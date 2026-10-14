// Node-only pieces: file persistence for the Server peer and a plain-folder Store.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Commit } from './graph.ts';
import type { Persist, PersistedState } from './persist.ts';
import type { Store, StoredKey } from './store.ts';

async function writeAtomic(path: string, data: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data);
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

  async putCommit(c: Commit, pushed: boolean) { await writeAtomic(this.path(c), JSON.stringify({ c, pushed })); }

  async removeCommits(cs: Commit[]) { for (const c of cs) await rm(this.path(c), { force: true }); }

  async markPushed(cs: Commit[]) {
    for (const c of cs) {
      try {
        const o = JSON.parse(await readFile(this.path(c), 'utf8')) as { c: Commit; pushed: boolean };
        if (!o.pushed) await writeAtomic(this.path(c), JSON.stringify({ c: o.c, pushed: true }));
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
    await this.queue(() => writeAtomic(join(this.dir, 'heads.json'), JSON.stringify(this.heads)));
  }
  async setMeta(key: string, value: unknown) {
    await this.ensure();
    if (value === undefined) delete this.meta[key]; else this.meta[key] = value;
    await this.queue(() => writeAtomic(join(this.dir, 'meta.json'), JSON.stringify(this.meta)));
  }
}

/** A Store that is a plain folder: a mounted share, a Syncthing/Dropbox folder, or local disk. */
export class FolderStore implements Store {
  private root: string;
  constructor(root: string) { this.root = root; }
  private p(key: string) {
    if (key.includes('..')) throw new Error('bad key');
    return join(this.root, key);
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
