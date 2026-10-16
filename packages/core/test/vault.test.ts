import { describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import { MemFs } from '../src/vaultfs.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const shared = new Map<string, MemStore>();

async function open(name: string, now?: () => number) {
  const persist = new MemPersist();
  const v = await Vault.open({
    persist, kdf: KDF, now, defaultDeviceName: name, settleMs: 0,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return shared.get(cfg.path)!; },
  });
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
    // a trashed folder is its notes in the Trash; the directory is gone from the vault
    expect((await v.getNote(n.id))!.inTrash).toBe(true);
    expect((await v.listItems()).some(i => i.id === f.id)).toBe(false);
    expect((await v.search('kickoff'))).toHaveLength(0);
    // undoing the folder's deletion brings its notes back where they were
    await v.restore(f.id);
    expect((await v.getNote(n.id))!.inTrash).toBe(false);
    expect((await v.getNote(n.id))!.filePath).toBe('Projects/Acme/Kickoff.md');
    expect((await v.listItems()).some(i => i.id === f.id)).toBe(true);
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

  it('links are standard Markdown: backlinks and the links themselves follow a rename', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createNote({ title: 'Alpha', body: 'a' });
    const b = await v.createNote({ title: 'Beta', body: 'see [Alpha](Alpha.md) and [[Alpha]]' });
    expect((await v.getNote(a.id))!.backlinks.map(l => l.id)).toEqual([b.id]);
    await v.rename(a.id, 'Alpha prime');
    expect((await v.getNote(a.id))!.backlinks.map(l => l.id)).toEqual([b.id]);
    expect((await v.getNote(b.id))!.links[0].title).toBe('Alpha prime');
    expect((await v.getNote(b.id))!.body).toBe('see [Alpha prime](Alpha%20prime.md) and [[Alpha prime]]');
    const res = await v.importMarkdown([
      { path: 'vault/Ideas/One.md', content: '---\ntags: [x, y]\n---\n# One\nsee [[Two]]' },
      { path: 'vault/Ideas/Two.md', content: 'second' },
    ]);
    expect(res.notes).toBe(2);
    const one = (await v.listItems()).find(i => i.title === 'One')!;
    const two = (await v.listItems()).find(i => i.title === 'Two')!;
    expect(one.tags).toEqual(['x', 'y']);
    expect((await v.getNote(one.id))!.links.map(l => l.id)).toEqual([two.id]);
    // the file is what was imported, byte for byte
    expect((await v.getNote(one.id))!.body).toBe('# One\nsee [[Two]]');
  });

  it('imports a dropped folder: notes, the attachments beside them with their places kept, and counts what it leaves', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const folder = await v.createFolder({ title: 'Drop here' });
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64');
    const res = await v.importFiles([
      { path: 'Trip/Plan.md', content: 'see ![map](map.png)' },
      { path: 'Trip/map.png', data: png },
      { path: 'Trip/deep/Notes.md', content: 'x' },
      { path: 'Trip/run.exe', data: 'AAAA' },
      { path: 'Trip/package.json', content: '{}' },
    ], folder.id);
    expect(res).toMatchObject({ notes: 2, files: 1, skipped: 2, folders: 2 });
    const plan = (await v.listItems()).find(i => i.title === 'Plan')!;
    expect(plan.filePath).toBe('Drop here/Trip/Plan.md');
    // the picture is where the note expects it
    expect((await v.getFileByPath('Drop here/Trip/map.png'))?.data).toBe(png);
    expect((await v.listItems()).filter(i => i.type === 'folder').map(i => i.filePath)).toEqual(expect.arrayContaining(['Drop here/Trip', 'Drop here/Trip/deep']));
    // no target folder: the top of the Vault
    await v.importFiles([{ path: 'Loose.md', content: 'l' }], null);
    expect((await v.listItems()).find(i => i.title === 'Loose')?.filePath).toBe('Loose.md');
  });

  it('daily note is created once per date from the daily template', async () => {
    const v = await open('A', () => Date.parse('2026-10-14T09:30:00'));
    await v.createVault(PASSWORD);
    const d1 = await v.dailyNote('2026-10-14');
    const d2 = await v.dailyNote('2026-10-14');
    expect(d2.id).toBe(d1.id);
    const doc = await v.getNote(d1.id);
    expect(doc!.path.map(p => p.title)).toEqual(['Daily']);
    expect(doc!.body).toContain('## Plan');
  });

  it('exports markdown without internal ids and self-contained html', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createNote({ title: 'Alpha', body: 'x' });
    const b = await v.createNote({ title: 'Beta', body: 'link [Alpha](Alpha.md)\n\n- [ ] todo' });
    const md = await v.exportNote(b.id, 'md');
    expect(md.content).toContain('link Alpha');
    expect(md.content).not.toContain(a.id);
    expect(md.content).not.toContain('Alpha.md');
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

  it('moves a folder with everything in it and keeps the links between notes working', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const a = await v.createFolder({ title: 'A' });
    const b = await v.createFolder({ title: 'B' });
    const x = await v.createNote({ parent: a.id, title: 'X', body: 'one' });
    const y = await v.createNote({ parent: a.id, title: 'Y', body: 'to [X](X.md)' });
    const z = await v.createNote({ parent: b.id, title: 'Z', body: 'to [X](../A/X.md) and [[Y]]' });
    await expect(v.move(a.id, a.id)).rejects.toThrow();
    await v.move(a.id, b.id);
    expect((await v.getNote(x.id))!.filePath).toBe('B/A/X.md');
    expect((await v.getNote(y.id))!.body).toBe('to [X](X.md)');
    expect((await v.getNote(z.id))!.body).toBe('to [X](A/X.md) and [[Y]]');
    expect((await v.getNote(x.id))!.backlinks.map(l => l.id).sort()).toEqual([y.id, z.id].sort());
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
    const v = await open('A', () => new Date(2026, 9, 14, 23, 30).getTime());
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Late' });
    const cal = await v.calendar('2026-10-14T00:00', '2026-10-14T23:59');
    expect(cal.notes.map(x => x.id)).toContain(n.id);
  });

  it('does not purge the Trash because a device clock is far in the future', async () => {
    const store = new MemStore();
    shared.set('s4', store);
    let skew = 0;
    const v = await open('A', () => Date.now() + skew);
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

describe('files', () => {
  it('lists attachments with their size and the note that uses them', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const data = Buffer.from('hello,world\n1,2\n').toString('base64');
    const f = await v.addFile({ name: 'data.csv', mime: 'text/csv', data });
    const n = await v.createNote({ title: 'Uses file', body: `[data.csv](${f.path})` });
    const files = await v.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ id: f.id, name: 'data.csv', path: 'attachments/data.csv', mime: 'text/csv', noteId: n.id, noteTitle: 'Uses file' });
    expect(files[0].size).toBe(16);
  });
});

describe('search hits', () => {
  it('returns folders by name and notes with the folder path and the passage that matched', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const items = await v.listItems();
    const projects = items.find(i => i.title === 'Projects')!;
    const acme = await v.createFolder({ title: 'Acme Corp', parent: projects.id });
    const long = `${'Intro words. '.repeat(30)}The quarterly zebrafish report is due on Friday.${' More words.'.repeat(30)}`;
    const n = await v.createNote({ parent: acme.id, title: 'Plan', body: long });

    const byContent = await v.searchHits('zebrafish');
    expect(byContent).toHaveLength(1);
    expect(byContent[0]).toMatchObject({ id: n.id, type: 'note' });
    expect(byContent[0].path.map(p => p.title)).toEqual(['Projects', 'Acme Corp']);
    expect(byContent[0].context).toContain('zebrafish');
    expect(byContent[0].context.length).toBeLessThan(200);

    const byFolder = await v.searchHits('acme');
    expect(byFolder[0]).toMatchObject({ id: acme.id, type: 'folder', context: '' });
    expect(byFolder[0].path.map(p => p.title)).toEqual(['Projects']);

    await v.trash(n.id);
    expect(await v.searchHits('zebrafish')).toHaveLength(0);
    expect(await v.searchHits('   ')).toEqual([]);
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
