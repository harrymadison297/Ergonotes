import { GitMerge } from 'lucide-react';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { Resizer } from '../components/Resizer';
import { NoteEditor } from '../components/NoteEditor';
import { PaneList } from '../components/RecorderPanel';

export function ConflictsView({ noteId }: { noteId?: string }) {
  const app = useApp();
  const list = (
    <PaneList>
      <Resizer pane="listW" edge="right" label="Resize list" />
      <div className="list-head"><h2>Conflicts</h2><div className="meta"><span>{app.conflicts.length} note{app.conflicts.length === 1 ? '' : 's'} changed on more than one device</span></div></div>
      <div className="list-scroll">
        {app.conflicts.length === 0 && <div className="empty"><GitMerge size={32} /><h3>No conflicts</h3><p>When two devices edit the same text at once, both versions are kept here until you choose.</p></div>}
        {app.conflicts.map(c => (
          <a key={c.id} className={`note-row${c.id === noteId ? ' active' : ''}`} href={href({ name: 'conflicts', note: c.id })}>
            <div className="info"><div className="t">{c.title}</div><div className="when">{c.heads} versions</div></div>
            <button className="btn" onClick={e => { e.preventDefault(); app.setDialog({ kind: 'conflict', id: c.id }); }}>Compare</button>
          </a>
        ))}
      </div>
    </PaneList>
  );
  if (app.isMobile) return <div className="m-content">{list}{noteId && <div className="m-note"><NoteEditor key={noteId} id={noteId} onBack={() => app.go({ name: 'conflicts' })} /></div>}</div>;
  return (
    <div className="split">{list}
      <div className="pane-body">{noteId ? <NoteEditor key={noteId} id={noteId} /> : <div className="empty" style={{ margin: 'auto' }}><h3>Select a note to review</h3></div>}</div>
    </div>
  );
}
