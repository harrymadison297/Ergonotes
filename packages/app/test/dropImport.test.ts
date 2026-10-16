// Files and folders dropped from the computer: the walk through a dropped folder (File System Entry API), batch by batch.
import { describe, expect, it } from 'vitest';
import { walkEntries, type DroppedEntry } from '../src/state/dropImport.ts';
import type { ImportFile } from '@ergonotes/core';

const file = (name: string, text: string): DroppedEntry => ({ isFile: true, isDirectory: false, name, file: ok => ok({ name, text } as unknown as File) });
/** A directory that hands out its children `batch` at a time, as browsers do (readEntries is called until it returns nothing). */
const dir = (name: string, kids: DroppedEntry[], batch = 2): DroppedEntry => ({
  isFile: false, isDirectory: true, name,
  createReader: () => { let at = 0; return { readEntries: ok => { const b = kids.slice(at, at + batch); at += batch; ok(b); } }; },
});
const read = async (f: File): Promise<ImportFile> => ({ path: f.name, content: (f as unknown as { text: string }).text });

describe('walking a dropped folder', () => {
  it('keeps each file under the folders it was in, however the entries are batched', async () => {
    const tree = dir('Notes', [file('a.md', 'A'), dir('sub', [file('b.md', 'B'), file('c.png', 'C'), file('d.md', 'D')]), file('e.md', 'E')]);
    const got = await walkEntries([tree], read);
    expect(got.map(f => f.path).sort()).toEqual(['Notes/a.md', 'Notes/e.md', 'Notes/sub/b.md', 'Notes/sub/c.png', 'Notes/sub/d.md']);
    expect(got.find(f => f.path === 'Notes/sub/b.md')?.content).toBe('B');
  });
  it('takes loose files as they are, and stops at a limit', async () => {
    expect((await walkEntries([file('x.md', 'X'), file('y.md', 'Y')], read)).map(f => f.path)).toEqual(['x.md', 'y.md']);
    const many = dir('Big', Array.from({ length: 50 }, (_, i) => file(`n${i}.md`, 'x')), 10);
    expect((await walkEntries([many], read, 20)).length).toBe(20);
  });
});
