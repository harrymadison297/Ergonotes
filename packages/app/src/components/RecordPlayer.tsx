import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, FileText, Filter, Loader2, Pause, Pencil, Play, Presentation, Sparkles, Trash2 } from 'lucide-react';
import { completeText, fmtClock, fmtMark, fromB64, joinWebm, parseRecordMeta, parseTranscript, plural, toB64, type RecordInfo } from '@ergonotes/core';
import { Dialog } from './ui';
import { getApi } from '../state/appRef';
import { getRecordHost, isNotePrivate, notifyRecord, onRecord } from '../record/host';
import { useRecorder } from '../record/recorder';
import { proposeFrameCuts, recordAudio, transcribeRecord, type FrameProposal } from '../record/tools';
import { classNames } from '../state/util';
import { askConfirm } from '../state/confirm';
import { watchProgress } from '../backend/localWhisper';

/** The folder of the record being made right now by this app, or ''. */
function useRecorderDir(): string {
  const r = useRecorder();
  return r.phase === 'idle' ? '' : r.dir;
}

const urls = new Map<string, string>();
/** An image of the vault as an object URL, loaded once. */
async function fileUrl(path: string): Promise<string | null> {
  const hit = urls.get(path);
  if (hit) return hit;
  const f = await getApi()?.getFileByPath(path);
  if (!f) return null;
  const u = URL.createObjectURL(new Blob([fromB64(f.data) as BlobPart], { type: f.mime }));
  urls.set(path, u);
  return u;
}

/** A frame is only fetched when it is on screen: a long meeting has hundreds. */
function FrameImg({ path, alt, className }: { path: string; alt: string; className?: string }) {
  // the path can change under one instance (the big frame follows the playback): the picture belongs to the path it was loaded for
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const src = urls.get(path) ?? (loaded?.path === path ? loaded.url : null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (src) return;
    const el = ref.current;
    if (!el) return;
    let live = true;
    const go = () => { void fileUrl(path).then(u => { if (live && u) setLoaded({ path, url: u }); }); };
    if (typeof IntersectionObserver === 'undefined') { go(); return () => { live = false; }; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, [path, src]);
  return src ? <img src={src} alt={alt} className={className} draggable={false} /> : <span ref={ref} className={classNames('frame-ph', className)} aria-label={alt} />;
}

export interface RecordPlayerProps {
  /** the vault paths the link can mean (the folder of the record) */
  paths: string[];
  label: string;
  /** put text in the note under the player (the summary) */
  insertAfter?: (markdown: string) => void;
}

export function RecordPlayer({ paths, label, insertAfter }: RecordPlayerProps) {
  const api = getApi();
  const [info, setInfo] = useState<RecordInfo | null | undefined>(undefined);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const dirRef = useRef('');
  const active = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    if (!api) return;
    for (const p of paths) {
      const r = await api.getRecord(p);
      if (r) { dirRef.current = r.path; setInfo(r); return; }
    }
    setInfo(prev => (prev === undefined ? null : prev));
  }, [api, paths]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onRecord(d => { if (!dirRef.current || d === dirRef.current) void load(); }), [load]);
  // while it is being recorded, look again now and then
  // a folder that says `recording` is either being written by this app right now, or was cut short (the app died, the power went)
  const recordingHere = useRecorderDir();
  const unfinished = info?.meta?.state === 'recording';
  const live = unfinished && recordingHere === info?.path;
  const incomplete = unfinished && !live;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [live, load]);

  // the sound: one file, or the pieces of a recording that was cut short, put in order
  const audioKey = info ? info.audio.join('|') + (unfinished ? '#unfinished' : '') : '';
  useEffect(() => {
    if (!api || !info || info.audio.length === 0) { setAudioUrl(null); return; }
    let alive = true;
    let made: string | null = null;
    void (async () => {
      const a = await recordAudio(api, info);
      if (!a || !alive) return;
      let bytes = a.bytes;
      if ((info.audio.length > 1 || unfinished) && a.mime.includes('webm')) bytes = joinWebm([bytes])?.data ?? bytes; // a length and a clock, so it can be sought
      made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime }));
      setAudioUrl(made);
    })();
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, audioKey]);

  const total = Math.max(length || 0, info?.meta?.seconds ?? 0, info?.frames.length ? info.frames[info.frames.length - 1].second + 1 : 0);
  const blocks = useMemo(() => parseTranscript(info?.transcript ?? ''), [info?.transcript]);
  const frameAt = useMemo(() => {
    const fs = info?.frames ?? [];
    let cur = -1;
    for (let i = 0; i < fs.length; i++) if (fs[i].second <= time + 0.4) cur = i; else break;
    return cur;
  }, [info?.frames, time]);
  const blockAt = useMemo(() => {
    let cur = -1;
    for (let i = 0; i < blocks.length; i++) if (blocks[i].at <= time + 0.4) cur = i; else break;
    return cur;
  }, [blocks, time]);
  useEffect(() => { active.current?.scrollIntoView({ block: 'nearest' }); }, [blockAt]);

  if (!api) return null;
  if (info === undefined) return <div className="record-card"><span className="hint">Loading…</span></div>;
  if (info === null) return <div className="record-card missing"><AudioLines size={18} aria-hidden /> <strong>{label}</strong> <span className="hint">This record is not on this device yet.</span></div>;

  const host = getRecordHost();
  const priv = isNotePrivate();
  const seek = (s: number) => { const a = audio.current; if (a) { a.currentTime = Math.max(0, s); setTime(Math.max(0, s)); } };
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const sttOk = !!host?.speechReady && !priv;

  const doTranscribe = async () => {
    if (!host || !sttOk) return;
    if (info.transcript && !(await askConfirm('Write the transcript again? The one that is there, with any changes you made, is replaced.', { ok: 'Write it again' }))) return;
    setErr(''); setBusy('Writing it out…');
    // a model on this computer reports how far it is in each window: a long one takes minutes
    let step = 'Writing it out…';
    const stopWatching = await watchProgress(pct => setBusy(`${step} ${pct}%`));
    try {
      await transcribeRecord({ api, dir: info.path, transcribe: host.transcribe, onStatus: s => { step = s; setBusy(s); } });
      notifyRecord(info.path);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    stopWatching();
    setBusy('');
  };
  const doSummary = async () => {
    if (!host || !info.transcript || !insertAfter) return;
    setErr(''); setBusy('Summarising…');
    try {
      const out = await completeText(host.transport, {
        model: 'chat', maxTokens: 700,
        system: 'You write minutes. Reply with Markdown only, in the language of the transcript, no preface.',
        messages: [{ role: 'user', content: `Summarise this transcript as 3 to 7 short bullet points. If decisions or action items were made, add them as "- [ ] " tasks after the bullets.\n\n${info.transcript.slice(0, 24000)}` }],
      });
      const md = out.trim().split('\n').map(l => /^\s*[-*+] \[[ xX]\] /.test(l) ? l.replace(/^(\s*)[-*+] /, '$1* ') : l.replace(/^(\s*)[*+] (?!\[)/, '$1- ')).join('\n');
      if (md) insertAfter(`**Summary**\n\n${md}\n`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy('');
  };
  const saveTranscript = async () => {
    if (editing === null) return;
    try {
      await api.addFile({ name: 'transcript.txt', mime: 'text/plain', data: toB64(new TextEncoder().encode(editing.replace(/\s+$/, '') + '\n')), dir: info.path });
      setEditing(null);
      notifyRecord(info.path);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  const kindLabel = info.meta?.kind === 'meeting' ? 'Meeting' : 'Recording';
  const marks = info.frames;
  return (
    <div className={classNames('record-card', live && 'live')} contentEditable={false}>
      <div className="record-head">
        <span className="audio-ico" aria-hidden><AudioLines size={18} /></span>
        <div className="record-title">
          <strong>{label}</strong>
          <span className="hint">
            {kindLabel} · {fmtClock(total)}{marks.length ? ` · ${plural(marks.length, 'frame')}` : ''}
            {live && ' · recording…'}
            {incomplete && ' · incomplete: the recording was cut short'}
          </span>
        </div>
        <div className="record-actions">
          {marks.length > 1 && <button className="btn" onClick={() => setFilter(true)} title="Find frames that repeat each other"><Filter size={15} /> Filter</button>}
          <button className="btn" disabled={!sttOk || !!busy || info.audio.length === 0 || live} onClick={() => void doTranscribe()}
            title={priv ? 'This note is private: its audio is not sent to a transcription server.' : !host?.speechReady ? 'Set up speech-to-text in Settings → AI.' : 'Write out what was said'}>
            <FileText size={15} /> {info.transcript ? 'Redo transcript' : 'Transcript'}
          </button>
          {insertAfter && info.transcript && !priv && host?.chatReady && (
            <button className="btn" disabled={!!busy} onClick={() => void doSummary()}><Sparkles size={15} /> Summary</button>
          )}
        </div>
      </div>

      {info.audio.length > 0 ? (
        <>
          <audio ref={audio} src={audioUrl ?? undefined} preload="metadata"
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={e => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setLength(d); }}
            onDurationChange={e => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setLength(d); }}
            onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          <div className="record-bar">
            <button className="record-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!audioUrl}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
            <span className="record-time">{fmtClock(time)}</span>
            <div className="record-track">
              <input type="range" min={0} max={Math.max(1, total)} step={0.1} value={Math.min(time, Math.max(1, total))}
                onChange={e => seek(Number(e.target.value))} aria-label="Position" />
              {marks.map(f => (
                <button key={f.second} className={classNames('record-mark', info.meta?.frames[String(f.second)] === 'user' && 'user')}
                  style={{ left: `${Math.min(100, (f.second / Math.max(1, total)) * 100)}%` }}
                  onClick={() => seek(f.second)} aria-label={`Frame at ${fmtClock(f.second)}`} title={`Frame at ${fmtClock(f.second)}`} />
              ))}
            </div>
            <span className="record-time end">{fmtClock(total)}</span>
          </div>
        </>
      ) : <p className="hint">No audio in this record.</p>}

      {marks.length > 0 && (
        <div className="record-frames">
          <div className="record-now">
            {frameAt >= 0
              ? <FrameImg path={marks[frameAt].path} alt={`Frame at ${fmtClock(marks[frameAt].second)}`} />
              : <span className="hint"><Presentation size={14} /> The first frame comes at {fmtClock(marks[0].second)}</span>}
          </div>
          <div className="record-strip" role="list">
            {marks.map((f, i) => (
              <button key={f.second} role="listitem" className={classNames('record-thumb', i === frameAt && 'on')} onClick={() => seek(f.second)}>
                <FrameImg path={f.path} alt={`Frame at ${fmtClock(f.second)}`} />
                <span>{fmtMark(f.second)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && <p role="status" className="hint"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {busy}</p>}
      {err && <p role="alert" className="error-text">{err}</p>}

      {(info.transcript !== null || editing !== null) && (
        <details className="record-transcript" open={blocks.length <= 40}>
          <summary>Transcript <span className="hint">{blocks.length} minute{blocks.length === 1 ? '' : 's'}</span></summary>
          {editing !== null ? (
            <div>
              <textarea className="input" rows={14} value={editing} onChange={e => setEditing(e.target.value)} aria-label="Transcript text" spellCheck={false} />
              <p className="hint">Each <code>[m:ss]</code> line is a time mark: change the words, keep the marks.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={() => void saveTranscript()}><Check size={15} /> Save</button>
                <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="record-lines">
                {blocks.map((b, i) => (
                  <button key={b.at + ':' + i} ref={i === blockAt ? active : undefined} className={classNames('record-line', i === blockAt && 'on')} onClick={() => seek(b.at)}>
                    <span className="record-mark-time">{fmtMark(b.at)}</span>
                    <span>{b.text}</span>
                  </button>
                ))}
              </div>
              <button className="btn" onClick={() => setEditing(info.transcript ?? '')}><Pencil size={14} /> Edit the text</button>
            </>
          )}
        </details>
      )}

      {filter && <FrameFilterDialog info={info} onClose={() => { setFilter(false); void load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Filter: propose, show, delete only when confirmed
function FrameFilterDialog({ info: opened, onClose }: { info: RecordInfo; onClose: () => void }) {
  const api = getApi()!;
  const host = getRecordHost();
  // the record is reloaded now and then behind the dialog (a new object each time): the dialog works on what it was opened with,
  // so a reload does not start the comparison again and throw away what the person ticked
  const [info] = useState(opened);
  const started = useRef(false);
  const priv = isNotePrivate();
  const canAi = !!host?.visionReady && !priv;
  const ownFrames = Object.values(opened.meta?.frames ?? {}).filter(v => v === 'user').length;
  const [phase, setPhase] = useState<'ask' | 'working' | 'review' | 'deleting'>(canAi ? 'ask' : 'working');
  const [status, setStatus] = useState('');
  const [props, setProps] = useState<FrameProposal[]>([]);
  const [cut, setCut] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const ctl = useRef(new AbortController());
  useEffect(() => () => ctl.current.abort(), []);

  const run = useCallback(async (withAi: boolean) => {
    setPhase('working');
    setErr('');
    try {
      const r = await proposeFrameCuts({ api, info, transport: withAi && host ? host.transport : null, onStatus: setStatus, signal: ctl.current.signal });
      setProps(r.proposals);
      setCut(new Set(r.proposals.filter(p => p.why).map(p => p.second)));
      setNote(r.failed ? `${r.failed} frame${r.failed === 1 ? '' : 's'} could not be judged by the model and stay.` : '');
      setPhase('review');
    } catch (e) {
      if (ctl.current.signal.aborted) return;
      setErr(e instanceof Error ? e.message : String(e));
      setPhase(withAi ? 'ask' : 'review');
    }
  }, [api, info, host]);
  useEffect(() => { if (!canAi && !started.current) { started.current = true; void run(false); } }, [canAi, run]);

  const remove = async () => {
    setPhase('deleting');
    try {
      const gone = props.filter(p => cut.has(p.second));
      await api.removeFiles(gone.map(p => p.path));
      // the record's own list of frames follows the files
      const text = await api.getFileByPath(`${info.path}/record.json`);
      if (text) {
        try {
          const m = parseRecordMeta(new TextDecoder().decode(fromB64(text.data)));
          if (!m) throw new Error('unreadable');
          for (const p of gone) delete m.frames[String(p.second)];
          await api.addFile({ name: 'record.json', mime: 'application/json', data: toB64(new TextEncoder().encode(JSON.stringify(m, null, 2))), dir: info.path });
        } catch { /* the folder is the truth; the list is rebuilt from it */ }
      }
      notifyRecord(info.path);
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('review'); }
  };

  const nProp = props.filter(p => p.why).length;
  return (
    <Dialog title="Filter frames" wide onClose={() => { if (phase !== 'deleting') onClose(); }}
      footer={
        phase === 'review' ? (
          <>
            <button className="btn" onClick={onClose}>Keep everything</button>
            <button className="btn primary" disabled={cut.size === 0} onClick={() => void remove()}><Trash2 size={15} /> Delete {plural(cut.size, 'frame')}</button>
          </>
        ) : phase === 'ask' ? (
          <>
            <button className="btn" onClick={() => void run(false)}>Compare on this device only</button>
            <button className="btn primary" onClick={() => void run(true)}>Ask the model</button>
          </>
        ) : undefined
      }>
      {phase === 'ask' && (
        <div>
          <p>Frames that only repeat a later one are found on this device. The model can also say which of the rest add nothing.</p>
          <p className="hint">Asking the model sends up to {plural(info.frames.length - ownFrames, 'frame')} (pictures of the shared screen; the ones you took yourself stay here) to <strong>{host?.visionName}</strong>. Nothing is deleted until you confirm.</p>
        </div>
      )}
      {(phase === 'working' || phase === 'deleting') && <p role="status"><Loader2 size={14} className="spin" style={{ verticalAlign: -2 }} /> {phase === 'deleting' ? 'Deleting…' : status || 'Working…'}</p>}
      {phase === 'review' && (
        <div>
          <p>{nProp ? `${nProp} of ${props.length} frames can go.` : `Nothing to cut among ${props.length} frames.`} Tick the ones to delete.</p>
          {priv && <p className="hint">This note is private: the frames were compared on this device only.</p>}
          {!priv && !canAi && <p className="hint">No model that looks at pictures is set up (Settings → AI), so the frames were compared on this device only.</p>}
          {note && <p className="hint">{note}</p>}
          <div className="filter-grid">
            {props.map(p => (
              <label key={p.second} className={classNames('filter-item', cut.has(p.second) && 'cut', p.user && 'user')}>
                <FrameImg path={p.path} alt={`Frame at ${fmtClock(p.second)}`} />
                <span className="filter-cap">
                  <input type="checkbox" checked={cut.has(p.second)} onChange={e => setCut(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.second); else n.delete(p.second); return n; })} />
                  {fmtMark(p.second)}{p.user ? ' · yours' : p.why === 'ai' ? ' · model' : p.why === 'same' ? ' · repeats' : ''}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {err && <p role="alert" className="error-text">{err}</p>}
    </Dialog>
  );
}
