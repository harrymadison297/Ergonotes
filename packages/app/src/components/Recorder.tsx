import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Pause, Play, Square } from 'lucide-react';
import { Dialog } from './ui';
import { fmtSecs } from '../editor/blocks';
import { classNames } from '../state/util';
import { recordingUnavailable } from '../record/run';
import { openMixer, pickAudioMime } from '../record/capture';
import { askConfirm } from '../state/confirm';

export interface Recording { blob: Blob; mime: string; seconds: number }

const MAX_BYTES = 20 * 1024 * 1024; // a clip is sent whole to a transcription server, which takes 25 MB

export const blobToB64 = (b: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error ?? new Error('Could not read the recording'));
  r.readAsDataURL(b);
});

/**
 * Dictation: records from the microphone, and the recording is handed to `onFinish`, which writes out what was said
 * and reports progress through `setStatus`; the dialog closes when that promise settles. (A record of a lecture or a
 * call is `RecordDialog` and `record/run.ts`.)
 */
export function DictateDialog({ sttReady, privateNote, onFinish, onClose }: {
  sttReady: boolean;
  privateNote: boolean;
  onFinish: (r: Recording, setStatus: (s: string) => void) => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'paused' | 'working'>('ready');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string | null>(recordingUnavailable());
  const [status, setStatus] = useState('');
  const canWrite = sttReady && !privateNote;
  const rec = useRef<MediaRecorder | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const carried = useRef(0); // seconds recorded before the last pause
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef(0);
  const keep = useRef(true); // false: the recording is thrown away

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    mic.current?.getTracks().forEach(t => t.stop());
    mic.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  };
  useEffect(() => () => { keep.current = false; if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); release(); }, []);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      mic.current = stream;
      const mixer = openMixer([stream]);
      ctx.current = mixer.ctx;
      const mime = pickAudioMime();
      const r = new MediaRecorder(mixer.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      rec.current = r;
      chunks.current = [];
      r.ondataavailable = e => {
        if (e.data.size) chunks.current.push(e.data);
        if (chunks.current.reduce((n, b) => n + b.size, 0) > MAX_BYTES && r.state !== 'inactive') r.stop();
      };
      r.onstop = () => {
        const seconds = carried.current + (started.current ? (Date.now() - started.current) / 1000 : 0);
        release();
        if (!keep.current) return;
        const type = r.mimeType || mime || 'audio/webm';
        void finish({ blob: new Blob(chunks.current, { type }), mime: type.split(';')[0], seconds });
      };
      // a level meter, so the person can see something is heard
      const tick = () => {
        setLevel(mixer.level());
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      carried.current = 0;
      started.current = Date.now();
      r.start(1000);
      setSecs(0);
      timer.current = setInterval(() => setSecs(Math.floor(carried.current + (started.current ? (Date.now() - started.current) / 1000 : 0))), 250);
      setPhase('recording');
    } catch (e) {
      release();
      const name = e instanceof DOMException ? e.name : '';
      setErr(name === 'NotAllowedError' || name === 'SecurityError' ? 'The microphone is blocked. Allow it for this site in the browser or system settings, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found.' : `Could not start recording: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const finish = async (r: Recording) => {
    setPhase('working');
    setStatus('Saving…');
    try { await onFinish(r, setStatus); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('ready'); }
  };

  const pause = () => {
    const r = rec.current;
    if (!r) return;
    if (r.state === 'recording') { r.pause(); carried.current += (Date.now() - started.current) / 1000; started.current = 0; setPhase('paused'); }
    else if (r.state === 'paused') { r.resume(); started.current = Date.now(); setPhase('recording'); }
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') { if (rec.current.state === 'paused') started.current = 0; rec.current.stop(); } };
  const close = async () => {
    if (phase === 'working') return;
    if ((phase === 'recording' || phase === 'paused') && secs > 5 && !(await askConfirm('Discard this recording?', { ok: 'Discard', danger: true }))) return;
    onClose();
  };

  const live = phase === 'recording' || phase === 'paused';
  return (
    <Dialog title="Voice dictation" onClose={close}
      footer={
        phase === 'ready' ? <button className="btn primary" disabled={!!recordingUnavailable()} onClick={() => void start()}><Mic size={16} /> Start recording</button>
        : live ? (
          <>
            <button className="btn" onClick={pause}>{phase === 'paused' ? <Play size={16} /> : <Pause size={16} />} {phase === 'paused' ? 'Resume' : 'Pause'}</button>
            <button className="btn primary" onClick={stop}><Square size={16} /> Stop and insert</button>
          </>
        ) : undefined
      }>
      <div className={classNames('recorder', phase)}>
        <div className="rec-time" role="timer" aria-live="off">{fmtSecs(secs)}</div>
        <div className="rec-meter" aria-hidden><i style={{ transform: `scaleX(${live && phase === 'recording' ? Math.max(0.03, level) : 0.03})` }} /></div>
        {phase === 'working' && <p role="status" className="hint"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {status}</p>}
        {phase === 'ready' && <p className="hint">Speak, then press Stop: what you said is written into the note at the cursor.</p>}
        {live && <p className="hint">Recording the microphone.</p>}
        {!canWrite && <p className="error-text" role="alert">{privateNote ? 'This note is private: its audio is not sent to a transcription server.' : 'Set up speech-to-text in Settings → AI first.'}</p>}
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}

/** Pick an audio or video file and have it transcribed. */
export function TranscribeDialog({ privateNote, onPick, onClose }: { privateNote: boolean; onPick: (f: File, setStatus: (s: string) => void) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(privateNote ? 'This note is private: its audio is not sent to a transcription server.' : null);
  const input = useRef<HTMLInputElement>(null);
  const go = async (f: File) => {
    setErr(null);
    if (f.size > 24 * 1024 * 1024) { setErr('That file is larger than 25 MB, which is the most a transcription server accepts.'); return; }
    setBusy(true);
    try { await onPick(f, setStatus); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Dialog title="Transcribe media" onClose={() => { if (!busy) onClose(); }} footer={<button className="btn primary" disabled={busy || privateNote} onClick={() => input.current?.click()}>Choose an audio or video file…</button>}>
      <p className="muted" style={{ marginTop: 0 }}>The file is attached to the note and its speech is written out below it. Up to 25 MB; mp3, m4a, wav, webm, mp4 and similar.</p>
      {busy && <p role="status" className="hint"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {status || 'Working…'}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
      <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void go(f); }} />
    </Dialog>
  );
}
