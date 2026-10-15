// The recording in progress is one process of the app, not of the note it was started from: it goes on when another
// note is opened, and is controlled from the panel that takes the place of the note list (components/RecorderPanel).
import { useSyncExternalStore } from 'react';
import type { RecordKind } from '@ergonotes/core';
import { getApi } from '../state/appRef';
import { getRecordHost, notifyRecord } from './host';
import { RecordSession, type SessionResult } from './session';
import { transcribeRecord } from './tools';

export interface RecorderFrame { second: number; url: string; user: boolean }

export interface RecorderState {
  phase: 'idle' | 'starting' | 'running' | 'paused' | 'saving' | 'transcribing';
  kind: RecordKind | null;
  noteId: string | null;
  noteTitle: string;
  dir: string;
  seconds: number;
  level: number;
  frames: number;
  /** the newest pictures kept, newest last */
  recent: RecorderFrame[];
  heard: 'mic' | 'both' | 'shared';
  takesFrames: boolean;
  /** something the person should know (no microphone, the share ended…) */
  notice: string;
  /** progress of what happens after stopping */
  status: string;
  /** the note list is shown instead of the panel */
  showList: boolean;
}

const IDLE: RecorderState = {
  phase: 'idle', kind: null, noteId: null, noteTitle: '', dir: '', seconds: 0, level: 0, frames: 0, recent: [], heard: 'mic', takesFrames: false,
  notice: '', status: '', showList: false,
};

export interface StartOptions {
  kind: RecordKind;
  noteId: string;
  noteTitle: string;
  frames: boolean;
  every: number;
  transcribe: boolean;
  /** put the link in the note (the editor that asked); called once, as soon as the folder exists */
  onStarted: (dir: string) => void;
}

const KEEP_RECENT = 6;

class RecorderStore {
  private state: RecorderState = IDLE;
  private listeners = new Set<() => void>();
  private session: RecordSession | null = null;
  private transcribeAfter = false;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = (): RecorderState => this.state;
  get active(): boolean { return this.state.phase !== 'idle'; }

  private set(p: Partial<RecorderState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  /** Starts; throws a sentence for the person when it cannot (nothing is left running then). */
  async start(o: StartOptions): Promise<void> {
    if (this.state.phase !== 'idle') throw new Error('A recording is already running. Stop it first.');
    const api = getApi();
    if (!api) throw new Error('The vault is not ready.');
    this.set({ ...IDLE, phase: 'starting', kind: o.kind, noteId: o.noteId, noteTitle: o.noteTitle, takesFrames: o.kind === 'meeting' && o.frames });
    this.transcribeAfter = o.transcribe;
    const s = new RecordSession({
      api, kind: o.kind, frames: o.kind === 'meeting' && o.frames, every: o.every,
      onStarted: dir => { this.set({ dir }); o.onStarted(dir); },
      onFrame: (second, blob, user) => {
        const url = URL.createObjectURL(blob);
        const recent = [...this.state.recent.filter(f => f.second !== second), { second, url, user }];
        while (recent.length > KEEP_RECENT) URL.revokeObjectURL(recent.shift()!.url);
        this.set({ recent });
      },
      onChange: st => this.set({
        phase: this.state.phase === 'transcribing' ? 'transcribing'
          : st.phase === 'paused' ? 'paused' : st.phase === 'recording' ? 'running' : 'saving',
        seconds: st.seconds, level: st.level, frames: st.frames, heard: st.heard, notice: st.notice,
      }),
    });
    try {
      await s.start();
    } catch (e) {
      this.reset();
      throw e;
    }
    this.session = s;
    this.set({ phase: 'running' });
    void s.done().then(r => this.finished(r));
  }

  private async finished(r: SessionResult) {
    const host = getRecordHost();
    const api = getApi();
    this.set({ phase: 'saving', status: 'Saving…', seconds: r.seconds });
    notifyRecord(r.dir);
    let problem = r.notice;
    if (this.transcribeAfter && r.audioPath && host?.speechReady && api) {
      this.set({ phase: 'transcribing', status: 'Writing it out…' });
      try {
        await transcribeRecord({ api, dir: r.dir, transcribe: host.transcribe, onStatus: s => this.set({ status: s }) });
        notifyRecord(r.dir);
      } catch (e) {
        problem = `The record is saved, but could not be written out: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    const noteId = this.state.noteId;
    const mins = Math.floor(r.seconds / 60), secs = Math.floor(r.seconds % 60);
    host?.toast(problem || `Record saved (${mins}:${String(secs).padStart(2, '0')}${r.frames ? `, ${r.frames} frames` : ''})`, problem ? 'error' : 'info',
      noteId ? { label: 'Open note', run: () => host.openNote(noteId) } : undefined);
    this.reset();
  }

  private reset() {
    for (const f of this.state.recent) URL.revokeObjectURL(f.url);
    this.session = null;
    this.set({ ...IDLE });
  }

  pause() { this.session?.pause(); }
  resume() { this.session?.resume(); }
  stop() { this.session?.stop(); }
  capture() { return this.session?.capture(true) ?? Promise.resolve(false); }
  setShowList(v: boolean) { this.set({ showList: v }); }

  /** Throws the recording away, and takes its link out of the note. */
  async discard(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const { noteId } = this.state;
    const dir = s.dir;
    await s.discard();
    const api = getApi();
    if (api && noteId) {
      try {
        const n = await api.getNote(noteId);
        if (n && n.body.includes(dir.slice(dir.lastIndexOf('/') + 1))) {
          const body = n.body.split('\n').filter(l => !(l.includes('type_record') && l.includes(dir.slice(dir.lastIndexOf('/') + 1)))).join('\n');
          await api.saveNote(noteId, { body });
        }
      } catch { /* the note is gone: nothing to clean */ }
    }
    this.reset();
  }
}

export const recorder = new RecorderStore();
export const useRecorder = (): RecorderState => useSyncExternalStore(recorder.subscribe, recorder.get);
