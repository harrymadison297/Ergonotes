// The made-up vault of the web demo: it must open as a real vault, with notes, tasks, events and habits that look lived in.
import { describe, expect, it } from 'vitest';
import { MemFs, MemPersist, Vault } from '@ergonotes/core';
import { buildSeed, seedId } from '../src/demo/seed';

const NOW = new Date(2026, 9, 18, 14, 30);
const day = (n: number) => { const d = new Date(2026, 9, 18 + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function open() {
  const fs = new MemFs();
  for (const f of buildSeed(NOW)) fs.put(f.path, f.text, f.mtime);
  const vault = await Vault.open({ fs, persist: new MemPersist(), passwordOptional: true, settleMs: 0, watchMs: 0 });
  await vault.createVault('', { noPassword: true });
  return vault;
}

describe('the demo seed', () => {
  it('gives every file a stable id', () => {
    expect(seedId('a')).toBe(seedId('a'));
    expect(seedId('a')).not.toBe(seedId('b'));
    expect(seedId('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const files = buildSeed(NOW);
    expect(new Set(files.map(f => f.path)).size).toBe(files.length);
  });

  it('opens as a vault of PARA folders with pinned, private and tagged notes', async () => {
    const v = await open();
    const items = await v.listItems();
    const notes = items.filter(i => i.type === 'note' && !i.template);
    expect(notes.length).toBeGreaterThanOrEqual(20);
    for (const f of ['Inbox', 'Projects', 'Areas', 'Resources', 'Archive']) expect(items.some(i => i.type === 'folder' && i.title === f)).toBe(true);
    expect(items.some(i => i.type === 'folder' && i.title === 'Ergonotes demo')).toBe(true);
    expect(notes.some(i => i.pinned)).toBe(true);
    expect(notes.filter(i => i.private).map(i => i.title)).toEqual(['Private journal']);
    // the habits are not notes
    expect(notes.some(i => i.title === 'Run')).toBe(false);
  });

  it('has tasks due around today and events ahead', async () => {
    const v = await open();
    const tasks = await v.tasks();
    const dues = tasks.filter(t => !t.done && t.due).map(t => t.due!.slice(0, 10));
    expect(dues).toContain(day(0));
    expect(dues.some(d => d > day(0))).toBe(true);
    const cal = await v.calendar(day(0), day(10));
    expect(JSON.stringify(cal)).toContain('Launch day');
  });

  it('has four habits with months of history and something left to do today', async () => {
    const v = await open();
    const habits = await v.habits(day(0));
    expect(habits.map(h => h.title).sort()).toEqual(["Drink 2L of water", "Read 20 pages", "Run", "Write the day's journal"].sort());
    for (const h of habits) {
      const detail = await v.habit(h.id, day(0));
      expect(detail!.checkIns.length).toBeGreaterThan(30);
    }
    const water = await v.habit(habits.find(h => h.title.startsWith('Drink'))!.id, day(0));
    expect(water!.checkIns.some(c => c.date === day(0))).toBe(true);
    const journal = await v.habit(habits.find(h => h.title.startsWith('Write'))!.id, day(0));
    expect(journal!.checkIns.some(c => c.date === day(0))).toBe(false);
  });
});
