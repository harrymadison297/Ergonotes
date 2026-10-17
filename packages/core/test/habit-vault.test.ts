// ADR 0013: a Habit is a note that records only what was done; the vault computes the rest.
import { describe, expect, it } from 'vitest';
import { MemFs } from '../src/vaultfs.ts';
import { MemPersist } from '../src/persist.ts';
import { Vault } from '../src/vault.ts';
import { addDays } from '../src/habit.ts';

const KDF = { m: 256, t: 1, p: 1 };
const T = '2026-10-17';

async function open() {
  const fs = new MemFs();
  const v = await Vault.open({ persist: new MemPersist(), fs, kdf: KDF, defaultDeviceName: 'A', settleMs: 0, watchMs: 0, now: () => Date.parse('2026-10-17T12:00:00Z') });
  await v.createVault('correct horse battery staple');
  return { v, fs };
}
const file = (fs: MemFs, path: string) => new TextDecoder().decode(fs.files.get(path)!.data);

describe('creating a habit', () => {
  it('is a note in Habits with its target in the frontmatter and an empty log', async () => {
    const { v, fs } = await open();
    const h = await v.createHabit({ title: 'Drink water', target: 8, per: 1, start: T, description: 'Stay hydrated.' });
    expect(h.filePath).toBe('Habits/Drink water.md');
    const text = file(fs, 'Habits/Drink water.md');
    expect(text).toMatch(/habit: true/);
    expect(text).toMatch(/target: 8/);
    expect(text).toMatch(/per: 1/);
    expect(text).toMatch(/start: 2026-10-17/);
    expect(text.endsWith('Stay hydrated.\n\n## Log\n')).toBe(true);
    const list = await v.habits(T);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: h.id, title: 'Drink water', target: 8, per: 1, archived: false });
    expect(list[0].status.left).toBe(8);
  });

  it('puts every habit in the same folder, and refuses numbers it cannot judge', async () => {
    const { v } = await open();
    await v.createHabit({ title: 'A', target: 1, per: 1 });
    const b = await v.createHabit({ title: 'B', target: 2, per: 3 });
    expect(b.filePath).toBe('Habits/B.md');
    expect((await v.listItems()).filter(i => i.type === 'folder' && i.title === 'Habits')).toHaveLength(1);
    await expect(v.createHabit({ title: 'C', target: 0, per: 1 })).rejects.toThrow(/between 1 and 99/);
    await expect(v.createHabit({ title: 'C', target: 1, per: 4 })).rejects.toThrow(/1, 3, 5 or 7/);
  });

  it('is not made of a note that is not one', async () => {
    const { v } = await open();
    const n = await v.createNote({ title: 'Plain', body: 'x' });
    expect(await v.habit(n.id, T)).toBeNull();
    await expect(v.checkInHabit(n.id, { date: T })).rejects.toThrow(/not a habit/);
  });
});

describe('what the person did', () => {
  it('is written as a line of the log, and nothing else is written', async () => {
    const { v, fs } = await open();
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: addDays(T, -2), time: '07:10', text: 'easy 5 km' });
    await v.checkInHabit(h.id, { date: addDays(T, -1) });
    const text = file(fs, 'Habits/Run.md');
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
    const h = await v.createHabit({ title: 'Read', target: 2, per: 1, start: T });
    await v.checkInHabit(h.id, { date: T, time: '08:00', text: 'first' });
    await v.checkInHabit(h.id, { date: T, time: '21:00', text: 'second' });
    await v.undoCheckIn(h.id, T);
    expect((await v.habit(h.id, T))!.checkIns.map(c => c.text)).toEqual(['first']);
    await v.undoCheckIn(h.id, addDays(T, -5)); // nothing that day: nothing happens
  });

  it('takes a remark on a day, with or without a check-in', async () => {
    const { v } = await open();
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -3) });
    await v.setHabitRemark(h.id, addDays(T, -1), 'rain, stayed in');
    expect((await v.habit(h.id, T))!.remarks).toEqual([expect.objectContaining({ date: addDays(T, -1), text: 'rain, stayed in' })]);
    await v.setHabitRemark(h.id, addDays(T, -1), '');
    expect((await v.habit(h.id, T))!.remarks).toEqual([]);
  });

  it('says it is behind after missed days, with words that grow firmer', async () => {
    const { v } = await open();
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

describe('the calendar', () => {
  it('counts check-in lines as done tasks on their @done day, and gives the habit days', async () => {
    const { v } = await open();
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.checkInHabit(h.id, { date: addDays(T, -2), time: '07:10' });
    await v.checkInHabit(h.id, { date: T, time: '06:50' });
    const c = await v.calendar(addDays(T, -3), addDays(T, 2), T);
    expect(c.tasks.filter(t => t.doneAt).map(t => t.doneAt!.slice(0, 10)).sort()).toEqual([addDays(T, -2), T]);
    expect(c.habits.map(x => [x.date, x.state])).toEqual([[addDays(T, -2), 'met'], [addDays(T, -1), 'behind'], [T, 'met']]);
    expect(c.habits.every(x => x.title === 'Run')).toBe(true);
  });

  it('leaves an archived habit out', async () => {
    const { v } = await open();
    const h = await v.createHabit({ title: 'Run', target: 1, per: 1, start: addDays(T, -2) });
    await v.updateHabit(h.id, { archived: true });
    expect((await v.calendar(addDays(T, -3), T, T)).habits).toEqual([]);
  });
});
