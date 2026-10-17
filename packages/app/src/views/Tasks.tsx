import { useMemo, useState } from 'react';
import { Check, Flag } from 'lucide-react';
import type { TaskEntry } from '@ergonotes/core';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, dueLabel } from '../state/util';
import { Resizer } from '../components/Resizer';
import { NoteEditor } from '../components/NoteEditor';
import { PaneList } from '../components/RecorderPanel';

export function TaskRow({ t, compact, active }: { t: TaskEntry; compact?: boolean; active?: boolean }) {
  const app = useApp();
  const due = t.due ? dueLabel(t.due) : null;
  return (
    <div className={classNames('task-row', t.done && 'done', compact && 'compact')} style={compact ? { padding: '8px 0', borderBottom: 0 } : active ? { background: 'var(--bg)' } : undefined}>
      <button className={classNames('task-check', t.done && 'done')} role="checkbox" aria-checked={t.done} aria-label={`${t.done ? 'Reopen' : 'Complete'} ${t.text}`}
        onClick={async () => { await app.run(app.api.toggleTask(t.noteId, t.index, !t.done)); await app.refresh(); }}>
        {t.done && <Check size={14} />}
      </button>
      <a className="body" href={href({ name: 'tasks', note: t.noteId, task: t.index })} style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="tt">{t.text || (t.doneAt ? t.noteTitle : 'Untitled task')} {t.flag && <Flag size={13} className="flag" />}</span>
        {due && <span className={classNames('due', due.overdue && !t.done && 'overdue')}>{due.text}</span>}
        {!compact && <span className="src" style={{ display: 'block' }}>{t.noteTitle}</span>}
      </a>
    </div>
  );
}

export function TasksView({ noteId, taskIndex }: { noteId?: string; taskIndex?: number }) {
  const app = useApp();
  const [tab, setTab] = useState<'open' | 'due' | 'done'>('open');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    let l = app.tasks;
    if (q.trim()) l = l.filter(t => t.text.toLowerCase().includes(q.toLowerCase()) || t.noteTitle.toLowerCase().includes(q.toLowerCase()));
    if (tab === 'open') return l.filter(t => !t.done);
    if (tab === 'due') return l.filter(t => !t.done && t.due).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
    return l.filter(t => t.done);
  }, [app.tasks, tab, q]);
  const openCount = app.tasks.filter(t => !t.done).length;

  const listPane = (
    <PaneList>
      <Resizer pane="listW" edge="right" label="Resize list" />
      <div className="list-head">
        <h2>Tasks</h2>
        <div className="meta"><span>{openCount} open</span></div>
        <div className="field" style={{ margin: '10px 0 0' }}>
          <input className="input" type="search" placeholder="Find task" aria-label="Find task" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      <div className="tabs" role="tablist">
        {([['open', 'My tasks'], ['due', 'Due dates'], ['done', 'Completed']] as const).map(([k, l]) => (
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="list-scroll">
        {list.length === 0 && <div className="empty"><h3>{tab === 'done' ? 'Nothing completed yet' : 'No tasks'}</h3><p>Add a checklist in any note and it appears here.</p></div>}
        {list.map(t => <TaskRow key={`${t.noteId}-${t.index}`} t={t} active={t.noteId === noteId && (taskIndex === undefined || t.index === taskIndex)} />)}
      </div>
    </PaneList>
  );
  if (app.isMobile) return <div className="m-content" style={{ display: 'flex', flexDirection: 'column' }}>{listPane}</div>;
  return (
    <div className="split">
      {listPane}
      <div className="pane-body">{noteId ? <NoteEditor key={noteId} id={noteId} focusTask={taskIndex === undefined ? undefined : { index: taskIndex, text: app.tasks.find(t => t.noteId === noteId && t.index === taskIndex)?.text }} /> : <div className="empty"><h3>Select a task</h3><p>Its note opens here.</p></div>}</div>
    </div>
  );
}
