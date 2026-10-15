// Records (ADR 0011): the folder layout, the transcript text, near-duplicate frames and the WebM audio that
// MediaRecorder produces. Everything here is pure (bytes in, bytes out) so it runs the same in a browser, in the
// server peer and in tests.

// ---------------------------------------------------------------- names and metadata
export const RECORD_LINK_TITLE = 'type_record';
export const RECORD_DIR_PREFIX = 'record_';
export type RecordKind = 'recording' | 'meeting';

export interface RecordMeta {
  version: 1;
  kind: RecordKind;
  /** ISO time the recording started (device clock) */
  startedAt: string;
  /** length of the audio, seconds */
  seconds: number;
  /** mime of the audio file(s) */
  mime: string;
  /** second -> who chose the frame */
  frames: Record<string, 'user' | 'auto'>;
  /** `recording`: still being written (or the app died); `done`: finished */
  state: 'recording' | 'done';
}

export const newRecordMeta = (kind: RecordKind, startedAt: Date, mime: string): RecordMeta => ({
  version: 1, kind, startedAt: startedAt.toISOString(), seconds: 0, mime, frames: {}, state: 'recording',
});

export function parseRecordMeta(text: string | null | undefined): RecordMeta | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as Partial<RecordMeta>;
    if (!j || typeof j !== 'object') return null;
    const frames: RecordMeta['frames'] = {};
    if (j.frames && typeof j.frames === 'object') for (const [k, v] of Object.entries(j.frames)) if (/^\d+$/.test(k) && (v === 'user' || v === 'auto')) frames[k] = v;
    return {
      version: 1,
      kind: j.kind === 'meeting' ? 'meeting' : 'recording',
      startedAt: typeof j.startedAt === 'string' ? j.startedAt : '',
      seconds: typeof j.seconds === 'number' && j.seconds >= 0 ? j.seconds : 0,
      mime: typeof j.mime === 'string' ? j.mime : 'audio/webm',
      frames,
      state: j.state === 'recording' ? 'recording' : 'done',
    };
  } catch { return null; }
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** `record_20260319_123410` from the device's local time: sorts by time. */
export const recordDirName = (d: Date): string =>
  `${RECORD_DIR_PREFIX}${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
/** True for `attachments/record_…` (the folder itself, not what is inside it). */
export const isRecordDir = (p: string): boolean => /^attachments\/record_[^/]+$/.test(p.replace(/\/+$/, ''));
/** The record folder a path is in or is, if any. */
export const recordDirOf = (p: string): string | null => { const m = /^(attachments\/record_[^/]+)(?:\/|$)/.exec(p); return m ? m[1] : null; };
export const frameFileName = (second: number): string => `${String(Math.max(0, Math.floor(second))).padStart(6, '0')}.jpg`;
/** The second a frame file name stands for, or null when it is not a frame. */
export const frameSecond = (name: string): number | null => { const m = /^(\d{1,9})\.jpe?g$/i.exec(name.slice(name.lastIndexOf('/') + 1)); return m ? Number(m[1]) : null; };
export const partFileName = (n: number): string => `audio-${String(n).padStart(3, '0')}.webm`;
export const isPartName = (name: string): boolean => /^audio-\d{3,}\.[a-z0-9]+$/i.test(name.slice(name.lastIndexOf('/') + 1));

/** `65` -> `1:05`, `3725` -> `62:05` (minutes keep counting: the transcript's marks do). */
export const fmtMark = (s: number): string => `${Math.floor(Math.max(0, s) / 60)}:${p2(Math.floor(Math.max(0, s) % 60))}`;
/** For a timer: `1:02:05` past the hour. */
export const fmtClock = (s: number): string => {
  const t = Math.floor(Math.max(0, s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h ? `${h}:${p2(m)}:${p2(t % 60)}` : `${m}:${p2(t % 60)}`;
};

// ---------------------------------------------------------------- transcript
export interface Segment { start: number; end: number; text: string }
export interface TranscriptBlock { at: number; text: string }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Words grouped by the minute they were said in. */
export function minuteBlocks(segments: Segment[]): TranscriptBlock[] {
  const by = new Map<number, string[]>();
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const t = squash(s.text);
    if (!t) continue;
    const m = Math.floor(Math.max(0, s.start) / 60);
    (by.get(m) ?? by.set(m, []).get(m)!).push(t);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([m, t]) => ({ at: m * 60, text: t.join(' ') }));
}

export const formatTranscript = (blocks: TranscriptBlock[]): string =>
  blocks.filter(b => squash(b.text)).map(b => `[${fmtMark(b.at)}]\n${b.text.trim()}`).join('\n\n') + (blocks.length ? '\n' : '');

/** What a person may have edited: marks stay, words change. Text before the first mark counts as minute 0. */
export function parseTranscript(text: string): TranscriptBlock[] {
  const out: TranscriptBlock[] = [];
  let cur: TranscriptBlock | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*\[(\d{1,4}):([0-5]\d)\]\s*(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { at: Number(m[1]) * 60 + Number(m[2]), text: m[3] };
    } else if (line.trim()) {
      if (!cur) cur = { at: 0, text: '' };
      cur.text += (cur.text ? '\n' : '') + line.trim();
    }
  }
  if (cur) out.push(cur);
  return out.map(b => ({ at: b.at, text: b.text.trim() })).filter(b => b.text);
}

// ---------------------------------------------------------------- frames
/** Frames are compared as tiny gray pictures. */
export const GRAY_W = 160;
export const GRAY_H = 90;

/** Share of pixels that differ by more than `delta` (0-255). Pictures of different size count as entirely different. */
export function changedFraction(a: Uint8Array, b: Uint8Array, delta = 24): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > delta) n++;
  return n / a.length;
}

/** The frames worth keeping: the first, then every one that differs enough from the last one kept. */
export function distinctFlags(grays: Uint8Array[], fraction: number, locked: boolean[] = []): boolean[] {
  const keep: boolean[] = [];
  let last: Uint8Array | null = null;
  grays.forEach((g, i) => {
    const k = !last || locked[i] === true || changedFraction(last, g) >= fraction;
    keep.push(k);
    if (k) last = g;
  });
  return keep;
}

/** While recording: a frame within this share of the last kept one is dropped (a cursor or a blink is far below). */
export const AUTO_DROP_FRACTION = 0.003;
/** The Filter button's stricter pass. */
export const FILTER_FRACTION = 0.02;

// ---------------------------------------------------------------- WebM (what MediaRecorder writes)
const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
  SeekHead: 0x114d9b74, Cues: 0x1c53bb6b, Tags: 0x1254c367, Attachments: 0x1941a469, Chapters: 0x1043a770, Void: 0xec,
  Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
} as const;
const TOP = new Set<number>([ID.Cluster, ID.Cues, ID.Tags, ID.Info, ID.Tracks, ID.SeekHead, ID.Attachments, ID.Chapters, ID.Void, ID.Segment, ID.EBML]);

interface El { id: number; hdr: number; size: number; unknown: boolean; start: number; dataStart: number; end: number }

function readEl(b: Uint8Array, pos: number, limit: number): El | null {
  if (pos >= limit) return null;
  const b0 = b[pos];
  let idLen = 1;
  while (idLen <= 4 && !(b0 & (0x80 >> (idLen - 1)))) idLen++;
  if (idLen > 4 || pos + idLen >= limit) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[pos + i];
  let p = pos + idLen;
  const s0 = b[p];
  let sLen = 1;
  while (sLen <= 8 && !(s0 & (0x80 >> (sLen - 1)))) sLen++;
  if (sLen > 8 || p + sLen > limit) return null;
  let size = s0 & (0xff >> sLen);
  let allOnes = size === (0xff >> sLen);
  for (let i = 1; i < sLen; i++) { size = size * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  p += sLen;
  return { id, hdr: p - pos, size, unknown: allOnes, start: pos, dataStart: p, end: allOnes ? limit : p + size };
}

const uint = (b: Uint8Array, s: number, e: number): number => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]; return v; };

function idBytes(id: number): number[] {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v % 256);
  return out;
}
function sizeBytes(n: number): number[] {
  // always 8 bytes: easy to compute, valid everywhere
  const out = new Array<number>(8).fill(0);
  let v = n;
  for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  out[0] = 0x01;
  return out;
}
const concat = (parts: Uint8Array[]): Uint8Array => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const el = (id: number, body: Uint8Array): Uint8Array => concat([Uint8Array.from([...idBytes(id), ...sizeBytes(body.length)]), body]);
const uintEl = (id: number, v: number): Uint8Array => {
  const raw: number[] = [];
  let x = v;
  for (let i = 0; i < 8; i++) { raw.unshift(x % 256); x = Math.floor(x / 256); }
  return el(id, Uint8Array.from(raw));
};
const floatEl = (id: number, v: number): Uint8Array => {
  const d = new DataView(new ArrayBuffer(8));
  d.setFloat64(0, v);
  return el(id, new Uint8Array(d.buffer));
};
const strEl = (id: number, s: string): Uint8Array => el(id, new TextEncoder().encode(s));

export interface WebmCluster {
  /** ms from the start of the audio */
  at: number;
  /** the cluster's other elements (blocks), bytes as written */
  children: Uint8Array[];
  /** timecode of the last block (cluster time + its offset) */
  last: number;
  /** timecode distance between the last two blocks: how long a block is */
  gap: number;
}
export interface WebmFile {
  ebml: Uint8Array;
  tracks: Uint8Array;
  /** ms per timecode unit * 1e6 ns: 1_000_000 for the usual millisecond clock */
  scale: number;
  clusters: WebmCluster[];
  /** ms: the end of the last block plus one block */
  durationMs: number;
}

export const isWebm = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;

/** Reads a WebM whose Segment and Clusters may have no size (live recording), and one cut off at the end. Null if it is not one. */
export function parseWebm(b: Uint8Array): WebmFile | null {
  if (!isWebm(b)) return null;
  const h = readEl(b, 0, b.length);
  if (!h || h.unknown || h.end > b.length) return null;
  const ebml = b.subarray(0, h.end);
  const seg = readEl(b, h.end, b.length);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.unknown ? b.length : Math.min(b.length, seg.end);
  let tracks: Uint8Array | null = null;
  let scale = 1_000_000;
  const clusters: WebmCluster[] = [];
  let pos = seg.dataStart;
  while (pos < segEnd) {
    const e = readEl(b, pos, segEnd);
    if (!e) break;
    if (e.id === ID.Cluster) {
      const end = e.unknown ? segEnd : Math.min(e.end, segEnd);
      const c: WebmCluster = { at: 0, children: [], last: 0, gap: 0 };
      let q = e.dataStart;
      let rel = 0;
      while (q < end) {
        const ch = readEl(b, q, end);
        if (!ch) break;
        if (TOP.has(ch.id) && ch.id !== ID.Void) break; // the next top-level element ends an unsized cluster
        if (ch.unknown || ch.end > end) break; // cut off
        if (ch.id === ID.Timecode) c.at = uint(b, ch.dataStart, ch.end);
        else if (ch.id === ID.Void) { /* padding */ } else {
          c.children.push(b.subarray(ch.start, ch.end));
          if (ch.id === ID.SimpleBlock && ch.end - ch.dataStart > 4) {
            // track number (a vint), then the block's time relative to its cluster (int16)
            let tl = 1;
            while (tl <= 8 && !(b[ch.dataStart] & (0x80 >> (tl - 1)))) tl++;
            const r = (b[ch.dataStart + tl] << 8) | b[ch.dataStart + tl + 1];
            rel = r > 0x7fff ? r - 0x10000 : r;
            if (c.at + rel > c.last && c.last) c.gap = c.at + rel - c.last;
            c.last = Math.max(c.last, c.at + rel);
          }
        }
        q = ch.end;
      }
      if (c.children.length) clusters.push(c);
      pos = e.unknown ? q : end; // an unsized cluster ends where the next top-level element starts
      continue;
    }
    if (e.id === ID.Tracks && !tracks && e.end <= b.length) tracks = b.subarray(e.start, e.end);
    else if (e.id === ID.Info) {
      let q = e.dataStart;
      while (q < Math.min(e.end, segEnd)) {
        const ch = readEl(b, q, Math.min(e.end, segEnd));
        if (!ch) break;
        if (ch.id === ID.TimecodeScale) scale = uint(b, ch.dataStart, ch.end) || scale;
        q = ch.end;
      }
    }
    if (e.unknown) break;
    pos = e.end;
  }
  if (!tracks || clusters.length === 0) return null;
  const unit = scale / 1_000_000; // timecode units -> ms
  // the audio ends one block after the last block starts
  const lastC = clusters[clusters.length - 1];
  const gap = Math.min(lastC.gap || 20 / unit, 120 / unit);
  return { ebml, tracks, scale, clusters, durationMs: Math.round((Math.max(lastC.last, lastC.at) + gap) * unit) };
}

function writeWebm(f: WebmFile, from: number, to: number): Uint8Array {
  const unit = f.scale / 1_000_000;
  const picked = f.clusters.filter(c => c.at * unit >= from && c.at * unit < to);
  const base = picked.length ? picked[0].at : 0;
  const tail = picked.length ? picked[picked.length - 1] : null;
  const durMs = tail ? Math.round((Math.max(tail.last, tail.at) - base + (tail.gap || 20 / unit)) * unit) : 0;
  const info = el(ID.Info, concat([uintEl(ID.TimecodeScale, f.scale), floatEl(ID.Duration, durMs / unit), strEl(ID.MuxingApp, 'Ergonotes'), strEl(ID.WritingApp, 'Ergonotes')]));
  const clusters = picked.map(c => el(ID.Cluster, concat([uintEl(ID.Timecode, c.at - base), ...c.children])));
  const body = concat([info, f.tracks, ...clusters]);
  return concat([f.ebml, el(ID.Segment, body)]);
}

/** The pieces of one recording put back in order as one file: same Opus packets, a clock and a length added. */
export function joinWebm(parts: Uint8Array[]): { data: Uint8Array; seconds: number } | null {
  const f = parseWebm(concat(parts));
  if (!f) return null;
  return { data: writeWebm(f, 0, Infinity), seconds: f.durationMs / 1000 };
}

/** A playable file of what is between two times (seconds) of a parsed recording, starting at 0. */
export const sliceWebm = (f: WebmFile, fromSec: number, toSec: number): Uint8Array => writeWebm(f, fromSec * 1000, toSec * 1000);
