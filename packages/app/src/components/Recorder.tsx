import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Pause, Play, Square } from 'lucide-react';
import { Dialog } from './ui';
import { fmtSecs } from '../editor/blocks';
import { classNames } from '../state/util';
import { canShareScreen, recordingUnavailable } from '../record/run';

export type RecordKind = 'voice' | 'meeting' | 'dictate';

export interface Recording { blob: Blob; mime: string; seconds: number }

const TITLE: Record<RecordKind, string> = { voice: 'Voice note', meeting: 'Meeting recording', dictate: 'Voice dictation' };
const MAX_BYTES = 20 * 1024 * 1024; // a clip is sent whole to a transcription server, which takes 25 MB

/** Capturing what the computer plays (the other people on a call) goes through screen sharing with audio. */
export const canCaptureComputerAudio = canShareScreen;

export const blobToB64 = (b: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error ?? new Error('Could not read the recording'));
  r.readAsDataURL(b);
});

/**
 * Records from the microphone. The recording itself is handed to `onFinish`, which keeps it / transcribes it and
 * reports progress through `setStatus`; the dialog closes when that promise settles.
 */
export function RecorderDialog({ kind, sttReady, privateNote, onFinish, onClose }: {
  kind: RecordKind;
  sttReady: boolean;
  privateNote: boolean;
  onFinish: (r: Recording, o: { transcribe: boolean }, setStatus: (s: string) => void) => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'paused' | 'working'>('ready');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string | null>(recordingUnavailable());
  const [status, setStatus] = useState('');
  const canWrite = sttReady && !privateNote;
  const [transcribe, setTranscribe] = useState(kind !== 'voice' ? canWrite : false);
  const sysOk = kind === 'meeting' && canCaptureComputerAudio();
  const [system, setSystem] = useState(sysOk);
  const [heard, setHeard] = useState<'mic' | 'both'>('mic');
  const [note, setNote] = useState('');
  const streams = useRef<MediaStream[]>([]);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const carried = useRef(0); // seconds recorded before the last pause
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const keep = useRef(true); // false: the recording is thrown away

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    streams.current.forEach(st => st.getTracks().forEach(t => t.stop()));
    streams.current = [];
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  };
  useEffect(() => () => { keep.current = false; if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); release(); }, []);

  const start = async () => {
    setErr(null);
    try {
      // the sharing picker needs the click that started this, so it comes before the microphone prompt
      // the computer's sound: the other people on a call. The browser asks which tab or window to share, with its audio.
      let display: MediaStream | null = null;
      if (kind === 'meeting' && system && sysOk) {
        try {
          display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch {
          release();
          setErr('The computer’s sound was not shared. Pick the tab or window of the call and tick “Share audio” — or turn off “Record the computer’s sound” to record the microphone only.');
          return;
        }
        streams.current.push(display);
        if (display.getAudioTracks().length === 0) {
          release();
          setErr('The picture was shared but not its sound. Choose again and tick “Share tab audio” (or “Share system audio”) in the browser’s window. Sound can only be shared from a tab in some browsers.');
          return;
        }
        // only the sound is wanted: the picture costs nothing but is kept alive (stopping it ends the share)
        display.getVideoTracks().forEach(t => { void t.applyConstraints({ frameRate: 1 }).catch(() => undefined); t.enabled = false; });
        display.getAudioTracks()[0].addEventListener('ended', () => setNote('The computer’s sound is no longer shared. Still recording the microphone.'));
      }
      // the microphone: what this person says (and, with speakers, what the room hears)
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streams.current.push(mic);
      // both go through one mixer: the recording is one track, whatever was captured
      const ac = new AudioContext();
      void ac.resume();
      ctx.current = ac;
      const mix = ac.createMediaStreamDestination();
      const an = ac.createAnalyser();
      an.fftSize = 256;
      for (const st of [mic, ...(display ? [new MediaStream(display.getAudioTracks())] : [])]) {
        const src = ac.createMediaStreamSource(st);
        src.connect(mix);
        src.connect(an);
      }
      setHeard(display ? 'both' : 'mic');
      const s = mix.stream;
      stream.current = s;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
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
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
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
    try { await onFinish(r, { transcribe }, setStatus); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('ready'); }
  };

  const pause = () => {
    const r = rec.current;
    if (!r) return;
    if (r.state === 'recording') { r.pause(); carried.current += (Date.now() - started.current) / 1000; started.current = 0; setPhase('paused'); }
    else if (r.state === 'paused') { r.resume(); started.current = Date.now(); setPhase('recording'); }
  };
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') { if (rec.current.state === 'paused') started.current = 0; rec.current.stop(); } };
  const close = () => {
    if (phase === 'working') return;
    if ((phase === 'recording' || phase === 'paused') && secs > 5 && !confirm('Discard this recording?')) return;
    onClose();
  };

  const live = phase === 'recording' || phase === 'paused';
  return (
    <Dialog title={TITLE[kind]} onClose={close}
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
        {phase === 'ready' && kind === 'dictate' && <p className="hint">Speak, then press Stop: what you said is written into the note at the cursor.</p>}
        {phase === 'ready' && kind === 'voice' && <p className="hint">Records from the microphone. It is saved in the note as an audio clip you can play back.</p>}
        {phase === 'ready' && kind === 'meeting' && <p className="hint">Records the microphone and, below, the sound the computer plays. It is saved in the note{canWrite ? ', then written out as a transcript with a summary' : ''}.</p>}
        {phase === 'ready' && kind === 'meeting' && (
          <label className={classNames('rec-opt', !sysOk && 'off')}>
            <input type="checkbox" checked={system && sysOk} disabled={!sysOk} onChange={e => setSystem(e.target.checked)} /> Record the computer’s sound too (the people on the call)
            {!sysOk && <span className="hint"> (this device cannot capture it: put the call on the speakers and the microphone will hear it)</span>}
          </label>
        )}
        {phase === 'ready' && kind === 'meeting' && system && sysOk && <p className="hint">The browser will ask which tab or window to share: choose the call and tick “Share audio”.</p>}
        {live && <p className="hint">{heard === 'both' ? 'Recording the microphone and the computer’s sound.' : 'Recording the microphone.'}</p>}
        {note && <p className="error-text" role="status">{note}</p>}
        {phase === 'ready' && kind !== 'dictate' && (
          <label className={classNames('rec-opt', !canWrite && 'off')}>
            <input type="checkbox" checked={transcribe && canWrite} disabled={!canWrite} onChange={e => setTranscribe(e.target.checked)} /> Also write it out as text
            {!sttReady && <span className="hint"> (set up speech-to-text in Settings → AI)</span>}
            {sttReady && privateNote && <span className="hint"> (not for a private note)</span>}
          </label>
        )}
        {kind === 'dictate' && !canWrite && <p className="error-text" role="alert">{privateNote ? 'This note is private: its audio is not sent to a transcription server.' : 'Set up speech-to-text in Settings → AI first.'}</p>}
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
