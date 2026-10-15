import { useState } from 'react';
import { Camera, FileText, Mic, Presentation } from 'lucide-react';
import type { RecordKind } from '@ergonotes/core';
import { Dialog } from './ui';
import { canShareScreen, recordingUnavailable } from '../record/session';
import { recorder, useRecorder } from '../record/recorder';
import { getRecordHost } from '../record/host';
import { classNames } from '../state/util';

/**
 * The questions before a record is made. Once it starts the dialog is gone: the recording is a process of the app,
 * controlled from the panel that takes the place of the note list (RecorderPanel).
 */
export function RecordDialog({ kind, noteId, noteTitle, privateNote, onStarted, onClose }: {
  kind: RecordKind;
  noteId: string;
  noteTitle: string;
  privateNote: boolean;
  /** the link goes into the note */
  onStarted: (dir: string) => void;
  onClose: () => void;
}) {
  const host = getRecordHost();
  const running = useRecorder().phase !== 'idle';
  const canWrite = !!host?.speechReady && !privateNote;
  const meeting = kind === 'meeting';
  const shareOk = canShareScreen();
  const [frames, setFrames] = useState(true);
  const [every, setEvery] = useState(2);
  const [transcribe, setTranscribe] = useState(canWrite);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(recordingUnavailable());
  const blocked = running || !!recordingUnavailable() || (meeting && !shareOk);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      await recorder.start({ kind, noteId, noteTitle, frames: meeting && frames, every, transcribe: transcribe && canWrite, onStarted });
      onClose();
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setErr(name === 'NotAllowedError' || name === 'SecurityError' ? 'The microphone is blocked. Allow it for this site in the browser or system settings, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found.' : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog title={meeting ? 'Record a meeting' : 'Record audio'} onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={blocked || busy} onClick={() => void start()}>
            {meeting ? <Presentation size={16} /> : <Mic size={16} />} {busy ? 'Starting…' : 'Start'}
          </button>
        </>
      }>
      <div className="rec-setup">
        <p className="rec-lead">
          {meeting
            ? 'Records the sound of a call or lecture and takes pictures of what is shown, then keeps them in this note as one record you can play back.'
            : 'Records the microphone and keeps it in this note as a record you can play back.'}
        </p>

        {running && <p className="error-text" role="alert">Another recording is running. Stop it first.</p>}

        <div className="rec-list">
          {meeting && (
            <div className="rec-row static">
              <span className="rec-ico"><Presentation size={18} /></span>
              <span className="rec-row-text">
                <strong>What to share</strong>
                <span className="hint">
                  {shareOk
                    ? 'You choose next. In a browser pick the call’s tab and tick “Share tab audio”. In the Windows app pick “Entire Screen” and turn on “Share with system audio”. Without the share nothing is recorded.'
                    : 'This browser cannot share the screen. Use a recording to capture the microphone alone.'}
                </span>
              </span>
            </div>
          )}
          {meeting && (
            <label className={classNames('rec-row', !shareOk && 'off')}>
              <span className="rec-ico"><Camera size={18} /></span>
              <span className="rec-row-text">
                <strong>Take pictures of the shared screen</strong>
                <span className="hint">A picture that repeats the last one is not kept. You can also press Capture.</span>
              </span>
              <input type="checkbox" checked={frames} disabled={!shareOk} onChange={e => setFrames(e.target.checked)} />
            </label>
          )}
          {meeting && frames && (
            <div className="rec-row sub">
              <span className="rec-row-text"><strong>Every</strong></span>
              <div className="seg" role="group" aria-label="Seconds between pictures">
                {[1, 2, 5].map(n => (
                  <button key={n} type="button" aria-pressed={every === n} onClick={() => setEvery(n)}>{n} s</button>
                ))}
              </div>
            </div>
          )}
          <label className={classNames('rec-row', !canWrite && 'off')}>
            <span className="rec-ico"><FileText size={18} /></span>
            <span className="rec-row-text">
              <strong>Write it out as text when I stop</strong>
              <span className="hint">
                {!host?.speechReady ? 'Set up speech-to-text in Settings → AI first.'
                  : privateNote ? 'Not for a private note: its audio is never sent for transcription.'
                  : 'The transcript is kept with the record, one block per minute, and can be edited.'}
              </span>
            </span>
            <input type="checkbox" checked={transcribe && canWrite} disabled={!canWrite} onChange={e => setTranscribe(e.target.checked)} />
          </label>
        </div>

        <p className="hint">It goes on if you open another note. Control it from the panel that replaces the note list.</p>
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Dialog>
  );
}
