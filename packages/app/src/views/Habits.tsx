import { useState } from 'react';
import { Check, Plus, Repeat } from 'lucide-react';
import type { HabitInfo } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames } from '../state/util';
import { describeTarget, progress } from '../state/habits';
import { Dots, HabitPage, NewHabitDialog, NudgeCard, Ring, useCheckIn } from '../components/Habit';
import { habitHref } from '../state/router';

function HabitRow({ h }: { h: HabitInfo }) {
  const checkIn = useCheckIn();
  const met = h.status.todayState === 'met';
  return (
    <li className={classNames('habit-row', h.archived && 'archived')}>
      <Ring done={h.status.inWindow} of={h.target} met={met} />
      <a className="habit-name" href={habitHref(h.id)}>
        <b>{h.title}</b>
        <small>{describeTarget(h)} · {progress(h)} now</small>
      </a>
      <span className="habit-streak" title="Days in a row">{h.status.streak > 0 ? `${h.status.streak} day${h.status.streak === 1 ? '' : 's'}` : '–'}</span>
      <Dots days={h.status.days} />
      {!h.archived && <button className="btn" onClick={() => void checkIn(h)} aria-label={`Check in ${h.title}`}><Check size={16} /> {met ? '+1' : 'Check in'}</button>}
    </li>
  );
}

function HabitList() {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const active = app.habits.filter(h => !h.archived);
  const archived = app.habits.filter(h => h.archived);
  const nudges = active.filter(h => h.nudge);
  return (
    <div className="habits-page">
      <div className="habits-head">
        <h1>Habits</h1>
        <span className="grow" />
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New habit</button>
      </div>
      {nudges.length > 0 && <div className="nudges">{nudges.map(h => <NudgeCard key={h.id} habit={h} nudge={h.nudge!} showName />)}</div>}
      {active.length === 0
        ? <div className="empty"><Repeat size={32} /><h3>No habits yet</h3><p>A habit is something you want to do again and again: 8 glasses of water a day, a run 2 times in 3 days. Check in each time, and the app keeps your streak.</p><button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> New habit</button></div>
        : <ul className="habit-list">{active.map(h => <HabitRow key={h.id} h={h} />)}</ul>}
      {archived.length > 0 && (
        <details className="habit-archived"><summary>Archived ({archived.length})</summary>
          <ul className="habit-list">{archived.map(h => <HabitRow key={h.id} h={h} />)}</ul></details>
      )}
      {adding && <NewHabitDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** The list of Habits, or the page of one (`#/habits/<id>`). */
export function HabitsView() {
  const app = useApp();
  return app.route.name === 'habits' && app.route.habit ? <HabitPage key={app.route.habit} id={app.route.habit} /> : <HabitList />;
}
