// The folder a Vault lives in, as the core sees it (ADR 0010). Node, the Tauri shells and the tests each supply one.
import type { Sealer } from './crypto.ts';
import type { Commit } from './graph.ts';
import type { Persist, PersistedState } from './persist.ts';
import { dec, enc } from './util.ts';

export interface FsEntry { name: string; kind: 'file' | 'dir'; size: number; /** ms since epoch */ mtime: number }
export interface FsStat { kind: 'file' | 'dir'; size: number; mtime: number }

/** Paths are `/`-separated and relative to the vault root; '' is the root. */
export interface VaultFs {
  /** `false`: the folder does not survive a restart (a browser's memory), so what was indexed in it is not trusted then */
  durable?: boolean;
  readdir(dir: string): Promise<FsEntry[]>;
  read(path: string): Promise<Uint8Array | null>;
  /** Replace the file as a whole (never half written) and create missing parent folders. */
  write(path: string, data: Uint8Array | string, o?: { private?: boolean }): Promise<void>;
  /** Missing paths are not an error. A folder is removed with everything in it. */
  remove(path: string): Promise<void>;
  /** Creates the destination's parent folders. */
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FsStat | null>;
}

/** An in-memory folder for tests and for a Device with no disk. `clock` stamps modification times. */
export class MemFs implements VaultFs {
  durable = true;
  readonly files = new Map<string, { data: Uint8Array; mtime: number }>();
  readonly dirs = new Set<string>(['']);
  clock: () => number = () => Date.now();
  writes = 0;

  private parents(path: string) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
  }
  async readdir(dir: string): Promise<FsEntry[]> {
    const prefix = dir ? dir + '/' : '';
    const out = new Map<string, FsEntry>();
    for (const [p, f] of this.files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest.includes('/')) out.set(rest, { name: rest, kind: 'file', size: f.data.length, mtime: f.mtime });
    }
    for (const d of this.dirs) {
      if (!d || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      if (rest && !rest.includes('/')) out.set(rest, { name: rest, kind: 'dir', size: 0, mtime: 0 });
    }
    return [...out.values()];
  }
  async read(path: string) { const f = this.files.get(path); return f ? f.data.slice() : null; }
  async write(path: string, data: Uint8Array | string) {
    this.parents(path);
    this.writes++;
    this.files.set(path, { data: typeof data === 'string' ? enc(data) : data.slice(), mtime: this.clock() });
  }
  async remove(path: string) {
    this.files.delete(path);
    const pre = path + '/';
    for (const p of [...this.files.keys()]) if (p.startsWith(pre)) this.files.delete(p);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(pre)) this.dirs.delete(d);
  }
  async rename(from: string, to: string) {
    if (this.files.has(from)) {
      const f = this.files.get(from)!;
      this.files.delete(from);
      this.parents(to);
      this.files.set(to, f);
      return;
    }
    if (!this.dirs.has(from)) return;
    const pre = from + '/';
    this.parents(to + '/x');
    for (const [p, f] of [...this.files]) if (p.startsWith(pre)) { this.files.delete(p); this.files.set(to + '/' + p.slice(pre.length), f); }
    for (const d of [...this.dirs]) if (d === from || d.startsWith(pre)) { this.dirs.delete(d); this.dirs.add(d === from ? to : to + '/' + d.slice(pre.length)); }
  }
  async mkdir(path: string) { if (path) { this.parents(path + '/x'); this.dirs.add(path); } }
  async stat(path: string): Promise<FsStat | null> {
    const f = this.files.get(path);
    if (f) return { kind: 'file', size: f.data.length, mtime: f.mtime };
    return this.dirs.has(path) ? { kind: 'dir', size: 0, mtime: 0 } : null;
  }
  /** test helpers */
  text(path: string): string | null { const f = this.files.get(path); return f ? dec(f.data) : null; }
  put(path: string, text: string, mtime?: number) { this.parents(path); this.files.set(path, { data: enc(text), mtime: mtime ?? this.clock() }); }
  list(): string[] { return [...this.files.keys()].sort(); }
}

interface Row { c: Commit; pushed: boolean }

/** Where a Device keeps what belongs to this Device only (its id, the Store's credentials, the remembered key, sync state). */
export interface LocalMeta {
  load(): Promise<Record<string, unknown>>;
  save(meta: Record<string, unknown>): Promise<void>;
}

/**
 * Replica persistence inside the vault folder: `.ergonotes/commits/<item>/<id>` (sealed), `heads.json` and
 * `vault.json` (the wrapped key, so the folder alone can be opened with the password). What belongs to one Device
 * (identity, credentials, the remembered key) goes to `local` when given, and never into the folder.
 */
export class FsPersist implements Persist {
  private heads: Record<string, string> = {};
  private meta: Record<string, unknown> = {};
  private loaded = false;
  private writing: Promise<void> = Promise.resolve();
  private sealer: Sealer | null = null;
  private fs: VaultFs;
  private dir: string;
  private local: LocalMeta | null;
  constructor(fs: VaultFs, o: { dir?: string; local?: LocalMeta } = {}) { this.fs = fs; this.dir = o.dir ?? '.ergonotes'; this.local = o.local ?? null; }

  /** From now on commit files are sealed with the vault key (those already written plain are read as they are). */
  setSealer(s: Sealer | null) { this.sealer = s; }

  private async readJson<T>(name: string, fallback: T): Promise<T> {
    try {
      const b = await this.fs.read(`${this.dir}/${name}`);
      return b ? (JSON.parse(dec(b)) as T) : fallback;
    } catch { return fallback; }
  }
  private async ensure() {
    if (this.loaded) return;
    this.heads = await this.readJson('heads.json', {});
    if (this.local) {
      this.meta = await this.local.load();
      const vf = await this.readJson<unknown>('vault.json', null);
      if (vf) this.meta.vaultFile = vf;
    } else this.meta = await this.readJson('meta.json', {});
    this.loaded = true;
  }
  private base(c: Pick<Commit, 'item' | 'id'>) { return `${this.dir}/commits/${c.item}/${c.id}`; }

  private async encode(row: Row): Promise<[string, Uint8Array | string]> {
    return this.sealer ? ['.bin', await this.sealer.sealJson(row)] : ['.json', JSON.stringify(row)];
  }
  private async decode(name: string, data: Uint8Array): Promise<Row | null> {
    try {
      if (name.endsWith('.bin')) return this.sealer ? await this.sealer.openJson<Row>(data) : null;
      return JSON.parse(dec(data)) as Row;
    } catch { return null; } // a torn or foreign file: skip it
  }

  async loadMeta() { await this.ensure(); return structuredClone(this.meta); }

  async load(): Promise<PersistedState> {
    await this.ensure();
    const commits: Commit[] = [];
    const pushed: string[] = [];
    const root = `${this.dir}/commits`;
    for (const d of await this.fs.readdir(root).catch(() => [])) {
      if (d.kind !== 'dir') continue;
      for (const f of await this.fs.readdir(`${root}/${d.name}`).catch(() => [])) {
        if (f.kind !== 'file' || f.name.endsWith('.tmp')) continue;
        const data = await this.fs.read(`${root}/${d.name}/${f.name}`);
        const row = data ? await this.decode(f.name, data) : null;
        if (!row) continue;
        commits.push(row.c);
        if (row.pushed) pushed.push(row.c.id);
      }
    }
    return { commits, pushed, heads: { ...this.heads }, meta: structuredClone(this.meta) };
  }

  async putCommit(c: Commit, pushed: boolean) {
    const [ext, data] = await this.encode({ c, pushed });
    const other = ext === '.bin' ? '.json' : '.bin';
    await this.fs.write(this.base(c) + ext, data, { private: true });
    await this.fs.remove(this.base(c) + other);
  }

  async removeCommits(cs: Commit[]) {
    for (const c of cs) { await this.fs.remove(this.base(c) + '.json'); await this.fs.remove(this.base(c) + '.bin'); }
  }

  async markPushed(cs: Commit[]) {
    for (const c of cs) {
      for (const ext of ['.bin', '.json']) {
        const data = await this.fs.read(this.base(c) + ext).catch(() => null);
        if (!data) continue;
        const row = await this.decode(ext, data);
        if (row && !row.pushed) {
          const [e, d] = await this.encode({ c: row.c, pushed: true });
          await this.fs.write(this.base(c) + e, d, { private: true });
        }
        break;
      }
    }
  }

  private queue(fn: () => Promise<void>) {
    this.writing = this.writing.then(fn, fn);
    return this.writing;
  }
  async setHead(item: string, id: string) {
    await this.ensure();
    this.heads[item] = id;
    await this.queue(() => this.fs.write(`${this.dir}/heads.json`, JSON.stringify(this.heads), { private: true }));
  }
  async setMeta(key: string, value: unknown) {
    await this.ensure();
    if (value === undefined) delete this.meta[key]; else this.meta[key] = value;
    if (!this.local) { await this.queue(() => this.fs.write(`${this.dir}/meta.json`, JSON.stringify(this.meta), { private: true })); return; }
    if (key === 'vaultFile') { await this.queue(() => this.fs.write(`${this.dir}/vault.json`, JSON.stringify(value), { private: true })); }
    const { vaultFile: _v, ...mine } = this.meta;
    await this.queue(() => this.local!.save(mine));
  }
  async close() { await this.writing; }
}
