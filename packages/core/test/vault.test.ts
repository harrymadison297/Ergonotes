import { describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const shared = new Map<string, MemStore>();

async function open(name: string, store?: MemStore, now?: () => number) {
  const persist = new MemPersist();
  const v = await Vault.open({
    persist, kdf: KDF, now, defaultDeviceName: name,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return shared.get(cfg.path)!; },
  });
  void store;
  return v;
}
const cfgFor = (id: string): StoreConfig => ({ type: 'folder', path: id });

describe('Vault', () => {
  it('creates default PARA folders, an Inbox capture target, and sample templates', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const items = await v.listItems();
    const folders = items.filter(i => i.type === 'folder').map(i => i.title).sort();
    expect(folders).toEqual(['Archive', 'Areas', 'Inbox', 'Projects', 'Resources', 'Templates']);
    expect((await v.templates()).length).toBeGreaterThanOrEqual(3);
    const n = await v.capture({ text: 'Remember the milk\nand eggs' });
    const inbox = items.find(i => i.title === 'Inbox')!;
    expect(n.parent).toBe(inbox.id);
    expect(n.title).toBe('Remember the milk');
  });

  it('rejects short passwords and a wrong password on unlock', async () => {
    const v = await open('A');
    await expect(v.createVault('short')).rejects.toThrow(/at least 12/);
    await v.createVault(PASSWORD);
    await v.lock();
    await expect(v.unlock('wrong password here!!')).rejects.toThrow(/Wrong password/);
    await v.unlock(PASSWORD);
    expect((await v.status()).state).toBe('ready');
  });

  it('recreates the Inbox on capture when it was deleted and honours the setting', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const inbox = (await v.listItems()).find(i => i.title === 'Inbox')!;
    await v.purge(inbox.id);
    const n = await v.capture({ text: 'x' });
    const folders = (await v.listItems()).filter(i => i.title === 'Inbox' && i.type === 'folder');
    expect(folders).toHaveLength(1);
    expect(n.parent).toBe(folders[0].id);
    const projects = (await v.listItems()).find(i => i.title === 'Projects')!;
    await v.setSettings({ captureFolder: projects.id });
    expect((await v.capture({ text: 'y' })).parent).toBe(projects.id);
  });

  it('organises: move, tags, trash/restore, folder trash hides children', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const projects = (await v.listItems()).find(i => i.title === 'Projects')!;
    const f = await v.createFolder({ title: 'Acme', parent: projects.id });
    const n = await v.createNote({ parent: f.id, title: 'Kickoff', body: 'hello' });
    await v.setTags(n.id, ['#Work/Acme', 'work/acme', 'idea']);
    expect((await v.getNote(n.id))!.tags).toEqual(['Work/Acme', 'idea', 'work/acme']);
    await expect(v.move(f.id, n.id)).rejects.toThrow();
    await v.trash(f.id);
    expect((await v.getNote(n.id))!.inTrash).toBe(true);
    expect((await v.search('kickoff'))).toHaveLength(0);
    await v.restore(f.id);
    expect((await v.getNote(n.id))!.inTrash).toBe(false);
    expect((await v.search('kickoff')).map(i => i.id)).toEqual([n.id]);
  });

  it('extracts tasks, toggles them in the note, and lists due dates on the calendar', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Plan', body: '- [ ] Call landscaper @due(2026-10-15T17:00) @flag\n- [x] Done thing\n- [ ] Loose' });
    let tasks = (await v.tasks()).filter(t => t.noteId === n.id);
    expect(tasks.map(t => [t.text, t.done, t.due, t.flag])).toEqual([
      ['Call landscaper', false, '2026-10-15T17:00', true],
      ['Loose', false, undefined, false],
      ['Done thing', true, undefined, false],
    ]);
    await v.toggleTask(n.id, 2, true);
    expect((await v.getNote(n.id))!.body).toContain('- [x] Loose');
    tasks = (await v.tasks()).filter(t => t.noteId === n.id);
    expect(tasks.filter(t => t.done)).toHaveLength(2);
    const cal = await v.calendar('2026-10-01T00:00', '2026-10-31T23:59');
    expect(cal.tasks.map(t => t.text)).toEqual(['Call landscaper']);
  });

  it('links by id: backlinks survive a rename, imports resolve [[Title]]', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createNote({ title: 'Alpha', body: 'a' });
    const b = await v.createNote({ title: 'Beta', body: `see [[${a.id}|Alpha]]` });
    expect((await v.getNote(a.id))!.backlinks.map(l => l.id)).toEqual([b.id]);
    await v.rename(a.id, 'Alpha prime');
    expect((await v.getNote(a.id))!.backlinks.map(l => l.id)).toEqual([b.id]);
    expect((await v.getNote(b.id))!.links[0].title).toBe('Alpha prime');
    const res = await v.importMarkdown([
      { path: 'vault/Ideas/One.md', content: '---\ntags: [x, y]\n---\n# One\nsee [[Two]]' },
      { path: 'vault/Ideas/Two.md', content: 'second' },
    ]);
    expect(res).toEqual({ notes: 2, folders: 2 });
    const one = (await v.listItems()).find(i => i.title === 'One')!;
    const two = (await v.listItems()).find(i => i.title === 'Two')!;
    expect(one.tags).toEqual(['x', 'y']);
    expect((await v.getNote(one.id))!.body).toContain(`[[${two.id}|Two]]`);
  });

  it('daily note is created once per date from the daily template', async () => {
    const v = await open('A', undefined, () => Date.parse('2026-10-14T09:30:00'));
    await v.createVault(PASSWORD);
    const d1 = await v.dailyNote('2026-10-14');
    const d2 = await v.dailyNote('2026-10-14');
    expect(d2.id).toBe(d1.id);
    const doc = await v.getNote(d1.id);
    expect(doc!.path.map(p => p.title)).toEqual(['Areas', 'Daily']);
    expect(doc!.body).toContain('## Plan');
  });

  it('exports markdown without internal ids and self-contained html', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createNote({ title: 'Alpha', body: 'x' });
    const b = await v.createNote({ title: 'Beta', body: `link [[${a.id}|Alpha]]\n\n- [ ] todo` });
    const md = await v.exportNote(b.id, 'md');
    expect(md.content).toContain('[[Alpha]]');
    expect(md.content).not.toContain(a.id);
    const html = await v.exportNote(b.id, 'html');
    expect(html.content).toContain('<h1>Beta</h1>');
    expect(html.content).toContain('☐ todo');
  });
});

describe('Vault fixes from review', () => {
  it('keeps the other device text as a separate note when asked to keep both', async () => {
    const store = new MemStore();
    shared.set('s3', store);
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    const n = await A.createNote({ title: 'Plan', body: 'one\n\ntwo' });
    await A.setStore(cfgFor('s3'));
    const B = await open('Phone');
    await B.joinVault(cfgFor('s3'), PASSWORD);
    await A.saveNote(n.id, { body: 'one\n\nA says two' });
    await B.saveNote(n.id, { body: 'one\n\nB says two' });
    await A.sync(); await B.sync(); await A.sync();
    await B.resolveConflict(n.id, { kind: 'both' });
    const items = await B.listItems();
    const copies = items.filter(i => i.title.startsWith('Plan (from'));
    expect(copies).toHaveLength(1);
    expect((await B.getNote(copies[0].id))!.body).toContain('A says two');
    expect((await B.getNote(n.id))!.body).toContain('B says two');
    expect((await B.getNote(n.id))!.body).not.toContain('A says two');
    expect(await B.conflicts()).toHaveLength(0);
  });

  it('stores identical files once and rejects notes in folders that do not exist', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.addFile({ name: 'x.png', mime: 'image/png', data: 'aGVsbG8=' });
    const b = await v.addFile({ name: 'copy.png', mime: 'image/png', data: 'aGVsbG8=' });
    expect(b.id).toBe(a.id);
    expect((await v.getFile(a.id))!.data).toBe('aGVsbG8=');
    await expect(v.createNote({ title: 'x', parent: 'not-a-folder' })).rejects.toThrow(/does not exist/);
  });

  it('survives a folder cycle created by two devices moving folders into each other', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createFolder({ title: 'A' });
    const b = await v.createFolder({ title: 'B', parent: a.id });
    // simulate the merged result of concurrent moves: A inside B as well
    await v['mutate'](a.id, fm => { fm.parent = b.id; });
    await expect(v.purge(a.id)).resolves.toBeUndefined();
  });

  it('renames a tag, including sub-tags, across notes', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const n1 = await v.createNote({ title: 'One', tags: ['work/acme', 'idea'] });
    const n2 = await v.createNote({ title: 'Two', tags: ['work'] });
    expect(await v.renameTag('work', 'job')).toBe(2);
    expect((await v.getNote(n1.id))!.tags).toEqual(['idea', 'job/acme']);
    expect((await v.getNote(n2.id))!.tags).toEqual(['job']);
  });

  it('puts notes on the local creation day in the calendar', async () => {
    const v = await open('A', undefined, () => new Date(2026, 9, 14, 23, 30).getTime());
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Late' });
    const cal = await v.calendar('2026-10-14T00:00', '2026-10-14T23:59');
    expect(cal.notes.map(x => x.id)).toContain(n.id);
  });

  it('does not purge the Trash because a device clock is far in the future', async () => {
    const store = new MemStore();
    shared.set('s4', store);
    let skew = 0;
    const v = await open('A', undefined, () => Date.now() + skew);
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Keep me' });
    await v.trash(n.id);
    await v.setStore(cfgFor('s4'));
    store.clock = () => Date.now(); // the Store's own clock is right
    skew = 90 * 86400e3; // this device thinks it is three months later
    await v.sync();
    expect((await v.listItems()).some(i => i.id === n.id && i.trashed)).toBe(true);
  });
});

describe('two devices', () => {
  it('sync through a shared store and surface a conflict that can be resolved', async () => {
    const store = new MemStore();
    shared.set('s', store);
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    const n = await A.createNote({ title: 'Shared', body: 'line1\nline2\nline3' });
    await A.setStore(cfgFor('s'));
    expect((await A.status()).pending).toBe(0);

    const B = await open('Phone');
    await B.joinVault(cfgFor('s'), PASSWORD);
    expect((await B.getNote(n.id))!.body).toBe('line1\nline2\nline3');

    // both edit the same line while apart
    await A.saveNote(n.id, { body: 'line1\nfrom laptop\nline3' });
    await B.saveNote(n.id, { body: 'line1\nfrom phone\nline3' });
    await A.sync();
    await B.sync();
    await A.sync();
    expect((await B.conflicts()).map(c => c.id)).toEqual([n.id]);
    const detail = (await B.conflictDetail(n.id))!;
    expect(detail.local.text).toContain('from phone');
    expect(detail.others[0].text).toContain('from laptop');
    // each device keeps showing its own text until resolved
    expect((await B.getNote(n.id))!.body).toContain('from phone');
    expect((await A.getNote(n.id))!.body).toContain('from laptop');

    await B.resolveConflict(n.id, { kind: 'combine' });
    await B.sync();
    await A.sync();
    expect(await A.conflicts()).toHaveLength(0);
    const body = (await A.getNote(n.id))!.body;
    expect(body).toContain('from laptop');
    expect(body).toContain('from phone');
  });

  it('merges non-overlapping edits automatically and a wrong password cannot join', async () => {
    const store = new MemStore();
    shared.set('s2', store);
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    const n = await A.createNote({ title: 'Doc', body: 'a\nb\nc\nd\ne' });
    await A.setStore(cfgFor('s2'));
    const B = await open('Phone');
    await expect(B.joinVault(cfgFor('s2'), 'not the right password')).rejects.toThrow(/Wrong password/);
    await B.joinVault(cfgFor('s2'), PASSWORD);
    await A.saveNote(n.id, { body: 'A\nb\nc\nd\ne' });
    await B.saveNote(n.id, { body: 'a\nb\nc\nd\nE' });
    await A.sync(); await B.sync(); await A.sync(); await B.sync();
    expect((await A.getNote(n.id))!.body).toBe('A\nb\nc\nd\nE');
    expect((await B.getNote(n.id))!.body).toBe('A\nb\nc\nd\nE');
    expect(await A.conflicts()).toHaveLength(0);
  });
});
