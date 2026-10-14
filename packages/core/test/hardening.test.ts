// Regression tests for problems found in the whole-code review: edits racing an upload, purge over an
// unseen conflict, unreadable Store objects, Windows line endings, "keep both" without a base,
// untrusted key-derivation settings and a password changed on another device.
import { describe, expect, it } from 'vitest';
import { Sealer, createVaultFile, unwrapMasterKey } from '../src/crypto.ts';
import { unionText } from '../src/merge.ts';
import { splitDoc } from '../src/markdown.ts';
import { MemPersist } from '../src/persist.ts';
import { Replica, type SyncContext } from '../src/replica.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const sharedStores = new Map<string, MemStore>();
const cfgFor = (id: string): StoreConfig => ({ type: 'folder', path: id });
async function device(name: string) {
  return Vault.open({
    persist: new MemPersist(), kdf: KDF, defaultDeviceName: name,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return sharedStores.get(cfg.path)!; },
  });
}

describe('replica: an edit while an upload is in flight', () => {
  it('chains on the commit being uploaded instead of amending it, so no second head appears', async () => {
    const store = new MemStore();
    const sealer = new Sealer(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const A = await Replica.open(new MemPersist(), 'devA', 'A');
    const B = await Replica.open(new MemPersist(), 'devB', 'B');
    const ctxA: SyncContext = { store, sealer };
    const ctxB: SyncContext = { store, sealer };

    await A.commit('note', 'first');
    let typed = false;
    const realPut = store.put.bind(store);
    store.put = async (key: string, data: Uint8Array) => {
      await realPut(key, data);
      if (!typed && key.startsWith('commits/note/')) { typed = true; await A.commit('note', 'first and more'); } // the person types during the upload
    };
    await A.push(ctxA);
    store.put = realPut;
    await A.push(ctxA);

    await B.pull(ctxB, { full: true });
    expect(B.g.heads('note')).toHaveLength(1);
    expect(B.text('note')).toBe('first and more');
    expect(A.g.heads('note')).toHaveLength(1);
  });
});

describe('replica: unreadable objects on the Store', () => {
  it('skips a corrupt commit, still takes the rest, and lists everything again next time', async () => {
    const store = new MemStore();
    const sealer = new Sealer(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const A = await Replica.open(new MemPersist(), 'devA', 'A');
    const B = await Replica.open(new MemPersist(), 'devB', 'B');
    const ctx: SyncContext = { store, sealer };
    await A.commit('good', 'fine');
    await A.push(ctx);
    await store.put('commits/bad/00000000-0000-4000-8000-000000000000', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]));

    const first = await B.pull(ctx, { full: true });
    expect(first.fetched).toBe(1);
    expect(B.text('good')).toBe('fine');
    expect(B.needFull).toBe(true);

    await store.delete('commits/bad/00000000-0000-4000-8000-000000000000');
    await B.pull(ctx);
    expect(B.needFull).toBe(false);
  });
});

describe('keep both and line endings', () => {
  it('keeps repeated blank lines and fences when there is no common base', () => {
    const ours = 'intro\n\nA\n\n```js\nx\n```\n\nend';
    const theirs = 'intro\n\nB\n\n```js\nx\n```\n\nend';
    const out = unionText(ours, null, theirs);
    expect(out.split('\n\n').length).toBeGreaterThanOrEqual(4);
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect((out.match(/```/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('reads frontmatter written with CRLF line endings', () => {
    const d = splitDoc('---\r\ntitle: Windows note\r\ntags:\r\n  - a\r\n---\r\nbody line\r\n');
    expect(d.fm.title).toBe('Windows note');
    expect(d.fm.tags).toEqual(['a']);
    expect(d.body).toBe('body line\n');
  });
});

describe('key derivation settings from the Store', () => {
  it('rejects absurd cost parameters before running Argon2', async () => {
    const { file } = await createVaultFile(PASSWORD, KDF);
    await expect(unwrapMasterKey(PASSWORD, { ...file, kdf: { ...file.kdf, m: 2 ** 31 } })).rejects.toThrow(/does not accept/);
    await expect(unwrapMasterKey(PASSWORD, { ...file, kdf: { ...file.kdf, t: 5000 } })).rejects.toThrow(/does not accept/);
    await expect(unwrapMasterKey(PASSWORD, file)).resolves.toHaveLength(32);
  });
});

describe('vault: purge and password', () => {
  it('does not purge an item with an unresolved concurrent edit, and leaves it in the Trash', async () => {
    sharedStores.set('p', new MemStore());
    const A = await device('Laptop');
    await A.createVault(PASSWORD);
    const n = await A.createNote({ title: 'Shared', body: 'one\ntwo\nthree' });
    await A.setStore(cfgFor('p'));
    const B = await device('Phone');
    await B.joinVault(cfgFor('p'), PASSWORD);

    await A.saveNote(n.id, { body: 'one\nfrom laptop\nthree' });
    await B.saveNote(n.id, { body: 'one\nfrom phone\nthree' });
    await A.sync(); await B.sync(); await A.sync();
    expect((await B.conflicts()).map(c => c.id)).toEqual([n.id]);

    await B.trash(n.id);
    await expect(B.purge(n.id)).rejects.toThrow(/changed on another device/);
    await B.emptyTrash();
    expect((await B.listItems()).some(i => i.id === n.id && i.trashed)).toBe(true);
    expect(await B.conflictDetail(n.id)).not.toBeNull();
  });

  it('lets another device unlock with a password that was changed elsewhere', async () => {
    sharedStores.set('pw', new MemStore());
    const A = await device('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('pw'));
    const B = await device('Phone');
    await B.joinVault(cfgFor('pw'), PASSWORD);
    await B.lock();

    const NEW = 'a brand new passphrase here';
    await A.changePassword(PASSWORD, NEW);
    await expect(B.unlock('wrong password entirely')).rejects.toThrow(/Wrong password/);
    await B.unlock(NEW);
    expect((await B.status()).state).toBe('ready');
  });

  it('changePassword leaves everything as it was when the Store cannot be reached', async () => {
    const store = new MemStore();
    sharedStores.set('flaky', store);
    const A = await device('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('flaky'));
    const realPut = store.put.bind(store);
    store.put = async () => { throw new Error('offline'); };
    await expect(A.changePassword(PASSWORD, 'another long passphrase!')).rejects.toThrow(/offline/);
    store.put = realPut;
    await A.lock();
    await A.unlock(PASSWORD); // the old password still works
    expect((await A.status()).state).toBe('ready');
  });
});
