// ADR 0012: a vault with no password, and a vault that opens before its folder has been read.
import { describe, expect, it } from 'vitest';
import { FsPersist, MemFs } from '../src/vaultfs.ts';
import { Vault } from '../src/vault.ts';
import { MemStore } from '../src/store.ts';
import type { StoreConfig } from '../src/api.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const stores = new Map<string, MemStore>();

function local() {
  let saved: Record<string, unknown> = {};
  return { load: async () => structuredClone(saved), save: async (m: Record<string, unknown>) => { saved = structuredClone(m); } };
}

async function open(o: { fs?: MemFs; meta?: ReturnType<typeof local>; optional?: boolean; background?: boolean } = {}) {
  const fs = o.fs ?? new MemFs();
  const meta = o.meta ?? local();
  const v = await Vault.open({
    fs, persist: new FsPersist(fs, { local: meta }), kdf: KDF, defaultDeviceName: 'A', settleMs: 0, watchMs: 0,
    passwordOptional: o.optional ?? true, backgroundScan: o.background,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return stores.get(cfg.path)!; },
  });
  return { v, fs, meta };
}
const vaultJson = (fs: MemFs) => JSON.parse(new TextDecoder().decode(fs.files.get('.ergonotes/vault.json')!.data));
const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 200 && !(await f()); i++) await new Promise(r => setTimeout(r, 5)); };

describe('a vault with no password', () => {
  it('opens at once, runs no key derivation, and opens again by itself after a restart', async () => {
    const { v, fs, meta } = await open();
    await v.createVault('', { noPassword: true });
    const st = await v.status();
    expect(st.state).toBe('ready');
    expect(st.hasPassword).toBe(false);
    expect(vaultJson(fs).kdf).toEqual({ alg: 'none' });
    const n = await v.createNote({ title: 'Hello', body: 'x' });
    await v.flush();

    const again = await open({ fs, meta });
    expect((await again.v.status()).state).toBe('ready');
    expect((await again.v.listItems()).some(i => i.id === n.id)).toBe(true);
  });

  it('is refused where a password is required (the web and the server peer)', async () => {
    const { v } = await open({ optional: false });
    await expect(v.createVault('', { noPassword: true })).rejects.toThrow(/needs a password/);
    await expect(v.createVault('')).rejects.toThrow(/at least 12/);
  });

  it('gets a password later, and then asks for it once locked', async () => {
    const { v, fs } = await open();
    await v.createVault('', { noPassword: true });
    await v.changePassword('', PASSWORD);
    expect((await v.status()).hasPassword).toBe(true);
    expect(vaultJson(fs).kdf.alg).toBe('argon2id');
    await v.lock();
    await expect(v.unlock('wrong password here!!')).rejects.toThrow(/Wrong password/);
    await v.unlock(PASSWORD);
    expect((await v.status()).state).toBe('ready');
  });

  it('gives the password up again, only with the right one, without re-encrypting', async () => {
    const { v, fs } = await open();
    await v.createVault(PASSWORD);
    const n = await v.createNote({ title: 'Kept', body: 'x' });
    await expect(v.removePassword('wrong password here!!')).rejects.toThrow(/Wrong password/);
    await v.removePassword(PASSWORD);
    expect((await v.status()).hasPassword).toBe(false);
    expect(vaultJson(fs).kdf).toEqual({ alg: 'none' });
    await v.lock();
    await v.unlock('');
    expect((await v.listItems()).some(i => i.id === n.id)).toBe(true);
  });

  it('may be connected to a Store, and a second device opens it with no password', async () => {
    stores.set('s', new MemStore());
    const cfg: StoreConfig = { type: 'folder', path: 's' };
    const a = await open();
    await a.v.createVault('', { noPassword: true });
    const n = await a.v.createNote({ title: 'Shared', body: 'from A' });
    await a.v.setStore(cfg);
    const b = await open();
    await b.v.joinVault(cfg, '');
    expect((await b.v.listItems()).some(i => i.title === 'Shared')).toBe(true);
    expect(n.id).toBeTruthy();
  });

  it('can be left to join another vault: the notes stay, the history goes', async () => {
    const { v, fs } = await open();
    await v.createVault('', { noPassword: true });
    await v.createNote({ title: 'Mine', body: 'x' });
    await v.flush();
    await v.leaveVault();
    expect((await v.status()).state).toBe('no-vault');
    expect(fs.files.has('.ergonotes/vault.json')).toBe(false);
    expect([...fs.files.keys()].some(p => p.endsWith('Mine.md'))).toBe(true);
    await v.createVault(PASSWORD);
    expect((await v.listItems()).some(i => i.title === 'Mine')).toBe(true);
  });

  it('will not leave a vault that has a password or a Store', async () => {
    const withPw = await open();
    await withPw.v.createVault(PASSWORD);
    await expect(withPw.v.leaveVault()).rejects.toThrow(/no password/);
    stores.set('t', new MemStore());
    const withStore = await open();
    await withStore.v.createVault('', { noPassword: true });
    await withStore.v.setStore({ type: 'folder', path: 't' });
    await expect(withStore.v.leaveVault()).rejects.toThrow(/Disconnect/);
  });
});

describe('a vault that opens before its folder has been read', () => {
  it('is ready at once, shows how far the reading is, and has all the notes when it is over', async () => {
    const fs = new MemFs();
    for (let i = 0; i < 30; i++) fs.put(`Notes/n${i}.md`, `note ${i}\n`);
    const { v } = await open({ fs, background: true });
    await v.createVault('', { noPassword: true });
    expect((await v.status()).state).toBe('ready');
    await until(async () => (await v.status()).scan === null && (await v.listItems()).filter(i => i.type === 'note').length === 30);
    expect((await v.listItems()).filter(i => i.type === 'note')).toHaveLength(30);
    expect((await v.status()).scan).toBeNull();
  });
});
