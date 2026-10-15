// A Device's replica of the vault: commit graph, local heads, and the sync protocol over a passive Store
// (ADR 0001, 0003, 0006).
import { planCompaction } from './compaction.ts';
import type { Sealer } from './crypto.ts';
import { Graph, type Commit } from './graph.ts';
import { tryMerge, type MergeStats } from './merge.ts';
import type { Persist } from './persist.ts';
import type { Store } from './store.ts';
import { DAY, MIN, enc, pad } from './util.ts';

export const STALE_MS = 30 * DAY;
export const CURSOR_MARGIN_MS = 30 * MIN;
const OFFSET_TTL_MS = 30 * MIN;

export interface SyncContext {
  store: Store;
  sealer: Sealer;
  /** local clock; injectable for tests */
  now?: () => number;
}

export interface PullReport { fetched: number; overlays: number; merged: number; touched: string[]; conflicts: string[] }
export interface PushReport { pushed: number; snapshots: number }
export interface DeviceRecord { at: number; name: string; seen: Record<string, string[]> }

const K = {
  commit: (item: string, id: string) => `commits/${item}/${id}`,
  overlay: (item: string, id: string, gen: number) => `overlays/${item}/${id}-${String(gen).padStart(5, '0')}`,
  gc: (item: string, dev: string, ts: number) => `gc/${item}/${dev}-${ts}`,
  device: (id: string) => `devices/${id}`,
  inbox: (t: number, dev: string, kind: 'c' | 'o' | 'g', a: string, b = '') => `inbox/${pad(t)}-${dev}-${kind}~${a}~${b}`,
};
const INBOX_RE = /^inbox\/(\d{15})-(.+)-([cog])~([^~]*)~(.*)$/;

type Wanted = { kind: 'c'; item: string; id: string } | { kind: 'o'; item: string; id: string; gen: number; key: string } | { kind: 'g'; key: string };

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

export class Replica {
  readonly g = new Graph();
  readonly localHead = new Map<string, string>();
  readonly pushed = new Set<string>();
  readonly dropped = new Set<string>();
  readonly gcSeen = new Set<string>();
  order: string[] = [];
  inboxCursor = 0;
  lastPullAt = 0;
  /** an object could not be fetched or read during a pull: the next pull lists everything again */
  needFull = false;
  /** commits being uploaded right now; a new edit must chain on them, never amend them */
  private inflight = new Set<string>();
  readonly stats = { merges: 0, amends: 0, commits: 0, snapshotOnPush: 0, crissCross: 0 } satisfies MergeStats & Record<string, number>;
  readonly deviceId: string;
  deviceName: string;
  private persist: Persist;
  private listeners = new Set<(items: string[]) => void>();
  private offset = { value: 0, at: 0 };
  private lastDeviceRecord = 0;

  private constructor(persist: Persist, deviceId: string, deviceName: string) {
    this.persist = persist;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
  }

  static async open(persist: Persist, deviceId: string, deviceName: string): Promise<Replica> {
    const r = new Replica(persist, deviceId, deviceName);
    const s = await persist.load();
    for (const c of s.commits) r.g.add(c);
    for (const id of s.pushed) r.pushed.add(id);
    for (const [item, id] of Object.entries(s.heads)) if (r.g.has(id)) r.localHead.set(item, id);
    for (const id of (s.meta.dropped as string[] | undefined) ?? []) r.dropped.add(id);
    for (const n of (s.meta.gcSeen as string[] | undefined) ?? []) r.gcSeen.add(n);
    r.inboxCursor = (s.meta.inboxCursor as number | undefined) ?? 0;
    r.lastPullAt = (s.meta.lastPullAt as number | undefined) ?? 0;
    r.needFull = (s.meta.needFull as boolean | undefined) === true;
    r.order = s.commits.filter(c => !r.pushed.has(c.id)).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)).map(c => c.id);
    for (const item of r.g.byItem.keys()) await r.refreshLocalHead(item);
    return r;
  }

  onChange(fn: (items: string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(items: Iterable<string>) {
    const list = [...new Set(items)];
    if (list.length) for (const l of this.listeners) l(list);
  }

  // ---------- reading ----------
  items(): string[] { return [...this.g.byItem.keys()].filter(i => this.localHead.has(i)); }
  headId(item: string): string | undefined { return this.localHead.get(item); }
  text(item: string): string | null {
    const h = this.localHead.get(item);
    if (!h) return null;
    const c = this.g.get(h);
    if (!c || c.kind === 'purge') return null;
    const l = this.g.text(h);
    return l ? l.join('\n') : null;
  }
  isPurged(item: string): boolean {
    const h = this.localHead.get(item);
    return !!h && this.g.get(h)?.kind === 'purge';
  }
  /** Heads other than the one this Device shows. */
  otherHeads(item: string): string[] {
    const h = this.localHead.get(item);
    return this.g.heads(item).filter(x => x !== h);
  }
  hasConflict(item: string): boolean { return this.g.heads(item).length > 1; }

  // ---------- writing ----------
  /** Record a new text for an item. Amends this Device's own unpushed draft instead of chaining (ADR 0006). */
  async commit(item: string, text: string, now = Date.now()): Promise<Commit | null> {
    const head = this.localHead.get(item);
    const cur = head ? this.g.text(head) : [];
    if (head && cur === null) throw new Error('This note cannot be read yet; sync and try again.');
    if (head && this.g.get(head)!.kind !== 'purge' && cur!.join('\n') === text) return null;
    let parents = head ? [head] : [];
    const hc = head ? this.g.get(head) : undefined;
    let removed: Commit | undefined;
    if (hc && hc.author === this.deviceId && !this.pushed.has(hc.id) && !this.inflight.has(hc.id) && hc.kind !== 'purge' && hc.parents.length <= 1 && this.g.children(hc.id).length === 0) {
      removed = hc;
      parents = hc.parents;
      this.g.remove(hc.id);
      this.order = this.order.filter(i => i !== hc.id);
      this.stats.amends++;
    }
    const c = this.g.make(item, parents, text.split('\n'), this.deviceId, now);
    this.g.add(c);
    this.order.push(c.id);
    this.localHead.set(item, c.id);
    this.stats.commits++;
    if (removed) await this.persist.removeCommits([removed]);
    await this.persist.putCommit(c, false);
    await this.persist.setHead(item, c.id);
    this.emit([item]);
    return c;
  }

  /**
   * Record a text that was made on top of `base`, not on top of this Device's head: a file edited by another program
   * while a newer text arrived from elsewhere. Heads that join cleanly are merged at once; otherwise the item is a
   * conflicted revision and this Device keeps showing the new text.
   */
  async commitOn(item: string, base: string, text: string, now = Date.now()): Promise<Commit> {
    const c = this.g.make(item, [base], text.split('\n'), this.deviceId, now);
    if (!this.g.has(c.id)) {
      this.g.add(c);
      this.order.push(c.id);
      this.stats.commits++;
      await this.persist.putCommit(c, false);
    }
    this.localHead.set(item, c.id);
    await this.persist.setHead(item, c.id);
    await this.autoMerge(item);
    this.emit([item]);
    return c;
  }

  /** Delete forever (history is removed by compaction later). */
  async purge(item: string, now = Date.now()): Promise<void> {
    const head = this.localHead.get(item);
    if (!head) return;
    const c = this.g.make(item, this.g.heads(item), [], this.deviceId, now, true);
    this.g.add(c);
    this.order.push(c.id);
    this.localHead.set(item, c.id);
    await this.persist.putCommit(c, false);
    await this.persist.setHead(item, c.id);
    this.emit([item]);
  }

  /** Resolve a conflicted revision with a chosen text (null = delete forever). */
  async resolve(item: string, text: string | null, now = Date.now()): Promise<void> {
    const heads = this.g.heads(item);
    if (heads.length === 0) return;
    const c = this.g.make(item, heads, text === null ? [] : text.split('\n'), this.deviceId, now, text === null);
    this.g.add(c);
    this.order.push(c.id);
    this.localHead.set(item, c.id);
    await this.persist.putCommit(c, false);
    await this.persist.setHead(item, c.id);
    this.emit([item]);
  }

  // ---------- deterministic automatic merge ----------
  async autoMerge(item: string): Promise<number> {
    let made = 0;
    for (let guard = 0; guard < 64; guard++) {
      const H = this.g.heads(item);
      if (H.length < 2) break;
      let merged = false;
      outer: for (let i = 0; i < H.length; i++) {
        for (let j = i + 1; j < H.length; j++) {
          const r = tryMerge(this.g, H[i], H[j], this.stats);
          if (!r.clean) continue;
          const ts = Math.max(this.g.get(H[i])!.ts, this.g.get(H[j])!.ts);
          const c = this.g.make(item, [H[i], H[j]], r.purge ? [] : r.text.split('\n'), 'auto', ts, r.purge);
          if (!this.g.has(c.id)) {
            this.g.add(c);
            this.order.push(c.id);
            await this.persist.putCommit(c, false);
            this.stats.merges++;
            made++;
          }
          merged = true;
          break outer;
        }
      }
      if (!merged) break;
    }
    await this.refreshLocalHead(item);
    return made;
  }

  private async refreshLocalHead(item: string): Promise<void> {
    const H = this.g.heads(item);
    if (!H.length) { this.localHead.delete(item); return; }
    const lh = this.localHead.get(item);
    let next: string;
    if (H.length === 1) next = H[0];
    else if (lh && H.includes(lh)) next = lh;
    else {
      const desc = lh ? H.filter(x => this.g.ancestors(x).has(lh)) : [];
      next = (desc.length ? desc : H)[0];
    }
    if (next !== lh) {
      this.localHead.set(item, next);
      await this.persist.setHead(item, next);
    }
  }

  // ---------- Store protocol ----------
  /** The Store's time minus ours, learned from the LastModified of an object we just wrote (ADR 0003). */
  async storeClockOffset(ctx: SyncContext): Promise<number> {
    const now = (ctx.now ?? Date.now)();
    if (this.offset.at && now - this.offset.at < OFFSET_TTL_MS) return this.offset.value;
    const key = `probe/${this.deviceId}`;
    const clock = ctx.now ?? Date.now;
    const t0 = clock();
    await ctx.store.put(key, enc(String(t0)));
    const t1 = clock();
    const l = await ctx.store.list(key);
    const lm = l.find(x => x.key === key)?.lastModified;
    this.offset = { value: lm === undefined ? 0 : lm - Math.round((t0 + t1) / 2), at: now };
    return this.offset.value;
  }

  async push(ctx: SyncContext): Promise<PushReport> {
    const unpushed = this.order.filter(id => !this.pushed.has(id) && this.g.has(id));
    const report: PushReport = { pushed: 0, snapshots: 0 };
    const now = (ctx.now ?? Date.now)();
    const serverNow = now + (await this.storeClockOffset(ctx));
    const done: string[] = [];
    for (const id of unpushed) this.inflight.add(id);
    try {
    for (const id of unpushed) {
      let c = this.g.get(id)!;
      // self-containment: never push a delta whose base is no longer on the Store
      if (c.kind === 'delta' && (!this.pushed.has(c.parents[0]) || this.dropped.has(c.parents[0]))) {
        const lines = this.g.text(id);
        if (lines) { c = { ...c, kind: 'snap', body: lines, depth: 0 }; report.snapshots++; this.stats.snapshotOnPush++; }
      }
      await ctx.store.put(K.commit(c.item, c.id), await ctx.sealer.sealJson(c));
      await ctx.store.put(K.inbox(serverNow, this.deviceId, 'c', c.item, c.id), new Uint8Array(1));
      this.pushed.add(id);
      done.push(id);
      report.pushed++;
    }
    } finally {
      for (const id of unpushed) this.inflight.delete(id);
      // whatever did reach the Store is recorded even when a later object failed
      if (done.length) await this.persist.markPushed(done.map(id => this.g.get(id)!).filter(Boolean));
    }
    this.order = this.order.filter(i => !this.pushed.has(i));
    await this.writeDeviceRecord(ctx, serverNow, report.pushed > 0);
    return report;
  }

  private async writeDeviceRecord(ctx: SyncContext, serverNow: number, force: boolean) {
    if (!force && serverNow - this.lastDeviceRecord < DAY / 4) return;
    const seen: Record<string, string[]> = {};
    for (const item of this.g.byItem.keys()) seen[item] = this.g.heads(item);
    const rec: DeviceRecord = { at: serverNow, name: this.deviceName, seen };
    await ctx.store.put(K.device(this.deviceId), await ctx.sealer.sealJson(rec));
    this.lastDeviceRecord = serverNow;
  }

  async pull(ctx: SyncContext, opts: { full?: boolean } = {}): Promise<PullReport> {
    const now = (ctx.now ?? Date.now)();
    const wanted: Wanted[] = [];
    let newestMarker = this.inboxCursor;
    const stale = this.lastPullAt > 0 && now - this.lastPullAt > 25 * DAY;
    const full = opts.full || this.inboxCursor === 0 || stale || this.needFull;
    let unreadable = 0;

    if (full) {
      for (const k of await ctx.store.list('commits/')) {
        const [, item, id] = k.key.split('/');
        wanted.push({ kind: 'c', item, id });
      }
      for (const k of await ctx.store.list('overlays/')) {
        const [, item, tail] = k.key.split('/');
        const m = /^(.+)-(\d{5})$/.exec(tail);
        if (m) wanted.push({ kind: 'o', item, id: m[1], gen: Number(m[2]), key: k.key });
      }
      for (const k of await ctx.store.list('gc/')) wanted.push({ kind: 'g', key: k.key });
      for (const k of await ctx.store.list('inbox/', `inbox/${pad(Math.max(0, this.inboxCursor - CURSOR_MARGIN_MS))}`)) {
        const m = INBOX_RE.exec(k.key);
        if (m) newestMarker = Math.max(newestMarker, Number(m[1]));
      }
    } else {
      for (const k of await ctx.store.list('inbox/', `inbox/${pad(Math.max(0, this.inboxCursor - CURSOR_MARGIN_MS))}`)) {
        const m = INBOX_RE.exec(k.key);
        if (!m) continue;
        newestMarker = Math.max(newestMarker, Number(m[1]));
        const [, , , kind, a, b] = m;
        if (kind === 'c') wanted.push({ kind: 'c', item: a, id: b });
        else if (kind === 'o') {
          const mm = /^(.+)-(\d{5})$/.exec(b);
          if (mm) wanted.push({ kind: 'o', item: a, id: mm[1], gen: Number(mm[2]), key: K.overlay(a, mm[1], Number(mm[2])) });
        } else wanted.push({ kind: 'g', key: `gc/${a}/${b}` });
      }
    }

    const touched = new Set<string>();
    const report: PullReport = { fetched: 0, overlays: 0, merged: 0, touched: [], conflicts: [] };

    // commits
    const needC = wanted.filter((w): w is Extract<Wanted, { kind: 'c' }> => w.kind === 'c');
    const seenC = new Set<string>();
    const alreadyKnown: Commit[] = [];
    const toFetchC = needC.filter(w => {
      if (seenC.has(w.id)) return false;
      seenC.add(w.id);
      if (this.g.has(w.id)) {
        if (!this.pushed.has(w.id)) { this.pushed.add(w.id); alreadyKnown.push(this.g.get(w.id)!); }
        return false;
      }
      return !this.dropped.has(w.id);
    });
    if (alreadyKnown.length) await this.persist.markPushed(alreadyKnown);
    const got = await mapLimit(toFetchC, 8, async w => {
      try {
        const blob = await ctx.store.get(K.commit(w.item, w.id));
        if (!blob) { unreadable++; return null; }
        return await ctx.sealer.openJson<Commit>(blob);
      } catch { unreadable++; return null; } // one bad object must not stop the others
    });
    for (const c of got) {
      if (!c || this.g.has(c.id)) continue;
      this.g.add(c);
      this.pushed.add(c.id);
      await this.persist.putCommit(c, true);
      touched.add(c.item);
      report.fetched++;
    }
    this.order = this.order.filter(i => !this.pushed.has(i));

    // overlays
    const needO = wanted.filter((w): w is Extract<Wanted, { kind: 'o' }> => w.kind === 'o');
    const bestO = new Map<string, Extract<Wanted, { kind: 'o' }>>();
    for (const w of needO) {
      const cur = bestO.get(w.id);
      if (!cur || cur.gen < w.gen) bestO.set(w.id, w);
    }
    const applied: Commit[] = [];
    await mapLimit([...bestO.values()], 8, async w => {
      const cur = this.g.get(w.id);
      if (cur && (cur.subsumed?.length ?? 0) >= w.gen) return;
      try {
        const blob = await ctx.store.get(w.key);
        if (!blob) { unreadable++; return; }
        applied.push(await ctx.sealer.openJson<Commit>(blob));
      } catch { unreadable++; }
    });
    for (const o of applied) {
      const cur = this.g.get(o.id);
      if (cur && (cur.subsumed?.length ?? 0) >= (o.subsumed?.length ?? 0)) continue;
      this.g.add(o);
      this.pushed.add(o.id);
      await this.persist.putCommit(o, true);
      touched.add(o.item);
      report.overlays++;
    }

    // gc manifests: forget dropped commits once nothing local builds on them
    const newGc = wanted.filter((w): w is Extract<Wanted, { kind: 'g' }> => w.kind === 'g' && !this.gcSeen.has(w.key));
    let gcChanged = false;
    for (const w of newGc) {
      try {
        const blob = await ctx.store.get(w.key);
        if (!blob) { unreadable++; continue; }
        const { drop } = await ctx.sealer.openJson<{ drop: string[] }>(blob);
        for (const id of drop) this.dropped.add(id);
        this.gcSeen.add(w.key);
        gcChanged = true;
      } catch { unreadable++; }
    }
    if (gcChanged) {
      await this.persist.setMeta('gcSeen', [...this.gcSeen]);
      await this.persist.setMeta('dropped', [...this.dropped]);
    }
    const removable: Commit[] = [];
    for (const id of this.dropped) {
      const c = this.g.get(id);
      if (c && this.pushed.has(id) && this.g.children(id).length === 0) removable.push(c);
    }
    for (const c of removable) { this.g.remove(c.id); touched.add(c.item); }
    if (removable.length) await this.persist.removeCommits(removable);

    for (const item of touched) {
      report.merged += await this.autoMerge(item);
      if (this.g.heads(item).length > 1) report.conflicts.push(item);
    }
    this.inboxCursor = newestMarker;
    this.lastPullAt = now;
    // something could not be read: do a full listing next time instead of trusting the cursor
    this.needFull = unreadable > 0;
    await this.persist.setMeta('needFull', this.needFull);
    await this.persist.setMeta('inboxCursor', this.inboxCursor);
    await this.persist.setMeta('lastPullAt', this.lastPullAt);
    report.touched = [...touched];
    this.emit(touched);
    return report;
  }

  /** Reduce history (ADR 0006). Safe to run on any Device; run after a sync. */
  async compact(ctx: SyncContext): Promise<{ dropped: number; overlays: number }> {
    const now = (ctx.now ?? Date.now)();
    const serverNow = now + (await this.storeClockOffset(ctx));
    const recs: DeviceRecord[] = [];
    for (const k of await ctx.store.list('devices/')) {
      const blob = await ctx.store.get(k.key);
      if (blob) recs.push(await ctx.sealer.openJson<DeviceRecord>(blob));
    }
    const live = recs.filter(r => serverNow - r.at <= STALE_MS);
    const canDropFor = (item: string) => (id: string) => {
      if (!this.pushed.has(id)) return false;
      return live.every(r => {
        const hs = r.seen[item];
        if (!hs) return true;
        return hs.some(h => h !== id && this.g.ancestors(h).has(id));
      });
    };
    let dropped = 0;
    let overlays = 0;
    for (const item of [...this.g.byItem.keys()]) {
      const head = this.localHead.get(item);
      const purged = this.g.heads(item).length === 1 && head !== undefined && this.g.get(head)?.kind === 'purge' && serverNow - this.g.get(head)!.ts > 7 * DAY;
      const plan = planCompaction(this.g, item, serverNow, canDropFor(item), { purged });
      if (!plan.drop.length) continue;
      for (const o of plan.overlays) {
        // write the new overlay first and only then remove the older generations: a crash in between loses nothing
        const gen = o.subsumed!.length;
        const keep = K.overlay(item, o.id, gen);
        const older = (await ctx.store.list(`overlays/${item}/${o.id}-`)).filter(k => k.key !== keep);
        await ctx.store.put(keep, await ctx.sealer.sealJson(o));
        for (const k of older) await ctx.store.delete(k.key);
        await ctx.store.put(K.inbox(serverNow, this.deviceId, 'o', item, `${o.id}-${String(gen).padStart(5, '0')}`), new Uint8Array(1));
        this.g.add(o);
        this.pushed.add(o.id);
        await this.persist.putCommit(o, true);
        overlays++;
      }
      const name = `${this.deviceId}-${serverNow}`;
      await ctx.store.put(K.gc(item, this.deviceId, serverNow), await ctx.sealer.sealJson({ drop: plan.drop }));
      await ctx.store.put(K.inbox(serverNow, this.deviceId, 'g', item, name), new Uint8Array(1));
      this.gcSeen.add(K.gc(item, this.deviceId, serverNow));
      const gone: Commit[] = [];
      for (const id of plan.drop) {
        await ctx.store.delete(K.commit(item, id));
        for (const k of await ctx.store.list(`overlays/${item}/${id}-`)) await ctx.store.delete(k.key);
        this.dropped.add(id);
        const c = this.g.get(id);
        if (c) { gone.push(c); this.g.remove(id); }
        dropped++;
      }
      if (gone.length) await this.persist.removeCommits(gone);
    }
    // markers older than 60 days are pointless: any Device that old does a full reconcile anyway
    const cutoff = serverNow - 60 * DAY;
    for (const k of await ctx.store.list('inbox/')) {
      const m = INBOX_RE.exec(k.key);
      if (m && Number(m[1]) < cutoff) await ctx.store.delete(k.key); else if (m) break;
    }
    await this.persist.setMeta('dropped', [...this.dropped]);
    await this.persist.setMeta('gcSeen', [...this.gcSeen]);
    return { dropped, overlays };
  }
}
