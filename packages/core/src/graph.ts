// Per-item commit graph (ADR 0001, 0006). Pure data structure, no I/O.
import { diffPatch, patch } from 'node-diff3';
import { sha256hex } from './util.ts';

export const SNAP_EVERY = 20;

export type CommitKind = 'snap' | 'delta' | 'purge';

export interface Commit {
  id: string;
  item: string;
  parents: string[];
  author: string;
  ts: number;
  kind: CommitKind;
  /** snap: string[] (file lines); delta: node-diff3 patch against parents[0]; purge: null */
  body: any;
  /** deltas since the last snapshot */
  depth: number;
  /** overlay only: original commits this overlay replaced */
  subsumed?: string[];
}

export class Graph {
  commits = new Map<string, Commit>();
  byItem = new Map<string, Set<string>>();
  private textCache = new Map<string, string[]>();
  private genCache = new Map<string, number>();
  private ancCache = new Map<string, Set<string>>();

  has(id: string): boolean { return this.commits.has(id); }
  get(id: string): Commit | undefined { return this.commits.get(id); }

  add(c: Commit): void {
    const replaced = this.commits.has(c.id);
    this.commits.set(c.id, c);
    let set = this.byItem.get(c.item);
    if (!set) this.byItem.set(c.item, (set = new Set()));
    set.add(c.id);
    this.genCache.clear();
    this.ancCache.clear();
    if (replaced) this.textCache.delete(c.id);
  }

  remove(id: string): void {
    const c = this.commits.get(id);
    if (!c) return;
    this.commits.delete(id);
    this.byItem.get(c.item)?.delete(id);
    this.genCache.clear();
    this.ancCache.clear();
    this.textCache.delete(id);
  }

  children(id: string): string[] {
    const c = this.commits.get(id);
    if (!c) return [];
    const out: string[] = [];
    for (const x of this.byItem.get(c.item) ?? []) if (this.commits.get(x)!.parents.includes(id)) out.push(x);
    return out;
  }

  /** File lines at this commit; null when the base chain is incomplete. Purged items read as empty. */
  text(id: string): string[] | null {
    const c = this.commits.get(id);
    if (!c) return null;
    if (c.kind === 'purge') return [];
    const hit = this.textCache.get(id);
    if (hit) return hit;
    let t: string[];
    if (c.kind === 'snap') t = c.body as string[];
    else {
      const base = this.text(c.parents[0]);
      if (!base) return null;
      t = patch(base, c.body);
    }
    this.textCache.set(id, t);
    return t;
  }

  ancestors(id: string): Set<string> {
    const hit = this.ancCache.get(id);
    if (hit) return hit;
    const out = new Set<string>();
    const st = [id];
    while (st.length) {
      const x = st.pop()!;
      if (out.has(x)) continue;
      out.add(x);
      const c = this.commits.get(x);
      if (c) for (const p of c.parents) st.push(p);
    }
    this.ancCache.set(id, out);
    return out;
  }

  /** Longest distance from a root; used to order merge bases. */
  gen(id: string): number {
    const hit = this.genCache.get(id);
    if (hit !== undefined) return hit;
    const c = this.commits.get(id);
    const g = !c || c.parents.length === 0 ? 0 : 1 + Math.max(...c.parents.map(p => this.gen(p)));
    this.genCache.set(id, g);
    return g;
  }

  heads(item: string): string[] {
    const ids = this.byItem.get(item);
    if (!ids) return [];
    const isParent = new Set<string>();
    for (const id of ids) for (const p of this.commits.get(id)!.parents) isParent.add(p);
    return [...ids].filter(i => !isParent.has(i)).sort();
  }

  /** Maximal common ancestors of a and b, deepest first, ties by id. */
  maximalBases(a: string, b: string): string[] {
    const A = this.ancestors(a);
    const B = this.ancestors(b);
    const common = [...A].filter(x => B.has(x) && this.commits.has(x));
    const shadow = new Set<string>();
    for (const y of common) for (const p of this.commits.get(y)!.parents) for (const z of this.ancestors(p)) shadow.add(z);
    return common
      .filter(x => !shadow.has(x))
      .sort((x, y) => this.gen(y) - this.gen(x) || (x < y ? -1 : 1));
  }

  /**
   * Build a commit. The id is a content hash of (item, parents, author, ts, lines), so two Devices that
   * produce the same automatic merge produce the same commit (ADR 0001).
   */
  make(item: string, parents: string[], lines: string[], author: string, ts: number, purge = false): Commit {
    const ps = [...parents].sort();
    const id = sha256hex(JSON.stringify([item, ps, author, ts, purge ? 'P' : lines])).slice(0, 20);
    if (purge) return { id, item, parents: ps, author, ts, kind: 'purge', body: null, depth: 0 };
    const p0 = ps[0] ? this.commits.get(ps[0]) : undefined;
    const base = p0 ? this.text(p0.id) : null;
    if (!p0 || !base || p0.kind === 'purge' || p0.depth + 1 >= SNAP_EVERY) {
      return { id, item, parents: ps, author, ts, kind: 'snap', body: lines, depth: 0 };
    }
    return { id, item, parents: ps, author, ts, kind: 'delta', body: diffPatch(base, lines), depth: p0.depth + 1 };
  }
}
