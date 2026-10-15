import { describe, expect, it } from 'vitest';
import {
  changedFraction, distinctFlags, fmtClock, fmtMark, formatTranscript, frameFileName, frameSecond, isRecordDir, joinWebm, minuteBlocks, parseRecordMeta,
  parseTranscript, parseWebm, recordDirName, recordDirOf, sliceWebm,
} from '../src/record.ts';

// A WebM as Chrome's MediaRecorder writes it: no size on the Segment or the Clusters, no Duration, no Cues.
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const idb = (id: number) => { const o: number[] = []; for (let v = id; v > 0; v = Math.floor(v / 256)) o.unshift(v % 256); return o; };
const sized = (id: number, body: number[]) => [...idb(id), 0x80 | body.length, ...body]; // bodies here are < 127 bytes
const big = (id: number, body: number[]) => [...idb(id), 0x01, 0, 0, 0, 0, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
function liveWebm(seconds: number, blockMs = 20, clusterMs = 1000): Uint8Array {
  const out: number[] = [];
  out.push(...sized(0x1a45dfa3, [...sized(0x4282, [...'webm'].map(c => c.charCodeAt(0)))]));
  out.push(...idb(0x18538067), ...UNKNOWN);
  out.push(...sized(0x1549a966, [...sized(0x2ad7b1, [0x0f, 0x42, 0x40]), ...sized(0x4d80, [...'Chrome'].map(c => c.charCodeAt(0)))]));
  out.push(...sized(0x1654ae6b, [...sized(0xae, [...sized(0xd7, [1]), ...sized(0x83, [2]), ...sized(0x86, [...'A_OPUS'].map(c => c.charCodeAt(0)))])]));
  for (let t = 0; t < seconds * 1000; t += clusterMs) {
    out.push(...idb(0x1f43b675), ...UNKNOWN);
    out.push(...sized(0xe7, [(t >> 8) & 255, t & 255]));
    for (let r = 0; r < clusterMs; r += blockMs) {
      // track 1, relative time, flags (keyframe), a pretend packet that says where it is
      out.push(...sized(0xa3, [0x81, (r >> 8) & 255, r & 255, 0x80, (t / 1000) & 255, (r / 20) & 255]));
    }
  }
  return Uint8Array.from(out);
}
const split = (b: Uint8Array, at: number[]) => [0, ...at, b.length].slice(0, -1).map((s, i, a) => b.subarray(s, [...at, b.length][i]));

describe('names', () => {
  it('names a record folder after the local time and recognises it', () => {
    const d = new Date(2026, 2, 19, 12, 34, 10);
    expect(recordDirName(d)).toBe('record_20260319_123410');
    expect(isRecordDir('attachments/record_20260319_123410')).toBe(true);
    expect(isRecordDir('attachments/record_20260319_123410/frames')).toBe(false);
    expect(recordDirOf('attachments/record_20260319_123410/frames/000012.jpg')).toBe('attachments/record_20260319_123410');
    expect(recordDirOf('attachments/photo.jpg')).toBeNull();
  });
  it('names frames by second and reads them back', () => {
    expect(frameFileName(12)).toBe('000012.jpg');
    expect(frameSecond('attachments/r/frames/000012.jpg')).toBe(12);
    expect(frameSecond('notes.jpg')).toBeNull();
  });
  it('formats time', () => {
    expect(fmtMark(65)).toBe('1:05');
    expect(fmtMark(3725)).toBe('62:05');
    expect(fmtClock(3725)).toBe('1:02:05');
  });
  it('reads metadata defensively', () => {
    expect(parseRecordMeta('not json')).toBeNull();
    const m = parseRecordMeta(JSON.stringify({ kind: 'meeting', seconds: 12, frames: { '5': 'user', x: 'auto', '6': 'bogus' }, state: 'recording' }))!;
    expect(m.kind).toBe('meeting');
    expect(m.frames).toEqual({ '5': 'user' });
    expect(m.state).toBe('recording');
  });
});

describe('transcript text', () => {
  it('groups segments by minute and reads them back after a person edits the words', () => {
    const blocks = minuteBlocks([
      { start: 0, end: 5, text: 'Hello  everyone.' }, { start: 30, end: 40, text: 'Today: records.' },
      { start: 61, end: 70, text: 'Second minute.' }, { start: 3725, end: 3730, text: 'Much later.' },
    ]);
    expect(blocks.map(b => b.at)).toEqual([0, 60, 3720]);
    const text = formatTranscript(blocks);
    expect(text).toBe('[0:00]\nHello everyone. Today: records.\n\n[1:00]\nSecond minute.\n\n[62:00]\nMuch later.\n');
    const edited = text.replace('Hello everyone.', 'Hello, everybody.\nA second line.');
    expect(parseTranscript(edited)).toEqual([
      { at: 0, text: 'Hello, everybody.\nA second line. Today: records.' }, { at: 60, text: 'Second minute.' }, { at: 3720, text: 'Much later.' },
    ]);
  });
  it('puts words before the first mark in minute zero', () => {
    expect(parseTranscript('just words\n[2:00]\nmore')).toEqual([{ at: 0, text: 'just words' }, { at: 120, text: 'more' }]);
  });
});

describe('frames', () => {
  const flat = (v: number) => new Uint8Array(160 * 90).fill(v);
  it('measures how much of a picture changed', () => {
    const a = flat(100);
    const b = flat(100);
    for (let i = 0; i < 20; i++) b[i] = 200; // a cursor
    expect(changedFraction(a, b)).toBeCloseTo(20 / 14400);
    expect(changedFraction(a, flat(100))).toBe(0);
    expect(changedFraction(a, new Uint8Array(4))).toBe(1);
  });
  it('keeps the first frame, real changes and the ones the person took', () => {
    const cursor = flat(100); cursor[5] = 255;
    const slide2 = flat(30);
    const same = flat(100);
    const keep = distinctFlags([flat(100), cursor, same, slide2, slide2.slice()], 0.003);
    expect(keep).toEqual([true, false, false, true, false]);
    expect(distinctFlags([flat(100), flat(100)], 0.003, [false, true])).toEqual([true, true]);
  });
});

describe('WebM', () => {
  it('reads a live recording and finds its length', () => {
    const f = parseWebm(liveWebm(5))!;
    expect(f.clusters).toHaveLength(5);
    expect(f.clusters[3].at).toBe(3000);
    expect(f.durationMs).toBe(5000);
  });
  it('puts parts cut anywhere back together with a length and without changing a packet', () => {
    const src = liveWebm(30);
    const parts = split(src, [137, 5000, 5001, 9000]);
    expect(parts.map(p => p.length).reduce((a, b) => a + b)).toBe(src.length);
    const j = joinWebm(parts)!;
    expect(j.seconds).toBe(30);
    const back = parseWebm(j.data)!;
    const orig = parseWebm(src)!;
    expect(back.clusters).toHaveLength(30);
    expect(back.durationMs).toBe(30000);
    expect(back.clusters.map(c => c.at)).toEqual(orig.clusters.map(c => c.at));
    expect(back.clusters.map(c => c.children.map(x => [...x].join())).flat()).toEqual(orig.clusters.map(c => c.children.map(x => [...x].join())).flat());
    // and again: the result is itself a valid input
    expect(joinWebm([j.data])!.data).toEqual(j.data);
  });
  it('keeps what was written when the last part is cut off', () => {
    const src = liveWebm(10);
    const f = parseWebm(src.subarray(0, src.length - 700))!;
    expect(f.clusters.length).toBeGreaterThanOrEqual(8);
    expect(joinWebm([src.subarray(0, src.length - 700)])!.seconds).toBeGreaterThan(8);
  });
  it('cuts a piece that starts at zero', () => {
    const f = parseWebm(liveWebm(30))!;
    const piece = parseWebm(sliceWebm(f, 10, 20))!;
    expect(piece.clusters).toHaveLength(10);
    expect(piece.clusters[0].at).toBe(0);
    expect(piece.durationMs).toBe(10000);
    // the third second of the piece is the thirteenth of the whole: same packets
    expect([...piece.clusters[3].children[0]].join()).toBe([...f.clusters[13].children[0]].join());
  });
  it('says no to what is not WebM', () => {
    expect(parseWebm(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(joinWebm([new TextEncoder().encode('nothing here')])).toBeNull();
  });
});
