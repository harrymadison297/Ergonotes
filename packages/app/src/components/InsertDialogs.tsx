import { useState } from 'react';
import { Dialog } from './ui';
import { isoDay } from '../state/util';

const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };

/** Pick a day for an `@date(…)` mention. */
export function DateDialog({ onInsert, onClose }: { onInsert: (day: string) => void; onClose: () => void }) {
  const [day, setDay] = useState(isoDay());
  return (
    <Dialog title="Date mention" onClose={onClose} footer={<button className="btn primary" disabled={!day} onClick={() => onInsert(day)}>Insert</button>}>
      <div className="field"><label htmlFor="dm-d">Date</label><input id="dm-d" type="date" className="input" value={day} onChange={e => setDay(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && day) onInsert(day); }} /></div>
      <div className="seg" role="group" aria-label="Quick dates">
        <button type="button" aria-pressed={day === plusDays(0)} onClick={() => setDay(plusDays(0))}>Today</button>
        <button type="button" aria-pressed={day === plusDays(1)} onClick={() => setDay(plusDays(1))}>Tomorrow</button>
        <button type="button" aria-pressed={day === plusDays(7)} onClick={() => setDay(plusDays(7))}>Next week</button>
      </div>
    </Dialog>
  );
}

/** A dated entry: `Title @event(2026-10-20T09:00-10:30)`; it shows on the calendar. */
export function EventDialog({ initialTitle, onInsert, onClose }: { initialTitle: string; onInsert: (text: string) => void; onClose: () => void }) {
  const [title, setTitle] = useState(initialTitle);
  const [day, setDay] = useState(isoDay());
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const bad = end !== '' && !allDay && start !== '' && end <= start;
  const ok = title.trim() !== '' && day !== '' && !bad;
  const token = allDay || !start ? day : end ? `${day}T${start}-${end}` : `${day}T${start}`;
  const submit = () => ok && onInsert(`${title.trim().replace(/\s+/g, ' ')} @event(${token})`);
  return (
    <Dialog title="Event" onClose={onClose} footer={<button className="btn primary" disabled={!ok} onClick={submit}>Insert</button>}>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="field"><label htmlFor="ev-t">Title</label><input id="ev-t" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Team sync" /></div>
        <div className="field"><label htmlFor="ev-d">Date</label><input id="ev-d" type="date" className="input" value={day} onChange={e => setDay(e.target.value)} /></div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> All day</label>
        {!allDay && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label htmlFor="ev-s">Starts</label><input id="ev-s" type="time" className="input" value={start} onChange={e => setStart(e.target.value)} /></div>
            <div className="field"><label htmlFor="ev-e">Ends</label><input id="ev-e" type="time" className="input" value={end} onChange={e => setEnd(e.target.value)} /></div>
          </div>
        )}
        {bad && <p className="error-text" role="alert">The end must be after the start.</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Create a note in the same folder and link to it from here. */
export function LinkedNoteDialog({ onCreate, onClose }: { onCreate: (title: string) => void | Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { if (busy) return; setBusy(true); try { await onCreate(title.trim() || 'Untitled'); } finally { setBusy(false); } };
  return (
    <Dialog title="New linked note" onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => void go()}>Create and link</button>}>
      <form onSubmit={e => { e.preventDefault(); void go(); }}>
        <div className="field"><label htmlFor="ln-t">Title of the new note</label><input id="ln-t" className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Untitled" /></div>
        <p className="hint">The note is created next to this one. A link to it is inserted at the cursor.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
