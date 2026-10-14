// Browser-only: replica persistence in IndexedDB (used by the desktop/mobile shells' webview).
import type { Commit } from './graph.ts';
import type { Persist, PersistedState } from './persist.ts';

interface Row { c: Commit; pushed: boolean }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export class IdbPersist implements Persist {
  private db: Promise<IDBDatabase>;
  constructor(name = 'ergonotes') {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('commits', { keyPath: 'c.id' });
        db.createObjectStore('heads');
        db.createObjectStore('meta');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  async loadMeta() {
    const db = await this.db;
    const tx = db.transaction('meta');
    const keys = await req(tx.objectStore('meta').getAllKeys());
    const vals = await req(tx.objectStore('meta').getAll());
    const meta: Record<string, unknown> = {};
    keys.forEach((k, i) => { meta[String(k)] = vals[i]; });
    return meta;
  }

  async load(): Promise<PersistedState> {
    const db = await this.db;
    const tx = db.transaction(['commits', 'heads']);
    const rows = (await req(tx.objectStore('commits').getAll())) as Row[];
    const hk = await req(tx.objectStore('heads').getAllKeys());
    const hv = await req(tx.objectStore('heads').getAll());
    const heads: Record<string, string> = {};
    hk.forEach((k, i) => { heads[String(k)] = hv[i] as string; });
    return { commits: rows.map(r => r.c), pushed: rows.filter(r => r.pushed).map(r => r.c.id), heads, meta: await this.loadMeta() };
  }

  async putCommit(c: Commit, pushed: boolean) {
    const db = await this.db;
    const tx = db.transaction('commits', 'readwrite');
    tx.objectStore('commits').put({ c, pushed } satisfies Row);
    await done(tx);
  }
  async removeCommits(cs: Commit[]) {
    const db = await this.db;
    const tx = db.transaction('commits', 'readwrite');
    for (const c of cs) tx.objectStore('commits').delete(c.id);
    await done(tx);
  }
  async markPushed(cs: Commit[]) {
    const db = await this.db;
    const tx = db.transaction('commits', 'readwrite');
    const st = tx.objectStore('commits');
    for (const c of cs) {
      const row = (await req(st.get(c.id))) as Row | undefined;
      if (row && !row.pushed) st.put({ c: row.c, pushed: true });
    }
    await done(tx);
  }
  async setHead(item: string, id: string) {
    const db = await this.db;
    const tx = db.transaction('heads', 'readwrite');
    tx.objectStore('heads').put(id, item);
    await done(tx);
  }
  async setMeta(key: string, value: unknown) {
    const db = await this.db;
    const tx = db.transaction('meta', 'readwrite');
    if (value === undefined) tx.objectStore('meta').delete(key); else tx.objectStore('meta').put(value, key);
    await done(tx);
  }
}
