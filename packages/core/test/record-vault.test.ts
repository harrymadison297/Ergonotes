// Records in the vault (ADR 0011): files of a record folder, how a note's link keeps them, and what trash and purge do.
import { describe, expect, it } from 'vitest';
import { MemFs } from '../src/vaultfs.ts';
import { MemPersist } from '../src/persist.ts';
import { Vault } from '../src/vault.ts';
import { formatTranscript } from '../src/record.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const DIR = 'attachments/record_20260319_123410';

async function setup() {
  const fs = new MemFs();
  const v = await Vault.open({ persist: new MemPersist(), fs, kdf: KDF, defaultDeviceName: 'A', settleMs: 0, watchMs: 0 });
  await v.createVault(PASSWORD);
  return { v, fs };
}

async function makeRecord(v: Vault, dir = DIR) {
  await v.addFile({ name: 'audio-001.webm', mime: 'audio/webm', data: b64('part one'), dir });
  await v.addFile({ name: '000012.jpg', mime: 'image/jpeg', data: b64('frame'), dir: `${dir}/frames` });
  await v.addFile({ name: '000099.jpg', mime: 'image/jpeg', data: b64('frame'), dir: `${dir}/frames` }); // same bytes, another second
  await v.addFile({ name: 'transcript.txt', mime: 'text/plain', data: b64(formatTranscript([{ at: 0, text: 'Hello' }])), dir });
  await v.addFile({ name: 'record.json', mime: 'application/json', data: b64(JSON.stringify({ kind: 'meeting', startedAt: '2026-03-19T12:34:10.000Z', seconds: 120, frames: { '12': 'user' }, state: 'done' })), dir });
}

describe('a record folder', () => {
  it('keeps every file under its own name, even two with the same bytes', async () => {
    const { v, fs } = await setup();
    await makeRecord(v);
    expect(fs.list().filter(p => p.startsWith(DIR)).sort()).toEqual([
      `${DIR}/audio-001.webm`, `${DIR}/frames/000012.jpg`, `${DIR}/frames/000099.jpg`, `${DIR}/record.json`, `${DIR}/transcript.txt`,
    ]);
    const r = (await v.getRecord(DIR))!;
    expect(r.audio).toEqual([`${DIR}/audio-001.webm`]);
    expect(r.frames.map(f => f.second)).toEqual([12, 99]);
    expect(r.transcript).toBe('[0:00]\nHello\n');
    expect(r.meta).toMatchObject({ kind: 'meeting', seconds: 120, frames: { '12': 'user' }, state: 'done' });
    expect(r.noteId).toBeNull();
  });

  it('replaces a file written again and prefers the joined audio to its pieces', async () => {
    const { v, fs } = await setup();
    await makeRecord(v);
    await v.addFile({ name: 'record.json', mime: 'application/json', data: b64('{"kind":"recording","seconds":300,"state":"done"}'), dir: DIR });
    expect((await v.getRecord(DIR))!.meta?.seconds).toBe(300);
    expect(fs.list().filter(p => p.endsWith('record.json'))).toEqual([`${DIR}/record.json`]);
    await v.addFile({ name: 'audio.webm', mime: 'audio/webm', data: b64('joined'), dir: DIR });
    expect((await v.getRecord(DIR))!.audio).toEqual([`${DIR}/audio.webm`]);
    expect(await v.removeFiles([`${DIR}/audio-001.webm`])).toBe(1);
    expect(fs.list()).not.toContain(`${DIR}/audio-001.webm`);
  });

  it('is not a folder of the tree, a file of the Files list, or reachable from outside attachments/', async () => {
    const { v } = await setup();
    await makeRecord(v);
    expect((await v.listItems()).some(i => i.filePath.startsWith('attachments'))).toBe(false);
    expect(await v.listFiles()).toEqual([]);
    expect((await v.listRecords()).map(r => r.path)).toEqual([DIR]);
    await expect(v.addFile({ name: 'x.jpg', mime: 'image/jpeg', data: b64('x'), dir: 'Projects/record_1' })).rejects.toThrow(/record/);
    await expect(v.addFile({ name: 'x.exe', mime: 'application/octet-stream', data: b64('x'), dir: DIR })).rejects.toThrow(/kind of file/);
    expect(await v.removeFiles(['Projects/Plan.md'])).toBe(0);
  });

  it('allows a file of 100 MB and refuses more', async () => {
    const { v } = await setup();
    await expect(v.addFile({ name: 'big.zip', mime: 'application/zip', data: 'A'.repeat(Math.ceil((101 * 1024 * 1024 * 4) / 3)) })).rejects.toThrow(/100 MB/);
  });
});

describe('a note that shows a record', () => {
  const link = (dir = DIR) => `## Meeting\n\n[Meeting 19 Mar · 2:00](${dir} "type_record")\n`;

  it('knows its note, and the record goes to the Trash and back with it', async () => {
    const { v, fs } = await setup();
    await makeRecord(v);
    const n = await v.createNote({ title: 'Lecture', body: link() });
    expect((await v.getRecord(DIR))!.noteTitle).toBe('Lecture');
    await v.trash(n.id);
    expect(fs.list().filter(p => p.startsWith(DIR))).toEqual([]);
    expect(fs.list().filter(p => p.startsWith('.trash/' + DIR)).length).toBe(5);
    expect((await v.listRecords())).toEqual([]);
    await v.restore(n.id);
    expect(fs.list().filter(p => p.startsWith(DIR)).length).toBe(5);
    expect((await v.getRecord(DIR))!.frames).toHaveLength(2);
  });

  it('leaves the record where it is while another note still shows it', async () => {
    const { v, fs } = await setup();
    await makeRecord(v);
    const a = await v.createNote({ title: 'A', body: link() });
    await v.createNote({ title: 'B', body: link() });
    await v.trash(a.id);
    expect(fs.list().filter(p => p.startsWith(DIR)).length).toBe(5);
    await v.purge(a.id);
    expect(fs.list().filter(p => p.startsWith(DIR)).length).toBe(5);
  });

  it('removes the record when the last note that showed it is deleted for good', async () => {
    const { v, fs } = await setup();
    await makeRecord(v);
    const n = await v.createNote({ title: 'Only', body: link() });
    await v.trash(n.id);
    await v.purge(n.id);
    expect(fs.list().filter(p => p.includes('record_'))).toEqual([]);
    expect(await v.listRecords()).toEqual([]);
  });

  it('finds the folder from a note in a sub-folder and follows a moved note', async () => {
    const { v } = await setup();
    await makeRecord(v);
    const inbox = (await v.listItems()).find(i => i.title === 'Inbox')!;
    const n = await v.createNote({ title: 'Deep', parent: inbox.id, body: link('../' + DIR) });
    expect((await v.getRecord(DIR))!.noteTitle).toBe('Deep');
    const areas = (await v.listItems()).find(i => i.title === 'Projects')!;
    await v.move(n.id, areas.id);
    expect((await v.getNote(n.id))!.body).toContain(`(../${DIR} "type_record")`);
  });
});
