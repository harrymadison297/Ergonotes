// What a record's player (an editor node view, outside the app's React providers) may ask of the app.
import type { AiTransport, AudioFile, TimedTranscript } from '@ergonotes/core';

export interface RecordHost {
  speechReady: boolean;
  visionReady: boolean;
  chatReady: boolean;
  /** the model that would look at frames, for the question "send these to …?" */
  visionName: string;
  transcribe: (file: AudioFile, signal?: AbortSignal) => Promise<TimedTranscript>;
  transport: AiTransport;
  toast: (msg: string, kind?: 'info' | 'error', action?: { label: string; run: () => void }) => void;
  /** show a note (the one a record was made in) */
  openNote: (id: string) => void;
}

let host: RecordHost | null = null;
export const setRecordHost = (h: RecordHost) => { host = h; };
export const getRecordHost = (): RecordHost | null => host;

let priv = false;
/** The open note is private: its records are never sent anywhere. */
export const setNotePrivate = (p: boolean) => { priv = p; };
export const isNotePrivate = (): boolean => priv;

/** A record's files changed (frames arrived, a transcript was written): players showing it look again. */
export const notifyRecord = (dir: string) => window.dispatchEvent(new CustomEvent('ergo-record', { detail: dir }));
export const onRecord = (fn: (dir: string) => void): (() => void) => {
  const h = (e: Event) => fn(String((e as CustomEvent).detail));
  window.addEventListener('ergo-record', h);
  return () => window.removeEventListener('ergo-record', h);
};
