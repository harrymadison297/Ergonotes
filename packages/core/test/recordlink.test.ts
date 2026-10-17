// How a note points at a record (ADR 0011): one place decides what counts as a record link.
import { describe, expect, it } from 'vitest';
import { linkTargets } from '../src/folder.ts';
import { recordDirsIn, recordLinkMarkdown, removeRecordLink } from '../src/recordlink.ts';

const DIR = 'attachments/record_20260319_123410';

describe('writing a record link', () => {
  it('writes the title that makes the editor show the player, and keeps the label to one line', () => {
    expect(recordLinkMarkdown('Meeting 19 Mar', DIR)).toBe(`[Meeting 19 Mar](${DIR} "type_record")`);
    expect(recordLinkMarkdown('a [b]\nc', DIR)).toBe(`[a  b  c](${DIR} "type_record")`);
  });
});

describe('finding the records a note shows', () => {
  const spellings: [string, string][] = [
    ['plain', `[M](${DIR} "type_record")`],
    ['single quotes', `[M](${DIR} 'type_record')`],
    ['extra white space', `[M](${DIR}    "type_record")`],
    ['angle brackets', `[M](<${DIR}> "type_record")`],
    ['trailing slash', `[M](${DIR}/ "type_record")`],
    ['from the vault root', `[M](/${DIR} "type_record")`],
    ['escaped space in the label', `[My \\ meeting](${DIR} "type_record")`],
  ];
  it.each(spellings)('finds a link written with %s', (_, link) => {
    expect(recordDirsIn(`Intro\n\n${link}\n`, 'Projects/Plan.md')).toEqual([DIR]);
  });

  it('follows a link written next to the note, and one from a note in a folder', () => {
    expect(recordDirsIn(`[M](../${DIR} "type_record")`, 'Projects/Plan.md')).toEqual([DIR]);
    expect(recordDirsIn(`[M](${DIR} "type_record")`, 'Plan.md')).toEqual([DIR]);
  });

  it('lists each record once and ignores everything that is not a record link', () => {
    const body = [
      `[A](${DIR} "type_record")`,
      `[again](${DIR} "type_record")`,
      `[plain link to the folder](${DIR})`,
      `[another title](${DIR} "audio")`,
      `[a web address](https://example.com/${DIR} "type_record")`,
      `[not a record folder](attachments/photos "type_record")`,
      '```\n[in code](' + DIR + ' "type_record")\n```',
    ].join('\n');
    expect(recordDirsIn(body, 'Plan.md')).toEqual([DIR]);
  });
});

describe('taking a record out of a note', () => {
  it('removes the line of a link that stands alone and nothing else', () => {
    const body = `# Lecture\n\n[M](${DIR} "type_record")\n\nAfter\n`;
    expect(removeRecordLink(body, 'Plan.md', DIR)).toBe('# Lecture\n\n\nAfter\n');
  });
  it('removes only the link when there is more text on its line, and only for that record', () => {
    const other = 'attachments/record_20260320_090000';
    const body = `see [M](${DIR} "type_record") here\n[O](${other} "type_record")\n`;
    expect(removeRecordLink(body, 'Plan.md', DIR)).toBe(`see  here\n[O](${other} "type_record")\n`);
  });
  it('leaves a note without that record exactly as it is', () => {
    const body = `[M](${DIR} "type_record")\n`;
    expect(removeRecordLink(body, 'Plan.md', 'attachments/record_x')).toBe(body);
  });
  it('removes the last line of a note with no final newline', () => {
    expect(removeRecordLink(`Top\n[M](${DIR} "type_record")`, 'Plan.md', DIR)).toBe('Top\n');
  });
});

describe('where a link destination can lead', () => {
  it('tries next to the note first and then the vault root', () => {
    expect(linkTargets('Projects', 'attachments/x.png')).toEqual(['Projects/attachments/x.png', 'attachments/x.png']);
    expect(linkTargets('', 'attachments/x.png')).toEqual(['attachments/x.png']);
    expect(linkTargets('Projects', '/attachments/x.png')).toEqual(['attachments/x.png']);
  });
  it('decodes, drops a fragment, and gives nothing for a web address or a path that leaves the vault', () => {
    expect(linkTargets('', 'My%20notes/a%28b%29.md#top')).toEqual(['My notes/a(b).md']);
    expect(linkTargets('', 'https://example.com/x')).toEqual([]);
    expect(linkTargets('', '#top')).toEqual([]);
    expect(linkTargets('', '../x')).toEqual([]);
  });
});
