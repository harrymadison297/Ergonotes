// Three-way merge of two commits' file text (ADR 0001): frontmatter per key, body by line units,
// ergonote-* blocks atomic, virtual base when several merge bases exist.
import { diff3Merge } from 'node-diff3';
import type { Graph } from './graph.ts';
import { fromUnits, joinDoc, splitDoc, toUnits, type Frontmatter } from './markdown.ts';
import { sameJson } from './util.ts';

export type MergeResult = { clean: true; text: string; purge: boolean } | { clean: false; why: string };

type Region = { ok?: string[]; conflict?: { a: string[]; o: string[]; b: string[] } };
const regions = (a: string[], o: string[], b: string[]): Region[] =>
  diff3Merge(a, o, b, { excludeFalseConflicts: true }) as Region[];

function mergeBodies(ours: string, base: string, theirs: string): { clean: true; text: string } | { clean: false } {
  const r = regions(toUnits(ours), toUnits(base), toUnits(theirs));
  if (r.some(s => s.conflict)) return { clean: false };
  return { clean: true, text: fromUnits(r.flatMap(s => s.ok ?? [])) };
}

function unionBodies(ours: string, base: string, theirs: string): string {
  const out: string[] = [];
  for (const s of regions(toUnits(ours), toUnits(base), toUnits(theirs))) {
    if (s.ok) out.push(...s.ok);
    else if (s.conflict) {
      out.push(...s.conflict.a);
      out.push(...s.conflict.b.filter(l => !s.conflict!.a.includes(l)));
    }
  }
  return fromUnits(out);
}

const asArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function mergeFrontmatter(o: Frontmatter, b: Frontmatter, t: Frontmatter, bodyChanged: { ours: boolean; theirs: boolean }):
  { clean: true; fm: Frontmatter } | { clean: false; why: string } {
  const keys = new Set([...Object.keys(o), ...Object.keys(b), ...Object.keys(t)]);
  const out: Frontmatter = {};
  // trash on one side, content edit on the other: ask the person (ADR 0001 / Q28.5)
  const trashChangedOurs = !sameJson(o.trashed, b.trashed);
  const trashChangedTheirs = !sameJson(t.trashed, b.trashed);
  if ((trashChangedOurs && !sameJson(o.trashed, t.trashed) && bodyChanged.theirs && t.trashed === undefined) ||
      (trashChangedTheirs && !sameJson(o.trashed, t.trashed) && bodyChanged.ours && o.trashed === undefined)) {
    return { clean: false, why: 'trash-vs-edit' };
  }
  for (const k of keys) {
    const ov = o[k], bv = b[k], tv = t[k];
    if (sameJson(ov, tv)) { out[k] = ov; continue; }
    if (sameJson(ov, bv)) { out[k] = tv; continue; }
    if (sameJson(tv, bv)) { out[k] = ov; continue; }
    if (k === 'tags') { out[k] = [...new Set([...asArr(ov), ...asArr(tv)])].sort(); continue; }
    if (k === 'updated') { out[k] = String(ov) > String(tv) ? ov : tv; continue; }
    return { clean: false, why: `frontmatter:${k}` };
  }
  return { clean: true, fm: out };
}

function render(fm: Frontmatter, body: string): string {
  return Object.keys(fm).some(k => fm[k] !== undefined && fm[k] !== null) ? joinDoc(fm, body) : body;
}

/** Merge three full file texts. `base` may be null (no common ancestor): only identical texts merge. */
export function mergeText(ours: string, base: string | null, theirs: string): MergeResult {
  if (ours === theirs) return { clean: true, text: ours, purge: false };
  if (base === null) return { clean: false, why: 'no-base' };
  const O = splitDoc(ours), B = splitDoc(base), T = splitDoc(theirs);
  const bodyChanged = { ours: O.body !== B.body, theirs: T.body !== B.body };
  const fm = mergeFrontmatter(O.fm, B.fm, T.fm, bodyChanged);
  if (!fm.clean) return { clean: false, why: fm.why };
  const body = mergeBodies(O.body, B.body, T.body);
  if (!body.clean) return { clean: false, why: 'overlap' };
  return { clean: true, text: render(fm.fm, body.text), purge: false };
}

/** "Keep both": union of conflicting regions, tags unioned, newer scalar wins for the rest. */
export function unionText(ours: string, base: string | null, theirs: string): string {
  if (ours === theirs) return ours;
  const O = splitDoc(ours), T = splitDoc(theirs), B = splitDoc(base ?? '');
  const merged: Frontmatter = { ...T.fm, ...O.fm };
  merged.tags = [...new Set([...asArr(O.fm.tags), ...asArr(T.fm.tags)])].sort();
  if (!merged.tags || (merged.tags as string[]).length === 0) delete merged.tags;
  const body = base === null
    ? [...new Set([...O.body.split('\n'), ...T.body.split('\n')])].join('\n')
    : unionBodies(O.body, B.body, T.body);
  return render(merged, body);
}

export interface MergeStats { crissCross: number }

/** Text of the merge base of x and y; several maximal bases are merged into a virtual base (git "recursive"). */
export function baseText(g: Graph, x: string, y: string, depth = 0, virtual = true): string | null {
  const M = g.maximalBases(x, y);
  if (!M.length) return null;
  const first = g.text(M[0]);
  if (!first) return null;
  if (M.length === 1 || !virtual || depth > 6) return first.join('\n');
  let acc = first.join('\n');
  let accId = M[0];
  for (const m of M.slice(1)) {
    const tm = g.text(m);
    if (!tm) return null;
    const bb = baseText(g, accId, m, depth + 1, virtual) ?? '';
    const r = mergeText(acc, bb, tm.join('\n'));
    acc = r.clean ? r.text : unionText(acc, bb, tm.join('\n'));
    accId = m;
  }
  return acc;
}

/** Try to merge two heads of one item. */
export function tryMerge(g: Graph, x: string, y: string, stats?: MergeStats): MergeResult {
  const cx = g.get(x)!, cy = g.get(y)!;
  if (cx.kind === 'purge' && cy.kind === 'purge') return { clean: true, text: '', purge: true };
  if (cx.kind === 'purge' || cy.kind === 'purge') return { clean: false, why: 'purge-vs-edit' };
  const tx = g.text(x), ty = g.text(y);
  if (!tx || !ty) return { clean: false, why: 'unreadable' };
  const sx = tx.join('\n'), sy = ty.join('\n');
  if (sx === sy) return { clean: true, text: sx, purge: false };
  const bases = g.maximalBases(x, y);
  if (bases.length > 1 && stats) stats.crissCross++;
  const base = baseText(g, x, y);
  return mergeText(sx, base, sy);
}

/** "Keep both" text for two heads. */
export function unionHeads(g: Graph, x: string, y: string): string {
  const tx = (g.text(x) ?? []).join('\n');
  const ty = (g.text(y) ?? []).join('\n');
  return unionText(tx, baseText(g, x, y), ty);
}
