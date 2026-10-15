import { describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import { parseEvents, plainSnippet } from '../src/markdown.ts';

const PASSWORD = 'correct horse battery staple';
async function vault() {
  const v = await Vault.open({ persist: new MemPersist(), kdf: { m: 256, t: 1, p: 1 }, defaultDeviceName: 'A', storeFactory: () => new MemStore() });
  await v.createVault(PASSWORD);
  return v;
}

describe('events', () => {
  it('reads dated events with and without a time, in lists, and skips code fences', () => {
    const body = ['Team sync @event(2026-10-20T09:00-10:30)', '- [ ] Dentist @event(2026-10-21T15:00)', '> Holiday @event(2026-12-25)', '```', 'x @event(2026-01-01)', '```', 'Nothing here'].join('\n');
    expect(parseEvents(body)).toEqual([
      { line: 0, text: 'Team sync', date: '2026-10-20', start: '09:00', end: '10:30' },
      { line: 1, text: 'Dentist', date: '2026-10-21', start: '15:00', end: undefined },
      { line: 2, text: 'Holiday', date: '2026-12-25', start: undefined, end: undefined },
    ]);
  });

  it('lands in the calendar for its day, with the note it came from', async () => {
    const v = await vault();
    const n = await v.createNote({ title: 'Plans', body: 'Team sync @event(2026-10-20T09:00-10:30)\n\nAll hands @event(2026-11-02)' });
    const cal = await v.calendar('2026-10-01T00:00', '2026-10-31T23:59');
    expect(cal.events).toHaveLength(1);
    expect(cal.events[0]).toMatchObject({ noteId: n.id, noteTitle: 'Plans', text: 'Team sync', date: '2026-10-20', start: '09:00', end: '10:30' });
  });

  it('keeps the new tokens out of list previews', () => {
    const s = plainSnippet('Team sync @event(2026-10-20T09:00)\n\n<div style="page-break-after: always;"></div>\n\nOn @date(2026-10-20) we ship.');
    expect(s).toBe('Team sync On 2026-10-20 we ship.');
  });
});

describe('HTML export of the richer elements', () => {
  it('turns toggles into <details>, page breaks and voice notes into their HTML', async () => {
    const v = await vault();
    const f = await v.addFile({ name: 'voice.webm', mime: 'audio/webm', data: 'AAAA' });
    const n = await v.createNote({
      title: 'Elements',
      body: [
        '# One', '## Two', '<details>\n<summary>More</summary>\n\nhidden **text**\n\n</details>', '<div style="page-break-after: always;"></div>',
        `[Voice note 0:05](${f.path} "audio")`, 'Meet @event(2026-10-20T09:00) on @date(2026-10-20)',
      ].join('\n\n'),
    });
    const r = await v.exportNote(n.id, 'html');
    expect(r.content).toContain('<details open>');
    expect(r.content).toContain('<summary>More</summary>');
    expect(r.content).toContain('</details>');
    expect(r.content).toContain('break-after:page');
    expect(r.content).toContain('<audio controls src="data:audio/webm;base64,AAAA"></audio> Voice note 0:05');
    expect(r.content).toContain('event 2026-10-20T09:00');
    const md = await v.exportNote(n.id, 'md');
    expect(md.content).toContain('(data:audio/webm;base64,AAAA "audio")');
  });
});
