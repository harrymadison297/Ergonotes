// Speech-to-text on this computer: the desktop app runs whisper.cpp (src-tauri/src/whisper.rs) with a model the person
// downloads in Settings → AI. The web view only decodes the audio to 16 kHz mono; every phone and the web build answer
// "not available" and keep using a server.
import { fromB64, type AudioFile, type TimedTranscript } from '@ergonotes/core';

export interface LocalModel { id: string; label: string; size: number; downloaded: boolean }
export interface LocalProgress { id: string; received: number; total: number }

/** What this device chose: nothing synced, because the model files live on this computer only. */
interface Choice { model: string; language: string }
const STORE = 'ergo.localSpeech';
const EVENT = 'ergo-local-speech';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown> | ArrayBuffer, headers?: Record<string, string>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  // the shell rejects with the plain text of its error: make it an Error, like every other failure
  try { return await call<T>(cmd, args as Record<string, unknown>, headers ? { headers } : undefined); } catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
}

export function readChoice(): Choice {
  try {
    const j = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Choice>;
    return { model: typeof j.model === 'string' ? j.model : '', language: typeof j.language === 'string' ? j.language : '' };
  } catch { return { model: '', language: '' }; }
}

export function writeChoice(c: Choice): void {
  try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* private window: the choice lasts until it closes */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls `fn` when the choice changes. */
export function onChoice(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The models this device can run, or an empty list when it cannot run any (a phone, the web build). */
export async function localModels(): Promise<LocalModel[]> {
  if (!inTauri()) return [];
  try { return await invoke<LocalModel[]>('whisper_models'); } catch { return []; }
}

/** Downloads a model; `onProgress` is called as bytes arrive. An aborted `signal` stops it and removes the part. */
export async function downloadModel(id: string, onProgress: (p: LocalProgress) => void, signal?: AbortSignal): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const off = await listen<LocalProgress>('whisper-download', e => { if (e.payload.id === id) onProgress(e.payload); });
  const stop = () => { void invoke('whisper_cancel_download'); };
  signal?.addEventListener('abort', stop);
  try { await invoke('whisper_download', { id }); } finally { signal?.removeEventListener('abort', stop); off(); }
}

export const deleteModel = (id: string): Promise<void> => invoke('whisper_delete', { id });

/** The audio as 16 kHz mono samples: the web view's own decoder reads webm/opus, wav, mp3, m4a… */
export async function decodeAudio(bytes: Uint8Array): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
    return mono;
  } catch (e) {
    throw new Error(`This device could not read that audio${e instanceof Error && e.message ? ` (${e.message})` : ''}.`);
  } finally { void ctx.close(); }
}

/** Writes out the speech in `file` with the model on this computer. `onProgress` gets 0–100. */
export async function transcribeLocal(file: AudioFile, o: { model: string; language: string; signal?: AbortSignal; onProgress?: (pct: number) => void }): Promise<TimedTranscript> {
  if (o.signal?.aborted) throw new Error('Cancelled');
  const samples = await decodeAudio(fromB64(file.data));
  const { listen } = await import('@tauri-apps/api/event');
  const off = o.onProgress ? await listen<number>('whisper-progress', e => o.onProgress?.(e.payload)) : null;
  const stop = () => { void invoke('whisper_cancel'); };
  o.signal?.addEventListener('abort', stop);
  try {
    // raw bytes, not JSON: an hour of audio is 230 MB of samples
    const body = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    return await invoke<TimedTranscript>('whisper_transcribe', body as unknown as ArrayBuffer, { 'x-model': o.model, 'x-language': o.language });
  } finally { o.signal?.removeEventListener('abort', stop); off?.(); }
}

/** Calls `fn` with 0–100 while the model on this computer writes a window out. Returns the function that stops listening. */
export async function watchProgress(fn: (pct: number) => void): Promise<() => void> {
  if (!inTauri()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<number>('whisper-progress', e => fn(e.payload));
  } catch { return () => {}; }
}
