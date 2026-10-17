import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend/external', () => ({
  extRead: vi.fn(), extWrite: vi.fn(), extReadBeside: vi.fn(), extWriteBeside: vi.fn(),
}));
import { splitHead, titleOf, vaultRelative, externalState, externalApi, externalSummary } from '../src/state/externalApi';
import { extRead, extWrite } from '../src/backend/external';
import type { VaultApi } from '@ergonotes/core';

describe('the head of an external file', () => {
  it('is the frontmatter exactly as written, or nothing', () => {
    expect(splitHead('plain text\n')).toEqual({ head: '', body: 'plain text\n' });
    const t = '---\n# mine\ntitle: X\ntags: [a]\n---\nBody\n';
    expect(splitHead(t)).toEqual({ head: '---\n# mine\ntitle: X\ntags: [a]\n---\n', body: 'Body\n' });
    expect(splitHead(t).head + splitHead(t).body).toBe(t);
  });
  it('is not taken for a horizontal rule', () => {
    const t = 'Intro\n\n---\n\nAfter\n';
    expect(splitHead(t)).toEqual({ head: '', body: t });
  });
  it('names the document by its file', () => {
    expect(titleOf('C:\\Users\\a\\Notes\\Plan.MD')).toBe('Plan');
    expect(titleOf('/home/a/todo.txt')).toBe('todo');
  });
});

describe('the api of an external file', () => {
  const file = { text: '---\nid: keep\n---\nHello\n', mtime: 1000, size: 20, bom: false, crlf: false };
  const vault = { listItems: async () => ['vault'] } as unknown as VaultApi;

  it('gives the body without the head, titled by the file, with nothing of a vault', async () => {
    const st = externalState('/x/Plan.md', file);
    const api = externalApi(st, vault, file);
    const d = await api.getNote('ext:/x/Plan.md');
    expect(d?.body).toBe('Hello\n');
    expect(d?.title).toBe('Plan');
    expect(d?.tags).toEqual([]);
    expect(await api.getNote('another')).toBeNull();
    expect(await api.listItems()).toEqual(['vault']);
  });

  it('writes the head back untouched and adds nothing', async () => {
    vi.mocked(extWrite).mockResolvedValue(2000);
    const st = externalState('/x/Plan.md', file);
    const api = externalApi(st, vault, file);
    const s = await api.saveNote('ext:/x/Plan.md', { body: 'Hello there\n' });
    expect(extWrite).toHaveBeenCalledWith('/x/Plan.md', '---\nid: keep\n---\nHello there\n', { bom: false, crlf: false, expected: 1000, force: false });
    expect(st.mtime).toBe(2000);
    expect(s.updated).toBe(externalSummary(st).updated);
  });

  it('does not write for a change of title, which would rename the file', async () => {
    vi.mocked(extWrite).mockClear();
    const st = externalState('/x/Plan.md', file);
    await externalApi(st, vault, file).saveNote('ext:/x/Plan.md', { title: 'New' });
    expect(extWrite).not.toHaveBeenCalled();
  });

  it('reads the file again when it has changed since it was opened', async () => {
    vi.mocked(extRead).mockResolvedValue({ ...file, text: 'New text\n', mtime: 3000 });
    const st = externalState('/x/Plan.md', file);
    st.mtime = 3000;
    expect((await externalApi(st, vault, file).getNote('ext:/x/Plan.md'))?.body).toBe('New text\n');
  });
});

describe('a file inside the vault folder', () => {
  it('is a note of the vault, found by its path in the folder', () => {
    expect(vaultRelative('C:\\Users\\a\\Documents\\Ergonotes\\Projects\\Plan.md', 'C:\\Users\\a\\Documents\\Ergonotes')).toBe('Projects/Plan.md');
    expect(vaultRelative('c:\\users\\A\\documents\\ergonotes\\Plan.md', 'C:\\Users\\a\\Documents\\Ergonotes\\')).toBe('Plan.md');
    expect(vaultRelative('/home/a/Notes/x/Plan.md', '/home/a/Notes')).toBe('x/Plan.md');
  });
  it('is outside when it only starts with the same letters, or lies in a hidden folder', () => {
    expect(vaultRelative('/home/a/Notes2/Plan.md', '/home/a/Notes')).toBeNull();
    expect(vaultRelative('/home/a/Plan.md', '/home/a/Notes')).toBeNull();
    expect(vaultRelative('/home/a/Notes/.trash/Plan.md', '/home/a/Notes')).toBeNull();
    expect(vaultRelative('/home/a/Notes/.ergonotes/x.md', '/home/a/Notes')).toBeNull();
  });
});
