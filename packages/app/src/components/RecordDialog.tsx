import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Loader2, Mic, Pause, Play, Presentation, Square, Trash2 } from 'lucide-react';
import { fmtClock, type RecordKind } from '@ergonotes/core';
import { Dialog } from './ui';
import { RecordSession, canShareScreen, recordingUnavailable, type SessionResult, type SessionState } from '../record/session';
import { transcribeRecord } from '../record/tools';
import { getRecordHost, notifyRecord } from '../record/host';
import { classNames } from '../state/util';

const TITLE: Record<RecordKind, string> = { recording: 'Recording', meeting: 'Meeting' };

/**
 * Starts a recording or a meeting and, once it runs, stays out of the way as a small bar: the note can be written in
 * while it records. The link to the record is in the note from the first second (`onStarted`).
 */
export function RecordDialog({ kind, privateNote, onStarted, onDiscarded, onFinished, onClose }: {
  kind: RecordKind;
  privateNote: boolean;
  onStarted: (dir: string) => void;
  onDiscarded: (dir: string) => void;
  onFinished: (r: SessionResult) => void;
  onClose: () => void;
}) {
  const host = getRecordHost();
  const canWrite = !!host?.speechReady && !privateNote;
  const [phase, setPhase] = useState<'ready' | 'running' | 'saving' | 'transcribing'>('ready');
  const [err, setErr] = useState<string | null>(recordingUnavailable());
  const [frames, setFrames] = useState(kind === 'meeting');
  const [every, setEvery] = useState(2);
  const [transcribe, setTranscribe] = useState(canWrite);
  const [st, setSt] = useState<SessionState | null>(null);
  const [status, setStatus] = useState('');
  const session = useRef<RecordSession | null>(null);
  const finished = useRef(false);
  const shareOk = canShareScreen();

  useEffect(() => () => {
    // leaving while it records (another note was opened): what was recorded is saved, not lost
    if (session.current && !finished.current) session.current.dispose();
  }, []);

  const start = async () => {
    setErr(null);
    const api = (await import('../state/appRef')).getApi();
    if (!api) return;
    const s = new RecordSession({
      api, kind, frames: kind === 'meeting' && frames, every,
      onStarted: dir => onStarted(dir),
      onChange: setSt,
    });
    try {
      await s.start();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setErr(name === 'NotAllowedError' || name === 'SecurityError' ? 'The microphone is blocked. Allow it for this site in the browser or system settings, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found.' : e instanceof Error ? e.message : String(e));
      return;
    }
    session.current = s;
    setPhase('running');
    void s.done().then(async r => {
      setPhase('saving');
      notifyRecord(r.dir);
      let note = r.notice;
      if (transcribe && canWrite && r.audioPath && host) {
        setPhase('transcribing');
        try {
          const apiNow = (await import('../state/appRef')).getApi()!;
          await transcribeRecord({ api: apiNow, dir: r.dir, transcribe: host.transcribe, onStatus: setStatus });
          notifyRecord(r.dir);
        } catch (e) {
          note = `The record is saved, but could not be written out: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      finished.current = true;
      if (note) host?.toast(note, 'error');
      onFinished({ ...r, notice: note });
      onClose();
    });
  };

  const discard = async () => {
    if (!session.current) return;
    if ((st?.seconds ?? 0) > 5 && !confirm('Throw this recording away?')) return;
    finished.current = true;
    const dir = session.current.dir;
    await session.current.discard();
    onDiscarded(dir);
    onClose();
  };

  if (phase === 'ready') {
    const cannotStart = !!recordingUnavailable() || (kind === 'meeting' && !shareOk);
    return (
      <Dialog title={TITLE[kind]} onClose={onClose}
        footer={<button className="btn primary" disabled={cannotStart} onClick={() => void start()}>{kind === 'meeting' ? <Presentation size={16} /> : <Mic size={16} />} Start {kind === 'meeting' ? 'the meeting record' : 'recording'}</button>}>
        <div className="recorder">
          {kind === 'recording'
            ? <p className="hint">Records the microphone. Audio is saved in the note as a record you can play back{canWrite ? ' and write out as text' : ''}.</p>
            : <p className="hint">Records the microphone and the sound of the shared tab or window (the people on the call), and takes pictures of what is shown. It is saved in the note as a record.</p>}
          {kind === 'meeting' && !shareOk && (
            <p className="error-text" role="alert">This browser cannot share the screen, so a meeting cannot be recorded here. A recording of the microphone alone works.</p>
          )}
          {kind === 'meeting' && shareOk && (
            <p className="hint">
              You will be asked what to share. In a browser choose the call’s tab and tick “Share tab audio”. In the Windows app choose
              “Entire Screen” and turn on “Share with system audio” (a single window has no sound to share). Without the share nothing is recorded.
            </p>
          )}
          {kind === 'meeting' && (
            <label className={classNames('rec-opt', !shareOk && 'off')}>
              <input type="checkbox" checked={frames} disabled={!shareOk} onChange={e => setFrames(e.target.checked)} /> Take pictures of the shared screen
            </label>
          )}
          {kind === 'meeting' && frames && (
            <label className="rec-opt">
              Every
              <select className="input" style={{ width: 'auto', margin: '0 6px' }} value={every} onChange={e => setEvery(Number(e.target.value))} aria-label="Seconds between pictures">
                {[1, 2, 5].map(n => <option key={n} value={n}>{n} second{n === 1 ? '' : 's'}</option>)}
              </select>
              <span className="hint">(a picture that repeats the last one is not kept; you can also press Capture)</span>
            </label>
          )}
          <label className={classNames('rec-opt', !canWrite && 'off')}>
            <input type="checkbox" checked={transcribe && canWrite} disabled={!canWrite} onChange={e => setTranscribe(e.target.checked)} /> Write it out as text when I stop
            {!host?.speechReady && <span className="hint"> (set up speech-to-text in Settings → AI)</span>}
            {host?.speechReady && privateNote && <span className="hint"> (not for a private note)</span>}
          </label>
          {err && <p className="error-text" role="alert">{err}</p>}
        </div>
      </Dialog>
    );
  }

  const live = phase === 'running' && st;
  return createPortal(
    <div className="rec-bar" role="region" aria-label="Recording">
      {live ? (
        <>
          <span className={classNames('rec-dot', st.phase === 'recording' && 'on')} aria-hidden />
          <span className="rec-bar-time" role="timer">{fmtClock(st.seconds)}</span>
          <span className="rec-meter small" aria-hidden><i style={{ transform: `scaleX(${st.phase === 'recording' ? Math.max(0.03, st.level) : 0.03})` }} /></span>
          {kind === 'meeting' && frames && <span className="hint">{st.frames} frame{st.frames === 1 ? '' : 's'}</span>}
          {kind === 'meeting' && frames && (
            <button className="btn" onClick={() => { void session.current?.capture(true); }} title="Take a picture now"><Camera size={15} /> Capture</button>
          )}
          <button className="btn" onClick={() => (st.phase === 'paused' ? session.current?.resume() : session.current?.pause())}>
            {st.phase === 'paused' ? <Play size={15} /> : <Pause size={15} />} {st.phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button className="btn primary" onClick={() => session.current?.stop()}><Square size={15} /> Stop</button>
          <button className="btn" onClick={() => void discard()} aria-label="Throw away" title="Throw this recording away"><Trash2 size={15} /></button>
          {st.notice && <span className="error-text" role="status">{st.notice}</span>}
        </>
      ) : (
        <span role="status"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {phase === 'saving' ? 'Saving…' : status || 'Writing it out…'}</span>
      )}
    </div>,
    document.body,
  );
}
