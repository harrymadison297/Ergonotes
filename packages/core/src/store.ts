// A Store is passive storage that Devices exchange encrypted objects through (ADR 0003).
export interface StoredKey { key: string; lastModified: number }

export interface Store {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  /** Keys with this prefix, lexicographically after `startAfter`, with the Store's own modification time (ms). */
  list(prefix: string, startAfter?: string): Promise<StoredKey[]>;
  delete(key: string): Promise<void>;
}

export interface StoreStats { puts: number; gets: number; lists: number; deletes: number }

/** In-memory Store used by tests and by the simulator. `clock` is the Store's notion of time. */
export class MemStore implements Store {
  readonly objects = new Map<string, { data: Uint8Array; lastModified: number }>();
  stats: StoreStats = { puts: 0, gets: 0, lists: 0, deletes: 0 };
  clock: () => number = () => Date.now();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.stats.puts++;
    this.objects.set(key, { data: data.slice(), lastModified: this.clock() });
  }
  async get(key: string): Promise<Uint8Array | null> {
    this.stats.gets++;
    const o = this.objects.get(key);
    return o ? o.data.slice() : null;
  }
  async list(prefix: string, startAfter = ''): Promise<StoredKey[]> {
    this.stats.lists++;
    return [...this.objects.entries()]
      .filter(([k]) => k.startsWith(prefix) && k > startAfter)
      .map(([key, v]) => ({ key, lastModified: v.lastModified }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  async delete(key: string): Promise<void> {
    this.stats.deletes++;
    this.objects.delete(key);
  }
}
