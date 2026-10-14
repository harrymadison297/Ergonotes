// ADR 0006: reduce pushed linear history by age. Commit ids never change; retained commits whose parent
// was dropped are replaced by an overlay (snapshot + re-pointed parents).
import type { Commit, Graph } from './graph.ts';
import { DAY } from './util.ts';

/** Bucket key for a commit of a given age, or null while it is inside the keep-everything window. */
export function bucketOf(age: number, ts: number, keepAllMs = 7 * DAY): string | null {
  if (age <= keepAllMs) return null;
  if (age <= 90 * DAY) return `d${Math.floor(ts / DAY)}`;
  if (age <= 365 * DAY) return `w${Math.floor(ts / (7 * DAY))}`;
  return `m${Math.floor(ts / (30 * DAY))}`;
}

export interface CompactionPlan { overlays: Commit[]; drop: string[] }

export function planCompaction(
  g: Graph,
  item: string,
  now: number,
  canDrop: (id: string) => boolean,
  opts: { keepAllMs?: number; purged?: boolean } = {},
): CompactionPlan {
  const ids = g.byItem.get(item) ?? new Set<string>();
  const heads = new Set(g.heads(item));
  const children = new Map<string, string[]>();
  for (const id of ids) for (const p of g.get(id)!.parents) (children.get(p) ?? children.set(p, []).get(p)!).push(id);

  const droppable = new Set<string>();
  for (const id of ids) {
    const c = g.get(id)!;
    if (heads.has(id) || !canDrop(id)) continue;
    if (opts.purged) { droppable.add(id); continue; }
    const kids = children.get(id) ?? [];
    // a child whose text cannot be rebuilt cannot get an overlay: its parent has to stay, or it becomes unreadable everywhere
    const kidReadable = kids.length === 1 && (g.get(kids[0])!.kind === 'purge' || g.text(kids[0]) !== null);
    if (c.parents.length === 1 && kids.length === 1 && c.kind !== 'purge' && kidReadable) droppable.add(id);
  }

  const dropped = new Set<string>();
  if (opts.purged) for (const id of droppable) dropped.add(id);
  else {
    for (const id of droppable) {
      const child = children.get(id)![0];
      if (droppable.has(child)) continue; // not the top of a run
      const seen = new Set<string>(); // newest -> oldest, keep the newest commit of each bucket
      for (let cur: string | undefined = id; cur && droppable.has(cur); cur = g.get(cur)!.parents[0]) {
        const cx = g.get(cur)!;
        const b = bucketOf(now - cx.ts, cx.ts, opts.keepAllMs);
        if (b === null) continue;
        if (seen.has(b)) dropped.add(cur); else seen.add(b);
      }
    }
  }

  const overlays: Commit[] = [];
  for (const id of ids) {
    if (dropped.has(id)) continue;
    const c = g.get(id)!;
    if (!c.parents.some(p => dropped.has(p))) continue;
    const sub: string[] = [];
    const np = c.parents.map(p => {
      let q = p;
      while (dropped.has(q)) { sub.push(q); q = g.get(q)!.parents[0]; if (q === undefined) break; }
      return q;
    }).filter((q): q is string => q !== undefined && !dropped.has(q));
    const lines = c.kind === 'purge' ? null : g.text(id);
    if (c.kind !== 'purge' && !lines) continue;
    overlays.push({
      ...c,
      parents: [...new Set(np)].sort(),
      kind: c.kind === 'purge' ? 'purge' : 'snap',
      body: lines,
      depth: 0,
      subsumed: [...(c.subsumed ?? []), ...sub],
    });
  }
  return { overlays, drop: [...dropped] };
}
