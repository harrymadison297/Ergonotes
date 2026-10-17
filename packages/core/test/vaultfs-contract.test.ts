// What the core relies on from the folder of a Vault (ADR 0010), stated once and run against every adapter that can run here.
// The desktop (Rust) and Android (Kotlin) adapters keep the same promises; they are checked by the e2e on the VMs.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemFs, type VaultFs } from '../src/vaultfs.ts';
import { NodeFs } from '../src/node.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const names = async (fs: VaultFs, dir = '') => (await fs.readdir(dir)).map(e => `${e.kind === 'dir' ? '/' : ''}${e.name}`).sort();

const roots: string[] = [];
afterAll(async () => { for (const r of roots) await rm(r, { recursive: true, force: true }); });

interface Maker { name: string; make(): Promise<VaultFs>; /** a folder on a disk: writes go through a temporary file, paths cannot leave it */ disk?: (fs: VaultFs) => string }
const adapters: Maker[] = [
  { name: 'MemFs', make: async () => new MemFs() },
  { name: 'NodeFs', make: async () => { const r = await mkdtemp(join(tmpdir(), 'ergo-fs-')); roots.push(r); return new NodeFs(r); }, disk: fs => (fs as NodeFs).root },
];

describe.each(adapters)('the vault folder: $name', ({ make, disk }) => {
  it('gives back exactly what was written, as bytes or as text, and replaces a file as a whole', async () => {
    const fs = await make();
    await fs.write('a.md', 'héllo');
    expect(dec(await fs.read('a.md'))).toBe('héllo');
    const bytes = Uint8Array.from([0, 255, 10, 13, 128]);
    await fs.write('b.bin', bytes);
    expect([...(await fs.read('b.bin'))!]).toEqual([...bytes]);
    await fs.write('a.md', 'x');
    expect(dec(await fs.read('a.md'))).toBe('x');
  });

  it('reads a file that is not there as null, and a stat of it as null', async () => {
    const fs = await make();
    expect(await fs.read('nope.md')).toBeNull();
    expect(await fs.read('no/such/dir/x.md')).toBeNull();
    expect(await fs.stat('nope.md')).toBeNull();
  });

  it('creates the folders a write or a rename needs', async () => {
    const fs = await make();
    await fs.write('A/B/c.md', 'c');
    expect((await fs.stat('A/B'))?.kind).toBe('dir');
    await fs.rename('A/B/c.md', 'X/Y/d.md');
    expect(await fs.read('A/B/c.md')).toBeNull();
    expect(dec(await fs.read('X/Y/d.md'))).toBe('c');
  });

  it('lists one level: files with their size, folders as folders, nothing from deeper down', async () => {
    const fs = await make();
    await fs.write('one.md', '12345');
    await fs.write('Sub/two.md', 'x');
    await fs.mkdir('Empty');
    expect(await names(fs)).toEqual(['/Empty', '/Sub', 'one.md']);
    const one = (await fs.readdir('')).find(e => e.name === 'one.md')!;
    expect(one).toMatchObject({ kind: 'file', size: 5 });
    expect(Number.isInteger(one.mtime)).toBe(true);
    expect(await names(fs, 'Sub')).toEqual(['two.md']);
  });

  it('lists a folder that is not there as empty', async () => {
    const fs = await make();
    expect(await fs.readdir('Missing')).toEqual([]);
  });

  it('makes nested folders, and says what a path is', async () => {
    const fs = await make();
    await fs.mkdir('a/b/c');
    await fs.write('a/f.md', 'x');
    expect((await fs.stat('a/b/c'))?.kind).toBe('dir');
    expect(await fs.stat('a/f.md')).toMatchObject({ kind: 'file', size: 1 });
    expect((await fs.stat(''))?.kind).toBe('dir');
  });

  it('removes a file, a folder with everything in it, and a path that is not there without complaint', async () => {
    const fs = await make();
    await fs.write('keep.md', 'k');
    await fs.write('D/x.md', 'x');
    await fs.write('D/E/y.md', 'y');
    await fs.remove('D');
    await fs.remove('keep.md');
    await fs.remove('never-was');
    expect(await names(fs)).toEqual([]);
  });

  it('renames a folder with everything in it', async () => {
    const fs = await make();
    await fs.write('Old/a.md', 'a');
    await fs.write('Old/Deep/b.md', 'b');
    await fs.rename('Old', 'New');
    expect(await names(fs)).toEqual(['/New']);
    expect(dec(await fs.read('New/Deep/b.md'))).toBe('b');
    expect(await fs.read('Old/a.md')).toBeNull();
  });

  if (disk) {
    it('does not list the temporary file of a write in progress, or one an app that died left behind', async () => {
      const fs = await make();
      const root = disk(fs);
      await mkdir(join(root, 'Notes'), { recursive: true });
      await writeFile(join(root, 'Notes', 'a.md'), 'a');
      await writeFile(join(root, 'Notes', 'a.md.4242.k3j2x.tmp'), 'half');
      await writeFile(join(root, 'Notes', 'b.4242.17.tmp'), 'half');
      await writeFile(join(root, 'Notes', 'mine.tmp'), 'the person’s own file');
      expect(await names(fs, 'Notes')).toEqual(['a.md', 'mine.tmp']);
    });

    it('cannot be asked for anything outside the folder', async () => {
      const fs = await make();
      await expect(fs.write('../escape.md', 'x')).rejects.toThrow();
      await expect(fs.stat('../')).rejects.toThrow();
      expect(await fs.read('../escape.md')).toBeNull();
    });

    it('leaves no temporary file after a write', async () => {
      const fs = await make();
      for (let i = 0; i < 5; i++) await fs.write('n.md', `v${i}`);
      expect(await names(fs)).toEqual(['n.md']);
    });
  }
});
