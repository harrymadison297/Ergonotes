import { describe, expect, it } from 'vitest';
import { Graph } from '../src/graph.ts';
import { mergeText, tryMerge, unionText } from '../src/merge.ts';
import { joinDoc } from '../src/markdown.ts';

const note = (fm: Record<string, unknown>, body: string) => joinDoc(fm, body);

describe('mergeText', () => {
  const base = note({ id: 'a', title: 'T', tags: ['x'] }, 'one\ntwo\nthree\nfour\nfive');

  it('merges edits on different lines without conflict', () => {
    const ours = note({ id: 'a', title: 'T', tags: ['x'] }, 'ONE\ntwo\nthree\nfour\nfive');
    const theirs = note({ id: 'a', title: 'T', tags: ['x'] }, 'one\ntwo\nthree\nfour\nFIVE');
    const r = mergeText(ours, base, theirs);
    expect(r.clean).toBe(true);
    if (r.clean) expect(r.text).toContain('ONE\ntwo\nthree\nfour\nFIVE');
  });

  it('reports overlap when both change the same line differently', () => {
    const ours = note({ id: 'a', title: 'T', tags: ['x'] }, 'one\nOURS\nthree\nfour\nfive');
    const theirs = note({ id: 'a', title: 'T', tags: ['x'] }, 'one\nTHEIRS\nthree\nfour\nfive');
    const r = mergeText(ours, base, theirs);
    expect(r).toEqual({ clean: false, why: 'overlap' });
  });

  it('merges tags as a set and takes changed scalar keys per side', () => {
    const ours = note({ id: 'a', title: 'T', tags: ['x', 'y'] }, 'one\ntwo\nthree\nfour\nfive');
    const theirs = note({ id: 'a', title: 'New title', tags: ['x', 'z'] }, 'one\ntwo\nthree\nfour\nfive');
    const r = mergeText(ours, base, theirs);
    expect(r.clean).toBe(true);
    if (r.clean) {
      expect(r.text).toContain('title: New title');
      expect(r.text).toMatch(/tags:\n\s+- x\n\s+- y\n\s+- z/);
    }
  });

  it('conflicts when both sides move the note to different folders', () => {
    const ours = note({ id: 'a', title: 'T', tags: ['x'], parent: 'p1' }, 'one\ntwo\nthree\nfour\nfive');
    const theirs = note({ id: 'a', title: 'T', tags: ['x'], parent: 'p2' }, 'one\ntwo\nthree\nfour\nfive');
    const r = mergeText(ours, base, theirs);
    expect(r).toEqual({ clean: false, why: 'frontmatter:parent' });
  });

  it('treats an ergonote block as atomic', () => {
    const b = note({ id: 'a' }, 'intro\n```ergonote-excalidraw\n{"v":1,\n"els":[]}\n```\noutro');
    const ours = note({ id: 'a' }, 'intro\n```ergonote-excalidraw\n{"v":2,\n"els":[]}\n```\noutro');
    const theirs = note({ id: 'a' }, 'intro\n```ergonote-excalidraw\n{"v":1,\n"els":[1]}\n```\noutro');
    expect(mergeText(ours, b, theirs)).toEqual({ clean: false, why: 'overlap' });
  });

  it('asks when one side trashes and the other edits', () => {
    const ours = note({ id: 'a', title: 'T', tags: ['x'], trashed: '2026-01-01T00:00:00Z' }, 'one\ntwo\nthree\nfour\nfive');
    const theirs = note({ id: 'a', title: 'T', tags: ['x'] }, 'one\ntwo\nthree\nfour\nFIVE');
    expect(mergeText(ours, base, theirs)).toEqual({ clean: false, why: 'trash-vs-edit' });
  });

  it('keep-both keeps lines from both sides', () => {
    const ours = note({ id: 'a' }, 'a\nOURS\nc');
    const theirs = note({ id: 'a' }, 'a\nTHEIRS\nc');
    const u = unionText(ours, note({ id: 'a' }, 'a\nb\nc'), theirs);
    expect(u).toContain('OURS');
    expect(u).toContain('THEIRS');
  });
});

describe('deterministic automatic merge', () => {
  it('two devices merging the same heads produce the same commit', () => {
    const g = new Graph();
    const root = g.make('n', [], ['a', 'b', 'c', 'd'], 'd0', 1);
    g.add(root);
    const x = g.make('n', [root.id], ['A', 'b', 'c', 'd'], 'd0', 2);
    const y = g.make('n', [root.id], ['a', 'b', 'c', 'D'], 'd1', 3);
    g.add(x); g.add(y);
    const r = tryMerge(g, x.id, y.id);
    expect(r.clean).toBe(true);
    if (!r.clean) return;
    const ts = Math.max(x.ts, y.ts);
    const m1 = g.make('n', [x.id, y.id], r.text.split('\n'), 'auto', ts);
    const m2 = g.make('n', [y.id, x.id], r.text.split('\n'), 'auto', ts);
    expect(m1.id).toBe(m2.id);
    expect(r.text).toBe('A\nb\nc\nD');
  });

  it('criss-cross merges use a virtual base and do not duplicate lines', () => {
    const g = new Graph();
    const o = g.make('n', [], ['1', '2', '3', '4', '5', '6'], 'd0', 1); g.add(o);
    const a = g.make('n', [o.id], ['1', 'a', '2', '3', '4', '5', '6'], 'd0', 2); g.add(a);
    const b = g.make('n', [o.id], ['1', '2', '3', '4', '5', 'b', '6'], 'd1', 3); g.add(b);
    // each side merges the other: two merge commits with identical parents but different authors -> criss-cross
    const mText = ['1', 'a', '2', '3', '4', '5', 'b', '6'];
    const m1 = g.make('n', [a.id, b.id], mText, 'd0', 4); g.add(m1);
    const m2 = g.make('n', [a.id, b.id], mText, 'd1', 5); g.add(m2);
    const x = g.make('n', [m1.id], ['0', ...mText], 'd0', 6); g.add(x);
    const y = g.make('n', [m2.id], [...mText, '7'], 'd1', 7); g.add(y);
    const r = tryMerge(g, x.id, y.id);
    expect(r.clean).toBe(true);
    if (r.clean) expect(r.text).toBe(['0', ...mText, '7'].join('\n'));
  });
});
