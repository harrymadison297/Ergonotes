// One recording in progress (ADR 0011): the microphone and, for a meeting, the shared screen's sound and pictures.
// Everything is written to the Vault as it is complete, so a crash loses at most the part being recorded.
import {
  AUTO_DROP_FRACTION, GRAY_H, GRAY_W, changedFraction, frameFileName, joinWebm, newRecordMeta, partFileName, recordDirName, toB64,
  type RecordKind, type RecordMeta, type VaultApi,
} from '@ergonotes/core';

export const PART_SECONDS = 10 * 60;
const FRAME_LONG_EDGE = 1280;

export interface SessionOptions {
  api: VaultApi;
  kind: RecordKind;
  /** meeting only: take pictures of the shared screen */
  frames: boolean;
  /** seconds between pictures */
  every: number;
  /** called when the folder exists and the note should get its link */
  onStarted: (dir: string) => void;
  onChange: (s: SessionState) => void;
  /** part length, seconds (tests use a short one) */
  partSeconds?: number;
}

export interface SessionState {
  phase: 'recording' | 'paused' | 'stopping' | 'done';
  seconds: number;
  level: number;
  frames: number;
  heard: 'mic' | 'both';
  /** what happened that the person should know (the share ended, a write failed) */
  notice: string;
}

export interface SessionResult { dir: string; seconds: number; frames: number; mime: string; audioPath: string | null; notice: string }

export const canShareScreen = (): boolean => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

/** Why recording is impossible here, or null. Browsers only allow the microphone on https and on localhost. */
export function recordingUnavailable(): string | null {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return typeof window !== 'undefined' && window.isSecureContext === false
      ? 'The microphone is only available on a secure connection (https) or on localhost. Open this notebook through https to record.'
      : 'This device or browser cannot record audio.';
  }
  return null;
}

const extOfMime = (m: string) => (m.includes('mp4') ? 'm4a' : m.includes('ogg') ? 'ogg' : 'webm');

export class RecordSession {
  readonly dir: string;
  private o: SessionOptions;
  private meta: RecordMeta;
  private streams: MediaStream[] = [];
  private ctx: AudioContext | null = null;
  private rec: MediaRecorder | null = null;
  private analyser: AnalyserNode | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas = document.createElement('canvas');
  private small = document.createElement('canvas');
  private chunks: Blob[] = [];
  private parts: Uint8Array[] = [];
  private partNo = 0;
  private partStartAt = 0;
  private mime = 'audio/webm';
  private carried = 0;
  private resumedAt = 0;
  private tick: ReturnType<typeof setInterval> | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private lastGray: Uint8Array | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private state: SessionState = { phase: 'recording', seconds: 0, level: 0, frames: 0, heard: 'mic', notice: '' };
  private finish: ((r: SessionResult) => void) | null = null;
  private discarded = false;
  private capturing = false;

  constructor(o: SessionOptions, now = new Date()) {
    this.o = o;
    this.dir = `attachments/${recordDirName(now)}`;
    this.meta = newRecordMeta(o.kind, now, 'audio/webm');
  }

  get seconds(): number {
    return this.carried + (this.resumedAt ? (Date.now() - this.resumedAt) / 1000 : 0);
  }

  private emit(p: Partial<SessionState> = {}) {
    this.state = { ...this.state, ...p, seconds: Math.floor(this.seconds) };
    this.o.onChange(this.state);
  }

  /** Serialised writes: frames and parts never overtake each other, and a failed one is reported, not fatal. */
  private write(name: string, mime: string, bytes: Uint8Array | string, sub = ''): Promise<void> {
    const data = typeof bytes === 'string' ? toB64(new TextEncoder().encode(bytes)) : toB64(bytes);
    const job = this.queue.then(() => this.o.api.addFile({ name, mime, data, dir: sub ? `${this.dir}/${sub}` : this.dir }))
      .then(() => undefined, e => { this.emit({ notice: `Could not save ${name}: ${e instanceof Error ? e.message : String(e)}` }); });
    this.queue = job;
    return job;
  }
  private writeMeta() {
    this.meta.seconds = Math.floor(this.seconds);
    return this.write('record.json', 'application/json', JSON.stringify(this.meta, null, 2));
  }

  async start(): Promise<void> {
    const { kind } = this.o;
    let display: MediaStream | null = null;
    try {
      // the picker needs the click that started this, so it comes before the microphone prompt
      if (kind === 'meeting') {
        if (!canShareScreen()) throw new Error('This browser cannot share the screen, so a meeting cannot be recorded here. Use a recording instead.');
        try {
          display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch {
          throw new Error('Nothing was shared, so nothing is recorded. Choose the tab or window of the call and tick “Share audio”.');
        }
        this.streams.push(display);
        if (display.getAudioTracks().length === 0) {
          throw new Error('The picture was shared but not its sound. Choose again: a browser tab with “Share tab audio” ticked, or “Entire Screen” with “Share with system audio” turned on (a single window has no sound).');
        }
      }
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.streams.push(mic);
      const ac = new AudioContext();
      void ac.resume();
      this.ctx = ac;
      const mix = ac.createMediaStreamDestination();
      const an = ac.createAnalyser();
      an.fftSize = 256;
      this.analyser = an;
      for (const st of [mic, ...(display ? [new MediaStream(display.getAudioTracks())] : [])]) {
        const src = ac.createMediaStreamSource(st);
        src.connect(mix);
        src.connect(an);
      }
      this.state.heard = display ? 'both' : 'mic';
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(mix.stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      this.rec = r;
      this.mime = (r.mimeType || mime || 'audio/webm').split(';')[0];
      this.meta.mime = this.mime;

      if (display) {
        const vt = display.getVideoTracks()[0];
        if (vt) {
          if (this.o.frames) {
            const v = document.createElement('video');
            v.muted = true;
            v.playsInline = true;
            v.srcObject = new MediaStream([vt]);
            await v.play().catch(() => undefined);
            this.video = v;
          } else {
            // only the sound is wanted: the picture is kept alive (stopping it would end the share)
            void vt.applyConstraints({ frameRate: 1 }).catch(() => undefined);
            vt.enabled = false;
          }
          vt.addEventListener('ended', () => this.interrupted('The screen is no longer shared. The recording was stopped and what was captured is kept.'));
        }
        display.getAudioTracks()[0]?.addEventListener('ended', () => this.interrupted('The shared sound ended. The recording was stopped and what was captured is kept.'));
      }
      mic.getAudioTracks()[0]?.addEventListener('ended', () => this.interrupted('The microphone stopped. The recording was stopped and what was captured is kept.'));

      r.ondataavailable = e => {
        if (e.data.size) this.chunks.push(e.data);
        if (this.seconds - this.partStartAt >= (this.o.partSeconds ?? PART_SECONDS)) void this.flushPart();
      };
      r.onstop = () => { void this.complete(); };
      this.carried = 0;
      this.resumedAt = Date.now();
      r.start(1000);
      await this.writeMeta();
      this.o.onStarted(this.dir);
      this.tick = setInterval(() => this.emit(), 250);
      const buf = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        this.state.level = Math.min(1, peak / 64);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
      if (this.video) this.frameTimer = setInterval(() => { void this.capture(false); }, Math.max(1, this.o.every) * 1000);
      this.emit();
    } catch (e) {
      this.release();
      throw e;
    }
  }

  private interrupted(why: string) {
    if (this.state.phase === 'stopping' || this.state.phase === 'done') return;
    this.emit({ notice: why });
    this.stop();
  }

  pause() {
    const r = this.rec;
    if (!r || r.state !== 'recording') return;
    r.pause();
    this.carried += (Date.now() - this.resumedAt) / 1000;
    this.resumedAt = 0;
    this.emit({ phase: 'paused' });
  }
  resume() {
    const r = this.rec;
    if (!r || r.state !== 'paused') return;
    r.resume();
    this.resumedAt = Date.now();
    this.emit({ phase: 'recording' });
  }
  stop() {
    const r = this.rec;
    if (!r || r.state === 'inactive') return;
    if (r.state === 'paused') this.resumedAt = 0; else { this.carried = this.seconds; this.resumedAt = 0; }
    this.emit({ phase: 'stopping' });
    r.stop();
  }
  /** Throw the recording away: its files are removed and `onStarted`'s link must be taken out by the caller. */
  async discard() {
    this.discarded = true;
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    this.release();
    await this.queue;
    await this.o.api.removeFiles(await this.paths()).catch(() => 0);
  }
  private async paths(): Promise<string[]> {
    const r = await this.o.api.getRecord(this.dir).catch(() => null);
    return r ? [...r.audio, ...r.frames.map(f => f.path), `${this.dir}/record.json`, `${this.dir}/transcript.txt`] : [];
  }

  /** A picture now. `byPerson`: taken by the button, so it is always kept. */
  async capture(byPerson: boolean): Promise<boolean> {
    const v = this.video;
    if (!v || this.capturing || (this.state.phase !== 'recording' && !byPerson) || v.videoWidth === 0) return false;
    this.capturing = true;
    try {
      const w = v.videoWidth, h = v.videoHeight;
      const k = Math.min(1, FRAME_LONG_EDGE / Math.max(w, h));
      this.canvas.width = Math.round(w * k);
      this.canvas.height = Math.round(h * k);
      this.canvas.getContext('2d')!.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      this.small.width = GRAY_W;
      this.small.height = GRAY_H;
      const sc = this.small.getContext('2d', { willReadFrequently: true })!;
      sc.drawImage(this.canvas, 0, 0, GRAY_W, GRAY_H);
      const px = sc.getImageData(0, 0, GRAY_W, GRAY_H).data;
      const gray = new Uint8Array(GRAY_W * GRAY_H);
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
      // while recording, a frame that is practically the last one kept is not worth a file
      if (!byPerson && this.lastGray && changedFraction(this.lastGray, gray) < AUTO_DROP_FRACTION) return false;
      const sec = Math.floor(this.seconds);
      const blob = await new Promise<Blob | null>(res => this.canvas.toBlob(res, 'image/jpeg', 0.7));
      if (!blob) return false;
      this.lastGray = gray;
      this.meta.frames[String(sec)] = byPerson ? 'user' : (this.meta.frames[String(sec)] ?? 'auto');
      this.state.frames = Object.keys(this.meta.frames).length;
      void this.write(frameFileName(sec), 'image/jpeg', new Uint8Array(await blob.arrayBuffer()), 'frames');
      this.emit();
      return true;
    } finally {
      this.capturing = false;
    }
  }

  private async flushPart() {
    if (!this.chunks.length) return;
    const bytes = new Uint8Array(await new Blob(this.chunks).arrayBuffer());
    this.chunks = [];
    this.partStartAt = this.seconds;
    this.parts.push(bytes);
    this.partNo++;
    void this.write(partFileName(this.partNo).replace(/\.webm$/, `.${extOfMime(this.mime)}`), this.mime, bytes);
    void this.writeMeta();
  }

  private async complete() {
    this.release();
    if (this.discarded) return;
    const seconds = Math.floor(this.carried);
    await this.flushPart();
    await this.queue;
    let audioPath: string | null = null;
    const ext = extOfMime(this.mime);
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    if (total > 0) {
      // the pieces become one file: the same packets, with a length and a clock; anything else is just joined
      let data: Uint8Array;
      let secs = seconds;
      const joined = this.mime === 'audio/webm' ? joinWebm(this.parts) : null;
      if (joined) { data = joined.data; secs = Math.round(joined.seconds); }
      else { data = new Uint8Array(total); let o = 0; for (const p of this.parts) { data.set(p, o); o += p.length; } }
      this.meta.seconds = Math.max(secs, 0);
      await this.write(`audio.${ext}`, this.mime, data);
      await this.queue;
      const written = await this.o.api.getRecord(this.dir).catch(() => null);
      if (written && written.audio.some(p => p.endsWith(`/audio.${ext}`))) {
        audioPath = `${this.dir}/audio.${ext}`;
        const pieces = Array.from({ length: this.partNo }, (_, i) => `${this.dir}/${partFileName(i + 1).replace(/\.webm$/, `.${ext}`)}`);
        await this.o.api.removeFiles(pieces).catch(() => 0);
      }
    }
    this.meta.state = 'done';
    this.meta.seconds = this.meta.seconds || seconds;
    await this.writeMeta();
    await this.queue;
    this.state.phase = 'done';
    this.emit();
    this.finish?.({ dir: this.dir, seconds: this.meta.seconds, frames: Object.keys(this.meta.frames).length, mime: this.mime, audioPath, notice: this.state.notice });
  }

  /** Resolves when the recording has been stopped and everything is saved. */
  done(): Promise<SessionResult> {
    return new Promise(res => { this.finish = res; });
  }

  private release() {
    if (this.tick) clearInterval(this.tick);
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.tick = this.frameTimer = null;
    cancelAnimationFrame(this.raf);
    this.streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.streams = [];
    if (this.video) { this.video.srcObject = null; this.video = null; }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  /** Final cleanup when the component goes away while recording: the recording is saved, not thrown away. */
  dispose() {
    if (this.rec && this.rec.state !== 'inactive') this.stop();
  }
}

