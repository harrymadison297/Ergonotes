import { Camera, Loader2, Mic, Pause, Play, Presentation, Square, Trash2, Volume2 } from 'lucide-react';
import { fmtClock, fmtMark } from '@ergonotes/core';
import type { ReactNode } from 'react';
import { useApp } from '../state/app';
import { recorder, useRecorder } from '../record/recorder';
import { classNames } from '../state/util';
import { Resizer } from './Resizer';

const heardText = (h: 'mic' | 'both' | 'shared') =>
  h === 'both' ? 'the microphone and the shared sound' : h === 'shared' ? 'the shared sound only' : 'the microphone';

function Meter({ level, on }: { level: number; on: boolean }) {
  return <span className="rec-meter" aria-hidden><i style={{ transform: `scaleX(${on ? Math.max(0.03, level) : 0.03})` }} /></span>;
}

const discard = () => {
  if (recorder.get().seconds > 5 && !confirm('Throw this recording away? Its audio and pictures are deleted.')) return;
  void recorder.discard();
};

function Controls({ compact, withDiscard = true }: { compact?: boolean; withDiscard?: boolean }) {
  const r = useRecorder();
  const busy = r.phase === 'saving' || r.phase === 'transcribing' || r.phase === 'starting';
  return (
    <div className={classNames('rec-controls', compact && 'compact')}>
      {r.takesFrames && !busy && (
        <button className="btn" onClick={() => void recorder.capture()} title="Take a picture now" disabled={r.phase === 'paused'}><Camera size={15} /> {compact ? '' : 'Capture'}</button>
      )}
      {!busy && (
        <button className="btn" onClick={() => (r.phase === 'paused' ? recorder.resume() : recorder.pause())}>
          {r.phase === 'paused' ? <Play size={15} /> : <Pause size={15} />} {compact ? '' : r.phase === 'paused' ? 'Resume' : 'Pause'}
        </button>
      )}
      {!busy && <button className="btn primary" onClick={() => recorder.stop()}><Square size={15} /> Stop</button>}
      {!busy && withDiscard && <button className="btn" onClick={discard} aria-label="Throw away" title="Throw this recording away"><Trash2 size={15} /></button>}
    </div>
  );
}

/** Takes the place of the note list while a record is made. */
export function RecorderPanel() {
  const r = useRecorder();
  const app = useApp();
  const busy = r.phase === 'saving' || r.phase === 'transcribing' || r.phase === 'starting';
  const live = r.phase === 'running';
  return (
    <section className="rec-panel" aria-label="Recording">
      <Resizer pane="listW" edge="right" label="Resize list" />
      <header className="rec-panel-head">
        <span className={classNames('rec-dot', live && 'on')} aria-hidden />
        <h2>{r.kind === 'meeting' ? 'Meeting' : 'Recording'}</h2>
        <span className="grow" />
        {!busy && <button className="icon-btn" onClick={discard} aria-label="Throw away" title="Throw this recording away"><Trash2 size={16} /></button>}
        <button className="btn ghost" onClick={() => recorder.setShowList(true)}>Show notes</button>
      </header>

      <div className="rec-clock" role="timer" aria-live="off">{fmtClock(r.seconds)}</div>
      <div className="rec-state" role="status">
        {busy
          ? <><Loader2 size={14} className="spin" /> {r.status || 'Saving…'}</>
          : r.phase === 'paused' ? 'Paused' : <><Volume2 size={14} /> Recording {heardText(r.heard)}</>}
      </div>
      <Meter level={r.level} on={live} />

      <Controls withDiscard={false} />

      {r.notice && <p className="rec-notice" role="status">{r.notice}</p>}

      {r.noteId && (
        <button className="rec-note" onClick={() => app.go({ name: 'notes', note: r.noteId! })} title="Open the note this is recorded in">
          {r.kind === 'meeting' ? <Presentation size={16} /> : <Mic size={16} />}
          <span>In note</span><strong>{r.noteTitle || 'Untitled'}</strong>
        </button>
      )}

      {r.takesFrames && (
        <div className="rec-frames">
          <div className="rec-frames-head"><span>Pictures</span><strong>{r.frames}</strong></div>
          {r.recent.length === 0
            ? <p className="hint">The first picture comes in a moment. A picture that repeats the last one is not kept.</p>
            : (
              <div className="rec-thumbs">
                {[...r.recent].reverse().map(f => (
                  <figure key={f.second} className={classNames(f.user && 'user')}>
                    <img src={f.url} alt={`Picture at ${fmtMark(f.second)}`} />
                    <figcaption>{fmtMark(f.second)}{f.user ? ' · yours' : ''}</figcaption>
                  </figure>
                ))}
              </div>
            )}
        </div>
      )}
    </section>
  );
}

/** A thin bar for when the note list is shown instead of the panel, and for views that have no list. */
export function RecorderMini({ floating }: { floating?: boolean }) {
  const r = useRecorder();
  const busy = r.phase === 'saving' || r.phase === 'transcribing' || r.phase === 'starting';
  return (
    <div className={classNames('rec-mini', floating && 'floating')} role="region" aria-label="Recording">
      <span className={classNames('rec-dot', r.phase === 'running' && 'on')} aria-hidden />
      <span className="rec-bar-time" role="timer">{fmtClock(r.seconds)}</span>
      {busy ? <span className="hint"><Loader2 size={13} className="spin" /> {r.status || 'Saving…'}</span> : <Meter level={r.level} on={r.phase === 'running'} />}
      <span className="grow" />
      <Controls compact />
      {!floating && <button className="btn ghost" onClick={() => recorder.setShowList(false)}>Recorder</button>}
      {r.notice && <span className="rec-notice small" role="status">{r.notice}</span>}
    </div>
  );
}

/** The list pane of a view: the recorder's panel while a record is made, the view's own list otherwise. */
export function PaneList({ children, className }: { children: ReactNode; className?: string }) {
  const r = useRecorder();
  const app = useApp();
  const active = r.phase !== 'idle';
  if (active && !r.showList && !app.isMobile) return <div className="pane-list rec-pane"><RecorderPanel /></div>;
  return <div className={classNames('pane-list', className)}>{active && !app.isMobile && <RecorderMini />}{children}</div>;
}
