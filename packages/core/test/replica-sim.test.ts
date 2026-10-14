// Randomised multi-device simulation of the sync protocol (ported from the design spike).
// Invariants after everyone is online and has resolved remaining conflicts:
//  - every Device shows the same text for every item and has a single head,
//  - no inserted line is lost unless a person deleted it or discarded it in a resolution.
import { describe, expect, it } from 'vitest';
import { Sealer } from '../src/crypto.ts';
import { MemPersist } from '../src/persist.ts';
import { Replica, type SyncContext } from '../src/replica.ts';
import { MemStore } from '../src/store.ts';
import { unionText } from '../src/merge.ts';
import { DAY, HOUR, MIN } from '../src/util.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Cfg { devices: number; items: number; steps: number; compaction: boolean; skewMs: number; staleDevice: boolean; avgStepMs: number }

async function run(seed: number, cfg: Cfg) {
  const R = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const store = new MemStore();
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const sealer = new Sealer(key);
  let clock = 1_800_000_000_000;
  store.clock = () => clock;
  const devs = await Promise.all(Array.from({ length: cfg.devices }, async (_, i) => ({
    r: await Replica.open(new MemPersist(), `dev${i}`, `Device ${i}`),
    skew: Math.round((R() * 2 - 1) * cfg.skewMs),
    offlineUntil: 0,
  })));
  const ctxOf = (d: (typeof devs)[number]): SyncContext => ({ store, sealer, now: () => clock + d.skew });
  const items = Array.from({ length: cfg.items }, (_, i) => `item-${i}`);
  const ledger = { ins: new Map<string, string>(), del: new Set<string>(), lost: new Set<string>() };
  let tok = 0;
  const sync = async (d: (typeof devs)[number]) => {
    await d.r.pull(ctxOf(d));
    await d.r.push(ctxOf(d));
  };

  let staleStarted = false;
  let droppedTotal = 0;
  let manual = 0;
  for (let s = 0; s < cfg.steps; s++) {
    clock += Math.round(R() * 2 * cfg.avgStepMs);
    const d = pick(devs);
    if (cfg.staleDevice && d.r.deviceId === 'dev3' && !staleStarted && clock > 1_800_000_000_000 + 40 * DAY) {
      staleStarted = true;
      d.offlineUntil = clock + 70 * DAY;
    }
    const online = d.offlineUntil <= clock;
    const x = R();
    if (x < 0.62) {
      const item = pick(items);
      const cur = d.r.text(item);
      const lines = cur === null ? [] : cur.split('\n').filter(l => l.length);
      const k = R();
      if (lines.length === 0 || k < 0.5) {
        const t = `T${d.r.deviceId}.${tok++}`;
        ledger.ins.set(t, item);
        lines.splice(Math.floor(R() * (lines.length + 1)), 0, t);
      } else if (k < 0.78) {
        const i = Math.floor(R() * lines.length);
        ledger.del.add(lines[i]);
        const t = `T${d.r.deviceId}.${tok++}`;
        ledger.ins.set(t, item);
        lines[i] = t;
      } else {
        const i = Math.floor(R() * lines.length);
        ledger.del.add(lines[i]);
        lines.splice(i, 1);
      }
      await d.r.commit(item, lines.join('\n'), clock + d.skew);
    } else if (x < 0.86) {
      if (online) await sync(d);
    } else if (x < 0.9) {
      if (online) {
        const item = items.find(i => d.r.hasConflict(i));
        if (item) {
          const heads = d.r.g.heads(item);
          const keep = pick(heads);
          const all = new Set(heads.flatMap(h => d.r.g.text(h) ?? []));
          const kept = new Set(d.r.g.get(keep)!.kind === 'purge' ? [] : d.r.g.text(keep) ?? []);
          for (const t of all) if (!kept.has(t)) ledger.lost.add(t);
          manual++;
          await d.r.resolve(item, d.r.g.get(keep)!.kind === 'purge' ? null : (d.r.g.text(keep) ?? []).join('\n'), clock + d.skew);
        }
      }
    } else if (x < 0.92 && cfg.compaction) {
      if (online) { await sync(d); droppedTotal += (await d.r.compact(ctxOf(d))).dropped; }
    }
  }

  // settle
  for (const d of devs) d.offlineUntil = 0;
  for (let round = 0; round < 30; round++) {
    let changed = false;
    for (const d of devs) {
      clock += MIN;
      const before = d.r.order.length;
      await d.r.pull(ctxOf(d), { full: round === 0 });
      for (const item of items) {
        if (!d.r.hasConflict(item)) continue;
        const heads = d.r.g.heads(item);
        const live = heads.filter(h => d.r.g.get(h)!.kind !== 'purge');
        if (live.length === 0) { await d.r.resolve(item, null, clock + d.skew); continue; }
        let acc = (d.r.g.text(live[0]) ?? []).join('\n');
        for (const h of live.slice(1)) acc = unionText(acc, null, (d.r.g.text(h) ?? []).join('\n'));
        await d.r.resolve(item, acc, clock + d.skew);
      }
      await d.r.push(ctxOf(d));
      if (d.r.order.length !== before) changed = true;
    }
    if (!changed && devs.every(d => items.every(i => !d.r.hasConflict(i)))) {
      // one more full pull per device to make sure all merges converged
      let more = false;
      for (const d of devs) { const rep = await d.r.pull(ctxOf(d), { full: true }); await d.r.push(ctxOf(d)); if (rep.fetched || rep.merged) more = true; }
      if (!more) break;
    }
  }

  const out = { silentLoss: 0, duplicated: 0, textMismatch: 0, multiHead: 0, unreadable: 0, tokens: ledger.ins.size, dropped: droppedTotal, manual, merges: 0, amends: 0, snapshotOnPush: 0 };
  const final = new Map<string, number>();
  for (const item of items) {
    const texts = devs.map(d => d.r.text(item));
    if (new Set(texts.map(t => t ?? '\u0000')).size > 1) out.textMismatch++;
    for (const d of devs) if (d.r.g.heads(item).length > 1) out.multiHead++;
    for (const d of devs) if (d.r.headId(item) && d.r.text(item) === null && !d.r.isPurged(item)) out.unreadable++;
    for (const l of (texts[0] ?? '').split('\n')) if (l) final.set(l, (final.get(l) ?? 0) + 1);
  }
  for (const [t] of ledger.ins) {
    const c = final.get(t) ?? 0;
    if (c === 0 && !ledger.del.has(t) && !ledger.lost.has(t)) out.silentLoss++;
    if (c > 1) out.duplicated++;
  }
  for (const d of devs) { out.merges += d.r.stats.merges; out.amends += d.r.stats.amends; out.snapshotOnPush += d.r.stats.snapshotOnPush; }
  return out;
}

const base: Cfg = { devices: 4, items: 6, steps: 500, compaction: false, skewMs: 0, staleDevice: false, avgStepMs: 4 * HOUR };

describe('replica convergence', () => {
  for (const [name, cfg] of [
    ['plain sync', base],
    ['with compaction', { ...base, compaction: true, avgStepMs: 8 * HOUR, steps: 700 }],
    ['clock skew of +-3h', { ...base, skewMs: 3 * HOUR }],
    ['a device offline for 70 days', { ...base, compaction: true, staleDevice: true, avgStepMs: 8 * HOUR, steps: 700 }],
  ] as [string, Cfg][]) {
    it(`${name}: converges and loses nothing`, async () => {
      let merges = 0;
      let dropped = 0;
      let manual = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const r = await run(seed, cfg);
        merges += r.merges;
        dropped += r.dropped;
        manual += r.manual;
        expect(r, `seed ${seed}`).toMatchObject({ silentLoss: 0, duplicated: 0, textMismatch: 0, multiHead: 0, unreadable: 0 });
      }
      expect(merges).toBeGreaterThan(0);
      expect(manual).toBeGreaterThan(0);
      if (cfg.compaction) expect(dropped).toBeGreaterThan(0);
    });
  }
});
