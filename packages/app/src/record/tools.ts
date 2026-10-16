// What is done to a record after it was made: writing out its speech, and tidying its frames.
import {
  FILTER_FRACTION, GRAY_H, GRAY_W, audioExt, concatBytes, distinctFlags, grayFromRgba, formatTranscript, fromB64, isWebm, minuteBlocks, parseWebm, recommendCuts, sliceWebm, toB64,
  type AiTransport, type AudioFile, type RecordInfo, type Segment, type TimedTranscript, type VaultApi,
} from '@ergonotes/core';

/** The audio of a record as bytes: its one file, or its pieces in order. */
export async function recordAudio(api: VaultApi, info: RecordInfo): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const chunks: Uint8Array[] = [];
  let mime = info.meta?.mime || 'audio/webm';
  for (const p of info.audio) {
    const f = await api.getFileByPath(p);
    if (!f) continue;
    mime = f.mime || mime;
    chunks.push(fromB64(f.data));
  }
  return chunks.length ? { bytes: concatBytes(chunks), mime } : null;
}

export interface TranscribeOptions {
  api: VaultApi;
  dir: string;
  transcribe: (file: AudioFile, signal?: AbortSignal) => Promise<TimedTranscript>;
  onStatus: (s: string) => void;
  signal?: AbortSignal;
  /** seconds of audio per request */
  windowSec?: number;
}

/**
 * Writes `transcript.txt`: the audio is sent in windows (each far below a server's 25 MB), the phrases' times are
 * moved to where the window was, and the words are grouped into one block per minute.
 */
export async function transcribeRecord(o: TranscribeOptions): Promise<string> {
  const info = await o.api.getRecord(o.dir);
  if (!info) throw new Error('This record has no audio.');
  const audio = await recordAudio(o.api, info);
  if (!audio) throw new Error('This record has no audio.');
  const segs: Segment[] = [];
  const ask = async (bytes: Uint8Array, name: string, mime: string): Promise<TimedTranscript> =>
    o.transcribe({ name, mime, data: toB64(bytes) }, o.signal);
  const parsed = isWebm(audio.bytes) ? parseWebm(audio.bytes) : null;
  if (parsed) {
    const total = parsed.durationMs / 1000;
    const win = o.windowSec ?? 600;
    const n = Math.max(1, Math.ceil(total / win));
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new Error('Cancelled');
      o.onStatus(`Writing it out… ${i + 1}/${n}`);
      const from = i * win;
      const part = await ask(sliceWebm(parsed, from, from + win), `part-${i + 1}.webm`, 'audio/webm');
      if (part.segments.length) { for (const s of part.segments) segs.push({ start: s.start + from, end: s.end + from, text: s.text }); continue; }
      if (!part.text.trim()) continue; // a silent stretch
      // this server gives the words without times: ask again minute by minute so the marks stay right
      const minutes = Math.ceil(Math.min(win, total - from) / 60);
      for (let m = 0; m < minutes; m++) {
        if (o.signal?.aborted) throw new Error('Cancelled');
        o.onStatus(`Writing it out… ${i + 1}/${n} · minute ${m + 1}/${minutes}`);
        const t = await ask(sliceWebm(parsed, from + m * 60, from + (m + 1) * 60), `minute-${from / 60 + m + 1}.webm`, 'audio/webm');
        if (t.text.trim()) segs.push({ start: from + m * 60, end: from + (m + 1) * 60, text: t.text });
      }
    }
  } else {
    if (audio.bytes.length > 24 * 1024 * 1024) throw new Error('This recording is larger than the 25 MB a transcription server accepts.');
    o.onStatus('Writing it out…');
    const t = await ask(audio.bytes, `audio.${audioExt(audio.mime)}`, audio.mime);
    if (t.segments.length) segs.push(...t.segments); else if (t.text.trim()) segs.push({ start: 0, end: 0, text: t.text });
  }
  const text = formatTranscript(minuteBlocks(segs));
  if (!text.trim()) throw new Error('No speech was found in it.');
  await o.api.addFile({ name: 'transcript.txt', mime: 'text/plain', data: toB64(new TextEncoder().encode(text)), dir: o.dir });
  return text;
}

// ---------------------------------------------------------------- frames
async function grayOf(jpeg: Uint8Array): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
  const c = document.createElement('canvas');
  c.width = GRAY_W;
  c.height = GRAY_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, GRAY_W, GRAY_H);
  bmp.close();
  return grayFromRgba(ctx.getImageData(0, 0, GRAY_W, GRAY_H).data);
}

export interface FrameProposal {
  second: number;
  path: string;
  /** a frame the person took: never proposed */
  user: boolean;
  /** why it is proposed (nothing: it stays) */
  why: 'same' | 'ai' | null;
}

export interface FilterOptions {
  api: VaultApi;
  info: RecordInfo;
  /** with a vision model: send what is left to it */
  transport?: AiTransport | null;
  onStatus: (s: string) => void;
  signal?: AbortSignal;
}

/** The stricter local pass, then (when asked) the model's opinion. Nothing is deleted here. */
export async function proposeFrameCuts(o: FilterOptions): Promise<{ proposals: FrameProposal[]; failed: number }> {
  const frames = o.info.frames;
  const user = new Set(Object.entries(o.info.meta?.frames ?? {}).filter(([, v]) => v === 'user').map(([k]) => Number(k)));
  const blobs = new Map<number, Uint8Array>();
  const grays: Uint8Array[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (o.signal?.aborted) throw new Error('Cancelled');
    o.onStatus(`Comparing frames… ${i + 1}/${frames.length}`);
    const f = await o.api.getFileByPath(frames[i].path);
    if (!f) { grays.push(new Uint8Array(GRAY_W * GRAY_H)); continue; }
    const bytes = fromB64(f.data);
    blobs.set(frames[i].second, bytes);
    grays.push(await grayOf(bytes));
  }
  const keep = distinctFlags(grays, FILTER_FRACTION, frames.map(f => user.has(f.second)));
  const proposals: FrameProposal[] = frames.map((f, i) => ({ second: f.second, path: f.path, user: user.has(f.second), why: keep[i] ? null : 'same' }));
  let failed = 0;
  if (o.transport) {
    // the person's own frames are never put to the model, and neither are the ones the local pass already cut
    const forModel = proposals.filter(p => p.why === null && !p.user);
    if (forModel.length) {
      o.onStatus(`Asking the model… 0/${forModel.length}`);
      const r = await recommendCuts(o.transport, forModel.map(p => ({ second: p.second, jpeg: toB64(blobs.get(p.second) ?? new Uint8Array()) })), {
        signal: o.signal, onProgress: (d, t) => o.onStatus(`Asking the model… ${d}/${t}`),
      });
      failed = r.failed;
      const cut = new Set(r.cut);
      for (const p of forModel) if (cut.has(p.second)) p.why = 'ai';
    }
  }
  return { proposals, failed };
}
