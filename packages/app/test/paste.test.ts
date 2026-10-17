// A paste that carries files: pictures are always taken, other files only when no text comes with them.
import { describe, expect, it } from 'vitest';
import { pastedFiles, type PastedData } from '../src/state/paste.ts';

const f = (name: string, type: string) => ({ name, type }) as unknown as File;
const data = (files: File[], text = '', html = '', viaItems = false): PastedData => ({
  files: viaItems ? [] : files,
  items: viaItems ? files.map(x => ({ kind: 'file', getAsFile: () => x })) : [],
  getData: t => (t === 'text/plain' ? text : t === 'text/html' ? html : ''),
});

describe('pasting files', () => {
  it('takes a pasted picture', () => {
    const shot = f('image.png', 'image/png');
    expect(pastedFiles(data([shot]))).toEqual([shot]);
  });
  it('takes a picture even when the program sent text with it', () => {
    const shot = f('image.png', 'image/png');
    expect(pastedFiles(data([shot], 'a table', '<table></table>'))).toEqual([shot]);
  });
  it('takes only the pictures when a picture and a file come together', () => {
    const shot = f('a.png', 'image/png');
    expect(pastedFiles(data([f('b.pdf', 'application/pdf'), shot]))).toEqual([shot]);
  });
  it('takes a file copied in a file manager, with no text', () => {
    const pdf = f('plan.pdf', 'application/pdf');
    expect(pastedFiles(data([pdf]))).toEqual([pdf]);
    expect(pastedFiles(data([f('x.xlsx', '')]))).toHaveLength(1);
  });
  it('leaves a file that has text with it to the text', () => {
    expect(pastedFiles(data([f('plan.pdf', 'application/pdf')], 'plan.pdf'))).toEqual([]);
    expect(pastedFiles(data([f('plan.pdf', 'application/pdf')], '', '<b>x</b>'))).toEqual([]);
  });
  it('reads the files from the items when `files` is empty', () => {
    const shot = f('image.png', 'image/png');
    expect(pastedFiles(data([shot], '', '', true))).toEqual([shot]);
  });
  it('is empty for plain text and for nothing', () => {
    expect(pastedFiles(data([], 'hello'))).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
    expect(pastedFiles({})).toEqual([]);
  });
});
