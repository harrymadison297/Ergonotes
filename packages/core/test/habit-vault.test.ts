// ADR 0013 and 0014: a Habit is a Markdown file in the hidden `.habits/` folder that records only what was done; the vault computes the rest.
import { describe, expect, it } from 'vitest';
import { MemFs } from '../src/vaultfs.ts';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import { addDays } from '../src/habit.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const T = '2026-10-17';
const PASSWORD = 'correct horse battery staple';
const NOW = Date.parse('2026-10-17T12:00:00Z');

async function open(name = 'A') {
  const fs = new MemFs();
  const stores = shared;
  const v = await Vault.open({
    persist: new MemPersist(), fs, kdf: KDF, defaultDeviceName: name, settleMs: 0, watchMs: 0, now: () => NOW,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return stores.get(cfg.path)!; },
  });
  return { v, fs };
}
const shared = new Map<string, MemStore>();
const cfgFor = (id: string): StoreConfig => ({ type: 'folder', path: id });
const file = (fs: MemFs, path: string) => new TextDecoder().decode(fs.files.get(path)!.data);

describe('creating a habit', () => {
  it('is a file in .habits with its target in the frontmatter and an empty log', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Drink water', target: 8, per: 1, start: T, description: 'Stay hydrated.' });
    expect(h.filePath).toBe('.habits/Drink water.md');
    const text = file(fs, '.habits/Drink water.md');
    expect(text).toMatch(/habit: true/);
    expect(text).toMatch(/target: 8/);
    expect(text).toMatch(/per: 1/);
    expect(text).toMatch(/start: 2026-10-17/);
    expect(text).not.toMatch(/_ergo/);
    expect(text.endsWith('Stay hydrated.\n\n## Log\n')).toBe(true);
    const list = await v.habits(T);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: h.id, title: 'Drink water', target: 8, per: 1, archived: false, filePath: '.habits/Drink water.md' });
    expect(list[0].status.left).toBe(8);
  });

  it('puts every habit in the same hidden folder, and refuses numbers it cannot judge', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    await v.createHabit({ title: 'A', target: 1, per: 1 });
    const b = await v.createHabit({ title: 'B', target: 2, per: 3 });
    expect(b.filePath).toBe('.habits/B.md');
    await expect(v.createHabit({ title: 'C', target: 0, per: 1 })).rejects.toThrow(/between 1 and 99/);
    await expect(v.createHabit({ title: 'C', target: 1, per: 4 })).rejects.toThrow(/1, 3, 5 or 7/);
  });

  it('gives a second habit of the same name a number', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    await v.createHabit({ title: 'Run', target: 1, per: 1 });
    expect((await v.createHabit({ title: 'Run', target: 1, per: 1 })).filePath).toBe('.habits/Run 2.md');
  });

  it('is not made of a note that is not one', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Plain', body: 'x' });
    expect(await v.habit(n.id, T)).toBeNull();
    await expect(v.checkInHabit(n.id, { date: T })).rejects.toThrow(/not a habit/);
  });

  it('is not a habit when it is an ordinary note that says habit: true outside .habits', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    fs.put('Projects/Imposter.md', '---\nhabit: true\ntarget: 1\nper: 1\n---\n\n## Log\n', Date.now() + 5);
    await v.rescan();
    expect((await v.listItems()).some(i => i.title === 'Imposter')).toBe(true);
    expect(await v.habits(T)).toEqual([]);
  });
});

describe('a habit is not a note (ADR 0014)', () => {
  it('is in no list, folder, search, tag, task or backlink of the notes', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Quokka walk', target: 1, per: 1, start: addDays(T, -1), description: 'A zebra crossing #stripes' });
    await v.checkInHabit(h.id, { date: T, time: '07:00', text: 'done with a flamingo' });
    const items = await v.listItems();
    expect(items.some(i => i.id === h.id || i.title === 'Quokka walk')).toBe(false);
    expect(items.some(i => i.type === 'folder' && i.title.startsWith('.'))).toBe(false);
    expect(await v.search('Quokka')).toEqual([]);
    expect(await v.search('flamingo')).toEqual([]);
    expect(await v.searchHits('Quokka')).toEqual([]);
    expect((await v.tags()).map(t => t.tag)).not.toContain('stripes');
    expect((await v.tasks()).filter(t => /flamingo/.test(t.text))).toEqual([]);
    expect(await v.getNote(h.id)).toBeNull();
    expect((await v.linkTargets('Quokka')).length).toBe(0);
    expect((await v.calendar(addDays(T, -3), addDays(T, 2))).tasks.filter(t => /flamingo/.test(t.text))).toEqual([]);
  });

  it('keeps its file in the folder whatever the scan makes of the other hidden folders', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1 });
    await v.rescan();
    expect(fs.files.has(h.filePath)).toBe(true);
    expect((await v.habits(T)).map(x => x.id)).toEqual([h.id]);
    expect((await v.listItems()).some(i => i.id === h.id)).toBe(false);
  });
});

describe('what the person did', () => {
  it('is written as a line of the log, and nothing else is written', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: addDays(T, -2), time: '07:10', text: 'easy 5 km' });
    await v.checkInHabit(h.id, { date: addDays(T, -1) });
    const text = file(fs, '.habits/Run.md');
    expect(text).toContain('- [x] @done(2026-10-15T07:10) easy 5 km');
    expect(text).toContain('- [x] @done(2026-10-16)');
    expect(text).not.toMatch(/miss|streak/i);
    const d = (await v.habit(h.id, T))!;
    expect(d.checkIns).toHaveLength(2);
    // the misses and the streak are computed
    expect(d.status.streak).toBe(2);
    expect(d.status.todayState).toBe('pending');
    expect(d.nudge).toBeNull();
  });

  it('counts today and says so', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Read', target: 2, per: 1, start: T });
    await v.checkInHabit(h.id, { date: T, time: '08:00' });
    expect((await v.habit(h.id, T))!.status).toMatchObject({ inWindow: 1, left: 1, doneToday: 1, todayState: 'pending' });
    await v.checkInHabit(h.id, { date: T, time: '21:00' });
    const s = (await v.habit(h.id, T))!;
    expect(s.status.todayState).toBe('met');
    expect(s.nudge?.tone).toBe('good');
  });

  it('can be taken back, the last one of a day first', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Read', target: 2, per: 1, start: T });
    await v.checkInHabit(h.id, { date: T, time: '08:00', text: 'first' });
    await v.checkInHabit(h.id, { date: T, time: '21:00', text: 'second' });
    await v.undoCheckIn(h.id, T);
    expect((await v.habit(h.id, T))!.checkIns.map(c => c.text)).toEqual(['first']);
    await v.undoCheckIn(h.id, addDays(T, -5)); // nothing that day: nothing happens
  });

  it('takes a remark on a day, with or without a check-in', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -3) });
    await v.setHabitRemark(h.id, addDays(T, -1), 'rain, stayed in');
    expect((await v.habit(h.id, T))!.remarks).toEqual([expect.objectContaining({ date: addDays(T, -1), text: 'rain, stayed in' })]);
    await v.setHabitRemark(h.id, addDays(T, -1), '');
    expect((await v.habit(h.id, T))!.remarks).toEqual([]);
  });

  it('says it is behind after missed days, with words that grow firmer', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -10) });
    await v.checkInHabit(h.id, { date: addDays(T, -10) });
    const d = (await v.habit(h.id, T))!;
    expect(d.status.missed).toBe(9);
    expect(d.nudge?.tone).toBe('firm');
    await v.updateHabit(h.id, { archived: true });
    expect((await v.habit(h.id, T))!.nudge).toBeNull();
    expect((await v.habits(T))[0].archived).toBe(true);
  });

  it('changes how the past is judged when the target changes, because nothing about it was stored', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -3) });
    await v.checkInHabit(h.id, { date: addDays(T, -3) });
    await v.checkInHabit(h.id, { date: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: addDays(T, -1) });
    expect((await v.habit(h.id, T))!.status.streak).toBe(3);
    await v.updateHabit(h.id, { target: 2 });
    expect((await v.habit(h.id, T))!.status.streak).toBe(0);
    await v.updateHabit(h.id, { target: 2, per: 3 });
    expect((await v.habit(h.id, T))!.status.todayState).toBe('met');
  });
});

describe('the days of the habits', () => {
  it('gives how each habit stood on each day, and how many check-ins were written', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: addDays(T, -2), time: '07:10' });
    await v.checkInHabit(h.id, { date: T, time: '06:50' });
    await v.checkInHabit(h.id, { date: T, time: '19:00' });
    const days = await v.habitDays(addDays(T, -3), addDays(T, 2), T);
    const mine = days.filter(x => x.habitId === h.id);
    expect(mine.map(x => [x.date, x.state, x.count])).toEqual([
      [addDays(T, -3), 'exempt', 0], [addDays(T, -2), 'met', 1], [addDays(T, -1), 'behind', 0], [T, 'met', 2],
    ]);
    expect(mine.every(x => x.title === 'Run')).toBe(true);
  });

  it('leaves an archived habit out, and the days that have not come', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.updateHabit(h.id, { archived: true });
    expect(await v.habitDays(addDays(T, -3), T, T)).toEqual([]);
    expect(await v.habitDays(addDays(T, 1), addDays(T, 5), T)).toEqual([]);
  });

  it('is not part of what the Calendar gives for the notes', async () => {
    const { v } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: T, time: '06:50' });
    const c = await v.calendar(addDays(T, -3), addDays(T, 2));
    expect(Object.keys(c).sort()).toEqual(['daily', 'events', 'notes', 'tasks']);
    expect(c.tasks.filter(t => t.doneAt)).toEqual([]);
  });
});

describe('renaming, deleting and mentioning', () => {
  it('renames the file and the links of the notes that mention it', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1 });
    expect((await v.habit(h.id, T))!.mentions).toEqual([]);
    const root = await v.createNote({ title: 'Root plan', body: 'I will [Run](.habits/Run.md "type_habit") daily', parent: null });
    expect((await v.habit(h.id, T))!.mentions).toEqual([{ id: root.id, title: 'Root plan' }]);
    await v.renameHabit(h.id, 'Jog');
    expect(fs.files.has('.habits/Jog.md')).toBe(true);
    expect(fs.files.has('.habits/Run.md')).toBe(false);
    expect((await v.habits(T))[0]).toMatchObject({ id: h.id, title: 'Jog', filePath: '.habits/Jog.md' });
    expect((await v.getNote(root.id))!.body).toBe('I will [Jog](.habits/Jog.md "type_habit") daily');
  });

  it('deletes the file and the history', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1 });
    await v.deleteHabit(h.id);
    expect(fs.files.has('.habits/Run.md')).toBe(false);
    expect(await v.habits(T)).toEqual([]);
    expect(await v.habit(h.id, T)).toBeNull();
  });
});

describe('changes made outside the app', () => {
  it('takes in a check-in typed in another editor', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: T });
    const text = file(fs, h.filePath);
    fs.put(h.filePath, `${text.replace(/\n*$/, '\n')}\n- [x] @done(${T}T06:30) typed in VS Code\n`, Date.now() + 5);
    expect(await v.rescan()).toBe(1);
    const d = (await v.habit(h.id, T))!;
    expect(d.checkIns.map(c => c.text)).toEqual(['typed in VS Code']);
    expect(d.id).toBe(h.id);
    expect(await v.rescan()).toBe(0);
  });

  it('takes in a habit file that was put in .habits, and leaves other things there alone', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    fs.put('.habits/Stretch.md', '---\nhabit: true\ntarget: 2\nper: 3\nstart: 2026-10-10\n---\n\n## Log\n', Date.now() + 5);
    fs.put('.habits/photo.png', 'xx', Date.now() + 5);
    fs.put('.habits/sub/Deep.md', '---\nhabit: true\n---\n', Date.now() + 5);
    fs.put('.habits/notes.txt', 'hello', Date.now() + 5);
    await v.rescan();
    const list = await v.habits(T);
    expect(list.map(x => [x.title, x.target, x.per])).toEqual([['Stretch', 2, 3]]);
    expect((await v.listItems()).some(i => i.title === 'Stretch' || i.title === 'Deep' || i.title === 'photo.png')).toBe(false);
    expect((await v.listFiles()).some(f => /photo|notes\.txt/.test(f.name))).toBe(false);
  });

  it('is gone from the list when its file is deleted outside, and back when the file comes back', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: T });
    await v.checkInHabit(h.id, { date: T, time: '07:00' });
    const text = file(fs, h.filePath);
    fs.files.delete(h.filePath);
    await v.rescan();
    expect(await v.habits(T)).toEqual([]);
    fs.put(h.filePath, text, Date.now() + 5);
    await v.rescan();
    const back = await v.habits(T);
    expect(back).toHaveLength(1);
    expect((await v.habit(back[0].id, T))!.checkIns).toHaveLength(1);
  });

  it('is renamed in the app when its file is renamed outside', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: T });
    const text = file(fs, h.filePath);
    fs.files.delete(h.filePath);
    fs.put('.habits/Jog.md', text, Date.now() + 5);
    await v.rescan();
    const list = await v.habits(T);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: h.id, title: 'Jog' });
  });
});

describe('two devices', () => {
  it('keep both check-ins when each checks in at once, with nobody asked to choose', async () => {
    shared.set('hab', new MemStore());
    const A = await open('Laptop');
    await A.v.createVault(PASSWORD);
    const h = await A.v.createHabit({ title: 'Run', target: 2, per: 1, start: T });
    await A.v.setStore(cfgFor('hab'));
    await A.v.sync();
    const B = await open('Phone');
    await B.v.joinVault(cfgFor('hab'), PASSWORD);
    await B.v.sync();
    expect((await B.v.habits(T)).map(x => x.title)).toEqual(['Run']);
    expect(B.fs.files.has('.habits/Run.md')).toBe(true);
    await A.v.checkInHabit(h.id, { date: T, time: '07:00', text: 'laptop' });
    await B.v.checkInHabit(h.id, { date: T, time: '07:00', text: 'phone' });
    await A.v.sync(); await B.v.sync(); await A.v.sync(); await B.v.sync();
    for (const side of [A, B]) {
      expect((await side.v.conflicts()).length).toBe(0);
      expect((await side.v.habit(h.id, T))!.checkIns.map(c => c.text).sort()).toEqual(['laptop', 'phone']);
    }
    expect(file(A.fs, '.habits/Run.md')).toBe(file(B.fs, '.habits/Run.md'));
  });

  it('carry a deletion over', async () => {
    shared.set('hab2', new MemStore());
    const A = await open('Laptop');
    await A.v.createVault(PASSWORD);
    const h = await A.v.createHabit({ title: 'Run', target: 1, per: 1 });
    await A.v.setStore(cfgFor('hab2'));
    await A.v.sync();
    const B = await open('Phone');
    await B.v.joinVault(cfgFor('hab2'), PASSWORD);
    await B.v.sync();
    await A.v.deleteHabit(h.id);
    await A.v.sync(); await B.v.sync();
    expect(await B.v.habits(T)).toEqual([]);
    expect(B.fs.files.has('.habits/Run.md')).toBe(false);
  });
});
