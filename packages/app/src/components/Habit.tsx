import { useEffect, useMemo, useState } from 'react';
import { Check, Flame, Loader2, Plus, X } from 'lucide-react';
import type { HabitDay, HabitDetail, HabitInfo, Nudge } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames } from '../state/util';
import { describeTarget, dismissNudge, hhmm, nudgeDismissed, nudgeId, progress, STATE_WORD } from '../state/habits';
import { Dialog } from './ui';

/** A ring of how much of today's window is done (`done` of `of`). */
export function Ring({ done, of, size = 36, met }: { done: number; of: number; size?: number; met?: boolean }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, of ? done / of : 0));
  return (
    <svg className={classNames('habit-ring', met && 'met')} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} className="track" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={4} strokeLinecap="round" className="fill" strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {met && <path d={`M${size * 0.32} ${size * 0.52} l${size * 0.12} ${size * 0.12} l${size * 0.22} -${size * 0.26}`} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="tick" />}
    </svg>
  );
}

/** The last seven days of a Habit as dots: met, behind, not counted, today. */
export function Dots({ days }: { days: HabitDay[] }) {
  return (
    <span className="habit-dots" role="img" aria-label={`Last ${days.length} days`}>
      {days.slice(-7).map(d => <i key={d.date} className={`d-${d.state}`} title={`${d.date}${STATE_WORD[d.state] ? ' · ' + STATE_WORD[d.state] : ''}`} />)}
    </span>
  );
}

/** Check in now (or for a past day) with an Undo in the toast. */
export function useCheckIn() {
  const app = useApp();
  return async (h: { id: string; title: string }, o: { date?: string; text?: string } = {}) => {
    const date = o.date ?? app.today;
    const time = date === app.today ? hhmm() : undefined;
    const ok = await app.run(app.api.checkInHabit(h.id, { date, time, text: o.text }).then(() => true));
    if (!ok) return;
    await app.refresh();
    app.toast(`Checked in “${h.title}”`, 'info', { label: 'Undo', run: async () => { await app.run(app.api.undoCheckIn(h.id, date)); await app.refresh(); } }, `checkin:${h.id}`);
  };
}

/** What the app says about a Habit now; put away for the rest of the day with the cross. */
export function NudgeCard({ habit, nudge, showName }: { habit: HabitInfo; nudge: Nudge; showName?: boolean }) {
  const app = useApp();
  const id = nudgeId(habit, nudge);
  const [gone, setGone] = useState(() => nudgeDismissed(app.today, id));
  if (gone) return null;
  return (
    <div className={classNames('nudge', `nudge-${nudge.tone}`)} role="status">
      {nudge.tone === 'good' ? <Flame size={16} aria-hidden /> : <span className="nudge-dot" aria-hidden />}
      <span className="grow">{showName && <a href={`#/notes/${habit.id}`}><b>{habit.title}</b></a>}{showName ? ' · ' : ''}{nudge.text}</span>
      <button type="button" className="icon-btn" aria-label="Put this message away for today" title="Put away for today" onClick={() => { dismissNudge(app.today, id); setGone(true); }}><X size={16} /></button>
    </div>
  );
}

/** The dialog that makes a Habit. */
export function NewHabitDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState(1);
  const [per, setPer] = useState<1 | 3 | 5 | 7>(1);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const n = await app.api.createHabit({ title: title.trim(), target, per, start: app.today, description: desc });
      await app.refresh();
      onClose();
      app.go({ name: 'notes', note: n.id, folder: n.parent ?? undefined });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return (
    <Dialog title="New habit" onClose={onClose} footer={<button className="btn primary" disabled={busy || !title.trim()} onClick={() => void submit()}>{busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Create</button>}>
      <div className="field"><label htmlFor="hb-name">Name</label><input id="hb-name" className="input" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Drink water" onKeyDown={e => { if (e.key === 'Enter' && title.trim()) void submit(); }} /></div>
      <div className="field">
        <label htmlFor="hb-target">How often</label>
        <div className="habit-often">
          <input id="hb-target" className="input" type="number" min={1} max={99} value={target} onChange={e => setTarget(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} aria-label="Times" />
          <span>time{target === 1 ? '' : 's'} in</span>
          <div className="seg" role="group" aria-label="Days">
            {([1, 3, 5, 7] as const).map(p => <button key={p} type="button" aria-pressed={per === p} onClick={() => setPer(p)}>{p} day{p === 1 ? '' : 's'}</button>)}
          </div>
        </div>
        <span className="hint">{describeTarget({ target, per })}. The app counts back from today over that many days; there is no time of day.</span>
      </div>
      <div className="field"><label htmlFor="hb-desc">Notes <span className="hint">(optional)</span></label><textarea id="hb-desc" className="input" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Why it matters, what counts" /></div>
      {err && <p role="alert" className="error-text">{err}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- the panel above a Habit's note
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

/** 12 weeks as columns of seven days, Monday at the top; the first column is padded so each day sits on its weekday. */
export function weeksOf(days: HabitDay[]): (HabitDay | null)[][] {
  if (days.length === 0) return [];
  const dow = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const cells: (HabitDay | null)[] = [...Array<null>(dow(days[0].date)).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks: (HabitDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function HabitPanel({ id, updated }: { id: string; updated: string }) {
  const app = useApp();
  const [d, setD] = useState<HabitDetail | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const checkIn = useCheckIn();
  useEffect(() => {
    let live = true;
    void app.api.habit(id, app.today).then(x => { if (live) setD(x); });
    return () => { live = false; };
  }, [id, updated, app.today, app.api]);
  const weeks = useMemo(() => (d ? weeksOf(d.status.days) : []), [d]);
  if (!d) return null;
  const s = d.status;
  const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);
  const met = s.todayState === 'met';
  const sel = day ? s.days.find(x => x.date === day) : null;
  const ins = day ? d.checkIns.filter(c => c.date === day) : [];
  const remark = day ? d.remarks.find(r => r.date === day)?.text ?? '' : '';
  return (
    <section className="habit-panel" aria-label="Habit">
      {d.nudge && <NudgeCard habit={d} nudge={d.nudge} />}
      <div className="habit-head">
        <Ring done={s.inWindow} of={d.target} size={44} met={met} />
        <div className="grow">
          <div className="habit-target">
            <select aria-label="Times" value={d.target} onChange={e => void app.api.updateHabit(id, { target: Number(e.target.value) }).then(() => app.refresh())}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>time{d.target === 1 ? '' : 's'} in</span>
            <select aria-label="Days" value={d.per} onChange={e => void app.api.updateHabit(id, { per: Number(e.target.value) }).then(() => app.refresh())}>
              {[1, 3, 5, 7].map(n => <option key={n} value={n}>{n} day{n === 1 ? '' : 's'}</option>)}
            </select>
          </div>
          <div className="habit-sub">{met ? 'Today is met' : s.todayState === 'exempt' ? 'Not counted yet' : `${s.left} to go today`} · {progress(d)} in the last {d.per === 1 ? 'day' : `${d.per} days`}</div>
        </div>
        <button className="btn primary" onClick={() => void checkIn(d)}><Check size={16} /> Check in</button>
        <label className="habit-archive"><input type="checkbox" checked={d.archived} onChange={e => void app.api.updateHabit(id, { archived: e.target.checked }).then(() => app.refresh())} /> Archived</label>
      </div>
      <dl className="habit-stats">
        <div><dt>Streak</dt><dd>{s.streak}<small> day{s.streak === 1 ? '' : 's'}</small></dd></div>
        <div><dt>Best</dt><dd>{s.best}<small> day{s.best === 1 ? '' : 's'}</small></dd></div>
        <div><dt>Missed</dt><dd>{s.missed}<small> in a row</small></dd></div>
        <div><dt>7 days</dt><dd>{pct(s.rate.d7)}</dd></div>
        <div><dt>30 days</dt><dd>{pct(s.rate.d30)}</dd></div>
        <div><dt>90 days</dt><dd>{pct(s.rate.d90)}</dd></div>
      </dl>
      <div className="habit-heat" role="group" aria-label="Last 12 weeks">
        <div className="heat-days" aria-hidden>{WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}</div>
        {weeks.map((w, i) => (
          <div className="heat-week" key={i}>
            {w.map((c, j) => c
              ? <button key={c.date} type="button" className={classNames('heat-cell', `d-${c.state}`, c.date === day && 'sel', c.date === s.today && 'today')}
                  disabled={c.state === 'future'} aria-label={`${c.date}: ${STATE_WORD[c.state] || 'later'}, ${c.count} check-in${c.count === 1 ? '' : 's'}`} aria-pressed={c.date === day}
                  title={`${c.date}${STATE_WORD[c.state] ? ' · ' + STATE_WORD[c.state] : ''}${c.count ? ` · ${c.count} done` : ''}`} onClick={() => setDay(c.date === day ? null : c.date)} />
              : <i key={j} className="heat-cell blank" />)}
          </div>
        ))}
      </div>
      {sel && (
        <div className="habit-day">
          <div className="habit-day-head"><b>{new Date(sel.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</b><span className="muted"> · {STATE_WORD[sel.state]}</span>
            <span className="grow" /><button className="icon-btn" aria-label="Close day" onClick={() => setDay(null)}><X size={16} /></button></div>
          {ins.length > 0 && <ul className="habit-ins">{ins.map(c => <li key={c.line}><Check size={14} aria-hidden /> {c.time ?? 'logged later'}{c.text ? ` · ${c.text}` : ''}</li>)}</ul>}
          <label className="habit-remark"><span>Remark</span>
            <textarea key={sel.date} className="input" rows={2} defaultValue={remark} placeholder="How it went, why it was skipped…"
              onBlur={e => { if (e.target.value.trim() !== remark) void app.api.setHabitRemark(id, sel.date, e.target.value).then(() => app.refresh()); }} /></label>
          <button className="btn" onClick={() => void checkIn(d, { date: sel.date })}><Plus size={14} /> Log a check-in on this day</button>
        </div>
      )}
    </section>
  );
}

/** A Habit that still wants something today, as a row among the tasks: tick it to check in. */
export function HabitTaskRow({ h, compact }: { h: HabitInfo; compact?: boolean }) {
  const checkIn = useCheckIn();
  const left = h.status.left;
  return (
    <div className={classNames('task-row habit-task', compact && 'compact')} style={compact ? { padding: '8px 0', borderBottom: 0 } : undefined}>
      <button className="task-check habit" role="checkbox" aria-checked={false} aria-label={`Check in ${h.title}`} onClick={() => void checkIn(h)} />
      <a className="body" href={`#/notes/${h.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="tt">{h.title}</span>
        <span className="due habit-due">{progress(h)} · {left} to go{h.per > 1 ? ` in ${h.per} days` : ' today'}</span>
        {!compact && <span className="src" style={{ display: 'block' }}>Habit · {describeTarget(h)}</span>}
      </a>
    </div>
  );
}
