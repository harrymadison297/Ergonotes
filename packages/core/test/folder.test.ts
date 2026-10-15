import { describe, expect, it } from 'vitest';
import {
  buildLinkIndex, denormalizeFileText, editFm, findLinks, folderIdOf, joinBlocks, normalizeFileText, parseNote, preserveBlocks, relativePath,
  reservedOf, resolveLink, rewriteLinks, safeName, splitBlocks, toFileText, toItemText, uniquePath, withBody,
} from '../src/folder.ts';

describe('file text', () => {
  it('round-trips a file byte for byte through the database text', () => {
    const files = [
      'plain text, no frontmatter\n',
      '---\ntitle: X # keep me\ntags:\n- a\n- b\ncustom: [1, 2]\n---\nBody\n\n- [ ] task\n',
      '---\r\nid: 1\r\n---\r\nline one\r\nline two\r\n',
      '﻿# With a BOM\n',
      '',
      'no trailing newline',
    ];
    for (const f of files) {
      const item = toItemText(f, { path: 'A/B.md' });
      expect(reservedOf(item)._ergo_path).toBe('A/B.md');
      expect(toFileText(item)).toBe(f);
    }
  });

  it('records trashed state without touching the file', () => {
    const item = toItemText('hello\n', { path: 'x.md', trashed: '2026-01-01T00:00:00.000Z' });
    expect(reservedOf(item)._ergo_trashed).toBe('2026-01-01T00:00:00.000Z');
    expect(toFileText(item)).toBe('hello\n');
  });

  it('detects and restores CRLF and BOM', () => {
    const n = normalizeFileText('﻿a\r\nb\r\n');
    expect(n.text).toBe('a\nb\n');
    expect(n.meta).toEqual({ eol: 'crlf', bom: true });
    expect(denormalizeFileText(n.text, n.meta)).toBe('﻿a\r\nb\r\n');
  });
});

describe('frontmatter edits', () => {
  it('changes one key and keeps order, comments and the body', () => {
    const src = '---\n# my comment\nid: abc\ntitle: "Quoted"\ntags: [x, y]\nextra:\n  nested: 1\n---\nBody\n';
    const out = editFm(src, { pinned: true, tags: ['x', 'y', 'z'] });
    expect(out).toContain('# my comment');
    expect(out).toContain('title: "Quoted"');
    expect(out).toContain('tags: [x, y, z]'); // flow style stays flow
    expect(out).toContain('pinned: true');
    expect(out.endsWith('---\nBody\n')).toBe(true);
    expect(parseNote(out).fm).toMatchObject({ id: 'abc', pinned: true, tags: ['x', 'y', 'z'], extra: { nested: 1 } });
  });

  it('is a no-op when the value is already there', () => {
    const src = '---\ntags:\n- a\n---\nB\n';
    expect(editFm(src, { tags: ['a'] })).toBe(src);
    expect(editFm(src, { missing: undefined })).toBe(src);
  });

  it('removes a key, and the whole block when it becomes empty', () => {
    expect(editFm('---\npinned: true\n---\nB\n', { pinned: undefined })).toBe('B\n');
    expect(editFm('---\npinned: true\nid: 1\n---\nB\n', { pinned: undefined })).toBe('---\nid: 1\n---\nB\n');
  });

  it('adds frontmatter to a file that has none and puts `top` keys first', () => {
    expect(editFm('Body\n', { id: 'i1' })).toBe('---\nid: i1\n---\nBody\n');
    const out = editFm('---\nzzz: 1\n---\nB\n', { id: 'i1' }, { top: ['id'] });
    expect(out.split('\n').slice(0, 3)).toEqual(['---', 'id: i1', 'zzz: 1']);
  });

  it('leaves unreadable frontmatter alone', () => {
    const bad = '---\n: : :\n  - [\n---\nB\n';
    expect(editFm(bad, { id: 'x' })).toBe(bad);
  });

  it('keeps an unindented list unindented', () => {
    const out = editFm('---\ntags:\n- a\n---\nB\n', { pinned: true });
    expect(out).toContain('tags:\n- a');
  });

  it('withBody keeps the frontmatter', () => {
    expect(withBody('---\nid: 1\n---\nold\n', 'new\n')).toBe('---\nid: 1\n---\nnew\n');
    expect(withBody('old', 'new')).toBe('new');
  });
});

describe('names and paths', () => {
  it('makes safe, unique names', () => {
    expect(safeName('a/b: c?')).toBe('a-b- c-');
    expect(safeName('CON')).toBe('CON_');
    expect(safeName('  ..hidden. ')).toBe('hidden');
    expect(safeName('')).toBe('Untitled');
    const taken = new Set(['notes/a.md', 'notes/a 2.md']);
    expect(uniquePath('notes', 'A', '.md', p => taken.has(p))).toBe('notes/A 3.md');
  });
  it('computes relative paths and stable folder ids', () => {
    expect(relativePath('a/b', 'a/c/x.md')).toBe('../c/x.md');
    expect(relativePath('', 'x.md')).toBe('x.md');
    expect(relativePath('a', 'a/x.md')).toBe('x.md');
    expect(folderIdOf('Projects/Alpha')).toBe(folderIdOf('projects/alpha'));
    expect(folderIdOf('Projects')).not.toBe(folderIdOf('Areas'));
    expect(folderIdOf('Projects')).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  });
});

describe('links', () => {
  const idx = buildLinkIndex(['Inbox/Plan.md', 'Projects/Alpha/Spec.md', 'Projects/Alpha/Spec 2.md', 'attachments/pic one.png', 'Notes.md']);

  it('finds standard and wiki links outside code', () => {
    const body = 'See [Plan](../Inbox/Plan.md#top) and [[Notes]] and ![[pic one.png]] `[x](y.md)`\n```\n[[Hidden]]\n```\n[web](https://a.b)';
    const refs = findLinks(body);
    expect(refs.map(r => [r.kind, r.target, r.embed])).toEqual([['md', '../Inbox/Plan.md', false], ['wiki', 'Notes', false], ['wiki', 'pic one.png', true]]);
    expect(refs[0].fragment).toBe('#top');
  });

  it('resolves relative paths, encoded paths and wiki names', () => {
    const from = 'Projects/Alpha/Spec.md';
    const r = (s: string) => resolveLink(findLinks(s)[0], from, idx);
    expect(r('[a](../../Inbox/Plan.md)')).toBe('Inbox/Plan.md');
    expect(r('[a](Spec%202.md)')).toBe('Projects/Alpha/Spec 2.md');
    expect(r('[[plan]]')).toBe('Inbox/Plan.md');
    expect(r('[[Inbox/Plan|alias]]')).toBe('Inbox/Plan.md');
    expect(r('![[pic one.png]]')).toBe('attachments/pic one.png');
    expect(r('[a](../../Nowhere.md)')).toBeNull();
  });

  it('rewrites only the destination when a note is renamed or moved', () => {
    const body = 'Intro [Plan](Inbox/Plan.md) and [Plan](Inbox/Plan.md#h "t") and [[Plan]] and [[Inbox/Plan|P]] and [keep](Notes.md).';
    const resolve = (ref: ReturnType<typeof findLinks>[number]) => resolveLink(ref, 'Notes.md', idx);
    const out = rewriteLinks(body, { fromOld: 'Notes.md', fromNew: 'Notes.md', moved: new Map([['Inbox/Plan.md', 'Projects/Big plan.md']]), resolve });
    expect(out).toBe('Intro [Big plan](Projects/Big%20plan.md) and [Big plan](Projects/Big%20plan.md#h "t") and [[Big plan]] and [[Projects/Big plan|P]] and [keep](Notes.md).');
  });

  it('recomputes relative links of a note that moved', () => {
    const body = '[Plan](Inbox/Plan.md) ![i](attachments/pic%20one.png)';
    const resolve = (ref: ReturnType<typeof findLinks>[number]) => resolveLink(ref, 'Notes.md', idx);
    const out = rewriteLinks(body, { fromOld: 'Notes.md', fromNew: 'Deep/er/Notes.md', moved: new Map([['Notes.md', 'Deep/er/Notes.md']]), resolve });
    expect(out).toBe('[Plan](../../Inbox/Plan.md) ![i](../../attachments/pic%20one.png)');
  });

  it('does not change a body without affected links', () => {
    const body = 'plain [a](https://x.y) text';
    expect(rewriteLinks(body, { fromOld: 'a.md', fromNew: 'b.md', moved: new Map(), resolve: () => null })).toBe(body);
  });
});

describe('blocks', () => {
  const samples = [
    '', '\n', 'a', 'a\n', 'a\n\nb', 'a\n\n\n\nb\n\n', '\n\nlead', '```\ncode\n\nmore\n```\n\nafter', '$$\na\n\nb\n$$\n\nx',
    '# H\n\n- a\n- b\n\n> q\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  ];
  it('splits losslessly', () => {
    for (const s of samples) expect(joinBlocks(splitBlocks(s))).toBe(s);
  });

  it('keeps blank lines inside a fence in one block', () => {
    const b = splitBlocks('```js\na\n\nb\n```\n\nx');
    expect(b.map(x => x.text)).toEqual(['```js\na\n\nb\n```', 'x']);
  });

  const raw = '# Title\n\n* odd marker\n* second\n\n![[embed.png]]\n\n%%comment%%\n\nA paragraph that is\nhard wrapped.\n\n<div class="x">html</div>\n';
  // what a Markdown editor would write for the same content
  const norm = '# Title\n\n- odd marker\n- second\n\n![[embed.png]]\n\n%%comment%%\n\nA paragraph that is hard wrapped.\n\n<div class="x">html</div>\n';

  it('returns the file unchanged when nothing was edited', () => {
    expect(preserveBlocks(raw, norm, norm)).toBe(raw);
  });

  it('rewrites only the block that changed', () => {
    const edited = norm.replace('- second', '- second\n- third');
    const out = preserveBlocks(raw, norm, edited);
    expect(out).toBe(raw.replace('* second', '- second\n- third').replace('* odd marker', '- odd marker'));
    // the other blocks are byte-for-byte what the file had
    expect(out).toContain('A paragraph that is\nhard wrapped.');
    expect(out).toContain('%%comment%%');
    expect(out).toContain('<div class="x">html</div>');
  });

  it('handles an inserted block and a deleted block', () => {
    const ins = norm.replace('![[embed.png]]', 'New line\n\n![[embed.png]]');
    expect(preserveBlocks(raw, norm, ins)).toBe(raw.replace('![[embed.png]]', 'New line\n\n![[embed.png]]').replace('* odd marker\n* second', '* odd marker\n* second'));
    const del = norm.replace('%%comment%%\n\n', '');
    expect(preserveBlocks(raw, norm, del)).toBe(raw.replace('%%comment%%\n\n', ''));
  });

  it('never glues a kept block to a new one', () => {
    expect(preserveBlocks('a', 'a', 'a\n\nb')).toBe('a\n\nb');
    expect(preserveBlocks('a\n', 'a\n', 'a\n\nb\n')).toBe('a\n\nb\n');
  });

  it('still keeps exact blocks when the editor changed the block count', () => {
    const out = preserveBlocks('keep\n\n<weird/>\n\nlast\n', 'keep\n\nlast\n', 'keep\n\nlast\n\nnew\n');
    expect(out.startsWith('keep\n\n')).toBe(true);
    expect(out).toContain('last');
    expect(out).toContain('new');
  });
});
