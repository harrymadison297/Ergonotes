// Local persistence of a Device's replica. Implementations: memory (tests), IndexedDB (browser), files (server).
import type { Commit } from './graph.ts';

export interface PersistedState {
  commits: Commit[];
  pushed: string[];
  heads: Record<string, string>;
  meta: Record<string, unknown>;
}

export interface Persist {
  load(): Promise<PersistedState>;
  /** metadata only; cheap, used before the vault is unlocked */
  loadMeta(): Promise<Record<string, unknown>>;
  putCommit(c: Commit, pushed: boolean): Promise<void>;
  removeCommits(ids: Commit[]): Promise<void>;
  markPushed(ids: string[]): Promise<void>;
  setHead(item: string, id: string): Promise<void>;
  setMeta(key: string, value: unknown): Promise<void>;
}

export class MemPersist implements Persist {
  commits = new Map<string, Commit>();
  pushed = new Set<string>();
  heads: Record<string, string> = {};
  meta: Record<string, unknown> = {};

  async load(): Promise<PersistedState> {
    return {
      commits: [...this.commits.values()].map(c => structuredClone(c)),
      pushed: [...this.pushed],
      heads: { ...this.heads },
      meta: structuredClone(this.meta),
    };
  }
  async loadMeta() { return structuredClone(this.meta); }
  async putCommit(c: Commit, pushed: boolean) {
    this.commits.set(c.id, structuredClone(c));
    if (pushed) this.pushed.add(c.id); else this.pushed.delete(c.id);
  }
  async removeCommits(cs: Commit[]) {
    for (const c of cs) { this.commits.delete(c.id); this.pushed.delete(c.id); }
  }
  async markPushed(ids: string[]) { for (const i of ids) this.pushed.add(i); }
  async setHead(item: string, id: string) { this.heads[item] = id; }
  async setMeta(key: string, value: unknown) { this.meta[key] = structuredClone(value); }
}
