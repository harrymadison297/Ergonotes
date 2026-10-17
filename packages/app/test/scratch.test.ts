import { describe, expect, it } from 'vitest';
import { bodyForNote, heldPath, mentioned, type Draft } from '../src/state/scratch';

describe('files held in the Scratchpad draft', () => {
  it('are named safely and kept inside the draft', () => {
    expect(heldPath('My photo (1).png', 'k1')).toBe('scratch-files/k1-My_photo_1_.png');
    expect(heldPath('..\\..\\evil.png', 'k2')).toBe('scratch-files/k2-_.._evil.png');
    expect(heldPath('日本語', 'k3')).toBe('scratch-files/k3-_');
  });

  it('are only those the text still mentions', () => {
    const files: Draft['files'] = {
      'scratch-files/a-one.png': { name: 'one.png', mime: 'image/png', data: 'x' },
      'scratch-files/b-two.pdf': { name: 'two.pdf', mime: 'application/pdf', data: 'y' },
    };
    expect(mentioned('text ![](scratch-files/a-one.png) more', files)).toEqual(['scratch-files/a-one.png']);
    expect(mentioned('nothing', files)).toEqual([]);
  });

  it('are written into the note as the paths they got in the vault, relative to the note', () => {
    const body = 'See ![one](scratch-files/a-one.png) and [two](scratch-files/b-two.pdf)';
    const out = bodyForNote(body, { 'scratch-files/a-one.png': 'attachments/one.png', 'scratch-files/b-two.pdf': 'attachments/two.pdf' }, 'Inbox');
    expect(out).toBe('See ![one](../attachments/one.png) and [two](../attachments/two.pdf)');
    expect(bodyForNote(body, { 'scratch-files/a-one.png': 'attachments/one.png' }, '')).toBe('See ![one](attachments/one.png) and [two](scratch-files/b-two.pdf)');
  });
});
