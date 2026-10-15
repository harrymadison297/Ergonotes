// The vault is a folder of Markdown files (ADR 0010): what the app does to the files, and what it does about
// files that changed without it.
import { describe, expect, it } from 'vitest';
import { FsPersist, MemFs } from '../src/vaultfs.ts';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const stores = new Map<string, MemStore>();

async function open(name: string, o: { fs?: MemFs; persist?: FsPersist | MemPersist; now?: () => number } = {}) {
  const fs = o.fs ?? new MemFs();
  const persist = o.persist ?? new MemPersist();
  const v = await Vault.open({
    persist, fs, kdf: KDF, defaultDeviceName: name, settleMs: 0, watchMs: 0, now: o.now,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return stores.get(cfg.path)!; },
  });
  return { v, fs, persist };
}
const cfg = (id: string): StoreConfig => ({ type: 'folder', path: id });
const byTitle = async (v: Vault, t: string) => (await v.listItems()).find(i => i.title === t && i.type === 'note')!;

const OBSIDIAN_NOTE = [
  '---', '# written by another tool', 'title: Hand written', 'tags:', '- project', '- work/acme', 'aliases: [Plan B]', 'cssclass: wide', '---',
  '# Heading', '', '* odd bullet', '* second', '', '![[diagram.png]]', '', '%%private comment%%', '', 'Wrapped paragraph that is',
  'broken across two lines.', '', '> [!note] Callout', '> inside', '', '```dataview', 'TABLE file.name', '```', '', 'Done ^block-id', '',
].join('\n');

describe('opening a folder somebody already filled', () => {
  it('takes the files as they are: titles from names, tags from frontmatter, nothing rewritten', async () => {
    const fs = new MemFs();
    fs.put('Projects/Acme/Plan.md', OBSIDIAN_NOTE);
    fs.put('Inbox/Quick thought.md', 'just a line\n');
    fs.put('Journal/2026/Oct.md', '---\r\ntags: a, b\r\n---\r\nwindows file\r\n');
    fs.put('attachments/diagram.png', 'PNGDATA');
    fs.put('.obsidian/workspace.json', '{}');
    const { v } = await open('A', { fs });
    await v.createVault(PASSWORD);
    const items = await v.listItems();
    expect(items.filter(i => i.type === 'note').map(i => i.title).sort()).toEqual(['Oct', 'Plan', 'Quick thought']);
    expect(items.filter(i => i.type === 'folder').map(i => i.filePath).sort()).toEqual(['Inbox', 'Journal', 'Journal/2026', 'Projects', 'Projects/Acme']);
    const plan = await byTitle(v, 'Plan');
    expect(plan.tags).toEqual(['project', 'work/acme']);
    expect(plan.filePath).toBe('Projects/Acme/Plan.md');
    expect((await byTitle(v, 'Oct')).tags).toEqual(['a', 'b']);
    // no default folders were added to a folder that was not empty
    expect(items.some(i => i.title === 'Areas')).toBe(false);
    // and not a byte of any file changed
    expect(fs.text('Projects/Acme/Plan.md')).toBe(OBSIDIAN_NOTE);
    expect(fs.text('Journal/2026/Oct.md')).toBe('---\r\ntags: a, b\r\n---\r\nwindows file\r\n');
    expect(fs.text('Inbox/Quick thought.md')).toBe('just a line\n');
    expect(fs.list().filter(p => !p.startsWith('.obsidian') && !p.startsWith('.trash'))).toEqual([
      'Inbox/Quick thought.md', 'Journal/2026/Oct.md', 'Projects/Acme/Plan.md', 'attachments/diagram.png',
    ]);
  });

  it('seeds the PARA folders only in an empty folder', async () => {
    const { v } = await open('A');
    await v.createVault(PASSWORD);
    expect((await v.listItems()).filter(i => i.type === 'folder').map(i => i.title).sort()).toEqual(['Archive', 'Areas', 'Inbox', 'Projects', 'Resources', 'Templates']);
  });
});

describe('editing in the app', () => {
  it('adds an id on the first save and changes only what was edited', async () => {
    const fs = new MemFs();
    fs.put('Plan.md', OBSIDIAN_NOTE);
    const { v } = await open('A', { fs });
    await v.createVault(PASSWORD);
    const n = await byTitle(v, 'Plan');
    await v.setPinned(n.id, true);
    const after = fs.text('Plan.md')!;
    expect(after).toContain(`id: ${n.id}`);
    expect(after).toContain('pinned: true');
    expect(after).toContain('# written by another tool');
    expect(after).toContain('aliases: [Plan B]');
    expect(after).toContain('cssclass: wide');
    expect(after.endsWith(OBSIDIAN_NOTE.slice(OBSIDIAN_NOTE.indexOf('# Heading')))).toBe(true);
    await v.saveNote(n.id, { body: '# Heading\n\nreplaced\n' });
    expect(fs.text('Plan.md')!.endsWith('---\n# Heading\n\nreplaced\n')).toBe(true);
    expect(fs.text('Plan.md')).toContain('cssclass: wide');
  });

  it('writes a new note as a real file in its folder, named after its title', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const projects = (await v.listItems()).find(i => i.title === 'Projects')!;
    const n = await v.createNote({ parent: projects.id, title: 'Q4: plan/budget?', body: 'hello', tags: ['finance'] });
    expect(n.filePath).toBe('Projects/Q4- plan-budget-.md');
    expect(fs.text(n.filePath)).toBe(`---\nid: ${n.id}\ntags:\n  - finance\n---\nhello`);
    const dup = await v.createNote({ parent: projects.id, title: 'Q4: plan/budget?' });
    expect(dup.filePath).toBe('Projects/Q4- plan-budget- 2.md');
  });

  it('renames the file with the title and rewrites links to it, leaving the rest of the text alone', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const projects = (await v.listItems()).find(i => i.title === 'Projects')!;
    const a = await v.createNote({ parent: projects.id, title: 'Alpha', body: 'a' });
    const b = await v.createNote({ title: 'Beta', body: 'Keep   this  spacing\n\n* [Alpha](../Projects/Alpha.md#top) and [[Alpha|the first]]\n' });
    await v.rename(a.id, 'Alpha 2');
    expect(fs.text('Projects/Alpha.md')).toBeNull();
    expect(fs.text('Projects/Alpha 2.md')).toContain('a');
    expect((await v.getNote(b.id))!.body).toBe('Keep   this  spacing\n\n* [Alpha 2](../Projects/Alpha%202.md#top) and [[Alpha 2|the first]]\n');
    expect(fs.text(b.filePath)).toContain('Keep   this  spacing');
  });

  it('puts attachments in attachments/ as real files', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const r = await v.addFile({ name: 'My Photo.png', mime: 'image/png', data: Buffer.from('PNGDATA').toString('base64') });
    expect(r.path).toBe('attachments/My Photo.png');
    expect(fs.text(r.path)).toBe('PNGDATA');
    expect((await v.getFileByPath('attachments/My Photo.png'))!.data).toBe(Buffer.from('PNGDATA').toString('base64'));
    expect((await v.getFileByPath('attachments/../.ergonotes/meta.json'))).toBeNull();
  });
});

describe('changes made outside the app', () => {
  it('picks up an edit, keeps the history, and shows the new text', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Doc', body: 'first' });
    fs.put(n.filePath, `---\nid: ${n.id}\n---\nsecond, typed in another editor`, Date.now() + 5);
    expect(await v.rescan()).toBe(1);
    expect((await v.getNote(n.id))!.body).toBe('second, typed in another editor');
    expect((await v.history(n.id)).length).toBeGreaterThanOrEqual(1);
    expect(await v.rescan()).toBe(0);
  });

  it('imports new files and treats a move or rename as the same note', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Original', body: 'content' });
    const text = fs.text(n.filePath)!;
    await fs.remove(n.filePath);
    fs.put('Archive/Renamed elsewhere.md', text);
    fs.put('Fresh.md', 'brand new');
    await v.rescan();
    const items = (await v.listItems()).filter(i => i.type === 'note' && !i.inTrash);
    expect(items.find(i => i.id === n.id)).toMatchObject({ title: 'Renamed elsewhere', filePath: 'Archive/Renamed elsewhere.md' });
    expect(items.find(i => i.title === 'Fresh')).toBeTruthy();
    expect(items.filter(i => i.title === 'Original')).toHaveLength(0);
  });

  it('follows a rename of a file that had no id by its content', async () => {
    const fs = new MemFs();
    fs.put('Old name.md', 'no id in here\n');
    const { v } = await open('A', { fs });
    await v.createVault(PASSWORD);
    const n = await byTitle(v, 'Old name');
    await fs.rename('Old name.md', 'New name.md');
    await v.rescan();
    const now = (await v.listItems()).filter(i => i.type === 'note' && !i.inTrash);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ id: n.id, title: 'New name' });
    expect(fs.text('New name.md')).toBe('no id in here\n'); // still untouched
  });

  it('gives a copied note its own identity', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Template-ish', body: 'text' });
    fs.put('Copy of it.md', fs.text(n.filePath)!);
    await v.rescan();
    const notes = (await v.listItems()).filter(i => i.type === 'note' && !i.inTrash && ['Copy of it', 'Template-ish'].includes(i.title));
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map(i => i.id)).size).toBe(2);
    const copy = notes.find(i => i.title === 'Copy of it')!;
    await v.setPinned(copy.id, true);
    expect(fs.text('Copy of it.md')).toContain(`id: ${copy.id}`);
    expect(fs.text(n.filePath)).toContain(`id: ${n.id}`);
  });

  it('puts a file deleted outside in the Trash and writes it back on restore', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Doomed', body: 'precious' });
    const keepElse = await v.createNote({ title: 'Other' });
    await fs.remove(n.filePath);
    await v.rescan();
    const gone = (await v.getNote(n.id))!;
    expect(gone.inTrash).toBe(true);
    expect((await v.getNote(keepElse.id))!.inTrash).toBe(false);
    await v.restore(n.id);
    expect(fs.text(n.filePath)).toContain('precious');
    expect((await v.getNote(n.id))!.inTrash).toBe(false);
  });

  it('does not delete anything when the whole folder suddenly looks empty', async () => {
    const fs = new MemFs();
    fs.put('A.md', 'a');
    fs.put('B.md', 'b');
    const { v } = await open('A', { fs });
    await v.createVault(PASSWORD);
    await fs.remove('A.md');
    await fs.remove('B.md');
    expect(await v.rescan()).toBe(0);
    expect((await v.listItems()).filter(i => i.type === 'note' && !i.inTrash)).toHaveLength(2);
    expect((await v.status()).notice).toMatch(/empty or unavailable/);
  });

  it('leaves a file alone that is not UTF-8 text', async () => {
    const fs = new MemFs();
    fs.files.set('Latin.md', { data: new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]), mtime: Date.now() - 5000 }); // "café" in Latin-1
    fs.put('Fine.md', 'ok\n');
    const { v } = await open('A', { fs });
    await v.createVault(PASSWORD);
    expect((await v.listItems()).filter(i => i.type === 'note').map(i => i.title)).toEqual(['Fine']);
    expect((await v.status()).notice).toMatch(/not UTF-8/);
    expect(fs.files.get('Latin.md')!.data).toEqual(new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  });

  it('keeps trashed notes in .trash and purges them from there', async () => {
    const { v, fs } = await open('A');
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Bye', body: 'x' });
    await v.trash(n.id);
    expect(fs.text(n.filePath)).toBeNull();
    expect(fs.text(`.trash/${n.filePath}`)).toContain('x');
    await v.purge(n.id);
    expect(fs.list().filter(p => p.startsWith('.trash/'))).toEqual([]);
  });

  it('survives a restart: the index tells what changed while the app was closed', async () => {
    const fs = new MemFs();
    const persist = new FsPersist(fs);
    const { v } = await open('A', { fs, persist });
    await v.createVault(PASSWORD, { remember: true });
    const n = await v.createNote({ title: 'Persisted', body: 'v1' });
    await v.close();
    // edited while closed
    fs.put(n.filePath, `---\nid: ${n.id}\n---\nv2 from outside`, Date.now() + 10);
    fs.put('Added later.md', 'x');
    const again = await open('A', { fs, persist: new FsPersist(fs) });
    expect((await again.v.status()).state).toBe('ready');
    expect((await again.v.getNote(n.id))!.body).toBe('v2 from outside');
    expect((await byTitle(again.v, 'Added later'))).toBeTruthy();
    // history from before the restart is still there
    expect((await again.v.history(n.id)).length).toBeGreaterThanOrEqual(1);
  });

  it('seals the database inside the vault folder with the vault key', async () => {
    const fs = new MemFs();
    const { v } = await open('A', { fs, persist: new FsPersist(fs) });
    await v.createVault(PASSWORD);
    await v.createNote({ title: 'Secretive', body: 'the launch code is 0000' });
    await v.setAiSettings({ connections: [{ id: 'c1', label: 'x', kind: 'openai', apiKey: 'sk-very-secret-key', baseUrl: '' }] } as never).catch(() => undefined);
    await v.close();
    for (const p of fs.list().filter(p => p.startsWith('.ergonotes/commits/'))) {
      const raw = fs.text(p)!;
      expect(raw).not.toContain('launch code');
      expect(raw).not.toContain('sk-very-secret-key');
    }
    expect(fs.list().some(p => p.startsWith('.ergonotes/commits/') && p.endsWith('.bin'))).toBe(true);
    // while the note itself is plain text beside it
    expect(fs.text('Inbox/Secretive.md') ?? fs.text(fs.list().find(p => p.endsWith('Secretive.md'))!)).toContain('launch code');
  });
});

describe('a vault folder is portable', () => {
  it('opens on another computer from the folder alone, with the password', async () => {
    const fs = new MemFs();
    const local = { data: {} as Record<string, unknown>, async load() { return structuredClone(this.data); }, async save(m: Record<string, unknown>) { this.data = structuredClone(m); } };
    const a = await open('A', { fs, persist: new FsPersist(fs, { local }) });
    await a.v.createVault(PASSWORD, { remember: true });
    const n = await a.v.createNote({ title: 'Carried along', body: 'v1' });
    await a.v.saveNote(n.id, { body: 'v2' });
    await a.v.close();
    // nothing about this device is in the folder
    const all = fs.list().map(p => fs.text(p)).join('\n');
    expect(all).not.toContain('rememberedKey');
    expect(fs.list()).toContain('.ergonotes/vault.json');
    // a different computer: the same files, no device metadata
    const b = await open('B', { fs, persist: new FsPersist(fs, { local: { async load() { return {}; }, async save() { /* nothing yet */ } } }) });
    expect((await b.v.status()).state).toBe('locked');
    await expect(b.v.unlock('not the password at all')).rejects.toThrow(/Wrong password/);
    await b.v.unlock(PASSWORD);
    expect((await b.v.getNote(n.id))!.body).toBe('v2');
    expect((await b.v.history(n.id)).length).toBeGreaterThanOrEqual(1);
  });
});

describe('two devices with their own folders', () => {
  it('an edit made in a file on one device lands in the file on the other', async () => {
    const store = new MemStore();
    stores.set('fv1', store);
    const A = await open('Laptop');
    await A.v.createVault(PASSWORD);
    const n = await A.v.createNote({ title: 'Shared', body: 'one' });
    await A.v.setStore(cfg('fv1'));
    const B = await open('Phone');
    await B.v.joinVault(cfg('fv1'), PASSWORD);
    expect(B.fs.text(n.filePath)).toContain('one');

    A.fs.put(n.filePath, `---\nid: ${n.id}\n---\ntwo from another editor`, Date.now() + 20);
    await A.v.sync();
    await B.v.sync();
    expect(B.fs.text(n.filePath)).toContain('two from another editor');

    // a rename and an edit on different devices merge
    await B.v.rename(n.id, 'Renamed on phone');
    await A.v.saveNote(n.id, { body: 'three from the laptop' });
    await A.v.sync(); await B.v.sync(); await A.v.sync(); await B.v.sync();
    expect(await A.v.conflicts()).toHaveLength(0);
    expect(A.fs.text('Inbox/Renamed on phone.md')).toContain('three from the laptop');
    expect(B.fs.text('Inbox/Renamed on phone.md')).toContain('three from the laptop');
    expect(A.fs.text(n.filePath)).toBeNull();
  });

  it('an edit made in a file while another device\'s change arrives is joined with it, not overwritten', async () => {
    const store = new MemStore();
    stores.set('fv3', store);
    const A = await open('Laptop');
    await A.v.createVault(PASSWORD);
    const n = await A.v.createNote({ title: 'Meeting', body: 'one\n\ntwo\n\nthree\n\nfour' });
    await A.v.setStore(cfg('fv3'));
    const B = await open('Phone');
    await B.v.joinVault(cfg('fv3'), PASSWORD);
    // the phone changes the first paragraph and syncs
    await B.v.saveNote(n.id, { body: 'ONE from the phone\n\ntwo\n\nthree\n\nfour' });
    await B.v.sync();
    // meanwhile somebody edits the file on the laptop; the app has not looked at it yet
    A.fs.put(n.filePath, `---\nid: ${n.id}\n---\none\n\ntwo\n\nthree\n\nFOUR typed in the file`, Date.now() + 50);
    // the news arrives through the background pull (which does not look at the folder first)
    const inner = A.v as unknown as { replica: { pull(c: unknown): Promise<unknown> }; ctx(s: unknown): unknown };
    await inner.replica.pull(inner.ctx(store));
    expect(A.fs.text(n.filePath)).toContain('FOUR typed in the file'); // not overwritten
    await new Promise(r => setTimeout(r, 120));
    await A.v.rescan();
    const text = A.fs.text(n.filePath)!;
    expect(text).toContain('ONE from the phone');
    expect(text).toContain('FOUR typed in the file');
    expect(await A.v.conflicts()).toHaveLength(0);
  });

  it('two notes that want the same file name both survive, the same way on both devices', async () => {
    const store = new MemStore();
    stores.set('fv2', store);
    const A = await open('Laptop');
    await A.v.createVault(PASSWORD);
    await A.v.setStore(cfg('fv2'));
    const B = await open('Phone');
    await B.v.joinVault(cfg('fv2'), PASSWORD);
    // both create "Idea" in Inbox while apart
    const a = await A.v.createNote({ title: 'Idea', body: 'from laptop' });
    const b = await B.v.createNote({ title: 'Idea', body: 'from phone' });
    expect(a.filePath).toBe(b.filePath);
    await A.v.sync(); await B.v.sync(); await A.v.sync(); await B.v.sync(); await A.v.sync();
    const files = (fs: MemFs) => fs.list().filter(p => p.startsWith('Inbox/Idea')).map(p => [p, fs.text(p)!.includes('laptop') ? 'laptop' : 'phone']).sort();
    expect(files(A.fs)).toHaveLength(2);
    expect(files(A.fs)).toEqual(files(B.fs));
    expect(await A.v.conflicts()).toHaveLength(0);
  });
});
