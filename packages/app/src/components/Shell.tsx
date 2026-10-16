import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Cloud, FilePlus2, FileText, Folder as FolderIcon, Home as HomeIcon, Keyboard, LayoutTemplate,
  MoreHorizontal, Paperclip, Search, Settings as SettingsIcon, Tag as TagIcon, Trash2,
} from 'lucide-react';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, parseDue } from '../state/util';
import { CalendarView } from '../views/Calendar';
import { ConflictsView } from '../views/Conflicts';
import { FilesView } from '../views/Files';
import { FoldersView } from '../views/Folders';
import { Home } from '../views/Home';
import { NotesView, TrashView } from '../views/Notes';
import { TasksView } from '../views/Tasks';
import { FilePreviewDialog } from './FilePreview';
import { SearchPalette } from './SearchPalette';
import { ConflictDialog, HistoryDialog, ImportDialog, MoveDialog, NameDialog, SettingsDialog, TemplatesDialog } from './Dialogs';
import { Sidebar } from './Sidebar';
import { RightSidebar, useAsideVisible } from './RightSidebar';
import { IconBtn, TagLink, Toasts } from './ui';
import { useSync } from './useSync';
import { RecorderMini } from './RecorderPanel';
import { recorder, useRecorder } from '../record/recorder';
import { usePrefs } from '../state/prefs';
import { COMMANDS, keysFor, useCommands } from '../state/commands';
import { chordOf, needsModifier } from '../state/keymap';

function RouteView() {
  const { route } = useApp();
  switch (route.name) {
    case 'home': return <Home />;
    case 'notes': return <NotesView noteId={route.note} />;
    case 'tasks': return <TasksView noteId={route.note} taskIndex={route.task} />;
    case 'calendar': return <CalendarView noteId={route.note} />;
    case 'files': return <FilesView fileId={route.file} />;
    case 'folders': return <FoldersView />;
    case 'trash': return <TrashView noteId={route.note} />;
    case 'conflicts': return <ConflictsView noteId={route.note} />;
    case 'more': return <MoreView />;
  }
}

function DialogHost() {
  const app = useApp();
  const d = app.dialog;
  const close = () => app.setDialog(null);
  if (!d) return null;
  switch (d.kind) {
    case 'settings': return <SettingsDialog tab={d.tab} onClose={close} />;
    case 'shortcuts': return <SettingsDialog tab="keyboard" onClose={close} />;
    case 'search': return <SearchPalette onClose={close} />;
    case 'templates': return <TemplatesDialog onClose={close} />;
    case 'move': return <MoveDialog id={d.id} onClose={close} />;
    case 'conflict': return <ConflictDialog id={d.id} onClose={close} />;
    case 'history': return <HistoryDialog id={d.id} onClose={close} />;
    case 'import': return <ImportDialog onClose={close} />;
    case 'file': return <FilePreviewDialog id={d.id} onClose={close} />;
    case 'newFolder': return (
      <NameDialog title="New folder" cta="Create" onClose={close}
        onSubmit={async v => { await app.run(app.api.createFolder({ title: v, parent: d.parent })); await app.refresh(); }} />
    );
    case 'renameTag': return (
      <NameDialog title="Rename tag" cta="Rename" initial={d.tag} onClose={close}
        onSubmit={async v => { const n = await app.run(app.api.renameTag(d.tag, v)); await app.refresh(); app.toast(`Updated ${n ?? 0} note${n === 1 ? '' : 's'}`); }} />
    );
    case 'rename': return (
      <NameDialog title="Rename" cta="Rename" initial={app.byId.get(d.id)?.title} onClose={close}
        onSubmit={async v => { await app.run(app.api.rename(d.id, v)); await app.refresh(); }} />
    );
  }
}

function useGlobalShortcuts() {
  const cmds = useCommands();
  const latest = useRef(cmds);
  latest.current = cmds;
  const pending = useRef<{ first: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const chord = chordOf(e);
      if (!chord) return;
      const el = e.target as HTMLElement;
      const typing = el.matches('input, textarea, select, [contenteditable="true"]') || el.isContentEditable;
      const { prefs } = latest.current;
      const bound = COMMANDS.filter(c => !c.scoped).map(c => ({ id: c.id, keys: keysFor(c, prefs.keys) }));
      // the second key of a two-key shortcut
      if (pending.current) {
        const seq = `${pending.current.first} ${chord}`;
        clearTimeout(pending.current.timer);
        pending.current = null;
        const hit = bound.find(b => b.keys.includes(seq));
        if (hit) { e.preventDefault(); latest.current.run(hit.id); return; }
      }
      // a bare key is text while typing; only a chord with Ctrl or Alt (or a function key) is a shortcut there
      if (typing && !needsModifier(chord) && !/^F\d/.test(chord)) return;
      const hit = bound.find(b => b.keys.includes(chord));
      if (hit) { e.preventDefault(); latest.current.run(hit.id); return; }
      if (!typing && bound.some(b => b.keys.some(k => k.startsWith(`${chord} `)))) {
        pending.current = { first: chord, timer: setTimeout(() => { pending.current = null; }, 900) };
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Android: text shared into the app from another app becomes a Capture in the Inbox. */
function useShareIntent() {
  const app = useApp();
  useEffect(() => {
    const take = async () => {
      const bridge = (window as unknown as { ErgoShare?: { take(): string } }).ErgoShare;
      const text = bridge?.take();
      if (!text) return;
      const n = await app.run(app.api.capture({ text }));
      if (n) { await app.refresh(); app.toast('Saved to Inbox'); }
    };
    void take();
    window.addEventListener('ergo-share', take);
    return () => window.removeEventListener('ergo-share', take);
  }, [app.api]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Local reminder notifications for tasks with @remind(...). */
const FIRED_KEY = 'ergo.fired';
const MISSED_WINDOW_MS = 7 * 24 * 3600e3;
function readFired(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function useReminders() {
  const app = useApp();
  // the interval must survive re-renders, and a restart must not fire the same reminder again
  const latest = useRef({ tasks: app.tasks, toast: app.toast });
  latest.current = { tasks: app.tasks, toast: app.toast };
  const fired = useRef<Set<string>>(readFired());
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      let changed = false;
      for (const t of latest.current.tasks) {
        if (t.done || !t.remind) continue;
        const at = parseDue(t.remind, 'T09:00');
        const key = `${t.noteId}:${t.index}:${t.remind}`;
        // a reminder that came due while the app was closed still shows once (within a week)
        if (Number.isNaN(at) || at > now || now - at > MISSED_WINDOW_MS || fired.current.has(key)) continue;
        fired.current.add(key);
        changed = true;
        latest.current.toast(`Reminder: ${t.text}`);
        try {
          if ('__TAURI_INTERNALS__' in window) {
            const n = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
            if (await n.isPermissionGranted() || (await n.requestPermission()) === 'granted') n.sendNotification({ title: 'Reminder', body: t.text });
          } else if ('Notification' in window && Notification.permission === 'granted') new Notification('Reminder', { body: t.text });
        } catch { /* notifications unavailable */ }
      }
      if (changed) { try { localStorage.setItem(FIRED_KEY, JSON.stringify([...fired.current].slice(-500))); } catch { /* private mode */ } }
    };
    const id = setInterval(() => void tick(), 20_000);
    void tick();
    return () => clearInterval(id);
  }, []);
}

function MoreView() {
  const app = useApp();
  const sync = useSync();
  const rows: { icon: JSX.Element; label: string; to?: string; onClick?: () => void; badge?: number }[] = [
    { icon: <CalendarDays size={20} />, label: 'Calendar', to: href({ name: 'calendar' }) },
    { icon: <Paperclip size={20} />, label: 'Files', to: href({ name: 'files' }) },
    { icon: <LayoutTemplate size={20} />, label: 'New from template', onClick: () => app.setDialog({ kind: 'templates' }) },
    { icon: <AlertTriangle size={20} />, label: 'Conflicts', to: href({ name: 'conflicts' }), badge: app.conflicts.length },
    { icon: <Trash2 size={20} />, label: 'Trash', to: href({ name: 'trash' }) },
    { icon: <Cloud size={20} />, label: 'Sync now', onClick: () => void sync.run() },
    { icon: <SettingsIcon size={20} />, label: 'Settings', onClick: () => app.setDialog({ kind: 'settings' }) },
    { icon: <Keyboard size={20} />, label: 'Keyboard shortcuts', onClick: () => app.setDialog({ kind: 'shortcuts' }) },
  ];
  return (
    <div className="m-content m-more">
      <div className="page-head"><h1>More</h1></div>
      {rows.map(r => r.to
        ? <a key={r.label} href={r.to}>{r.icon}<span style={{ flex: 1 }}>{r.label}</span>{!!r.badge && <span className="badge">{r.badge}</span>}<ChevronRight size={18} /></a>
        : <button key={r.label} onClick={r.onClick}>{r.icon}<span style={{ flex: 1 }}>{r.label}</span><ChevronRight size={18} /></button>)}
      {app.tags.length > 0 && (
        <div style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 'var(--fs-s)', color: 'var(--text-2)' }}><TagIcon size={14} /> Tags</h3>
          <div className="tag-cloud">{app.tags.map(t => <TagLink key={t.tag} tag={t.tag} count={t.count} href={href({ name: 'notes', tag: t.tag })} />)}</div>
        </div>
      )}
    </div>
  );
}

function MobileShell() {
  const app = useApp();
  const { route } = app;
  const noteOpen = 'note' in route && !!route.note;
  const tab = route.name === 'home' ? 'home' : route.name === 'notes' ? 'notes' : route.name === 'folders' ? 'folders' : route.name === 'tasks' ? 'tasks' : 'more';
  return (
    <div className="mobile">
      <div className="m-top">
        <button className="m-search" onClick={() => app.setDialog({ kind: 'search' })}><Search size={18} />Search notes and folders</button>
        <IconBtn label="Settings" icon={<SettingsIcon size={20} />} onClick={() => app.setDialog({ kind: 'settings' })} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <RouteView />
      </div>
      {!noteOpen && (route.name === 'notes' || route.name === 'home' || route.name === 'folders' || route.name === 'tasks') && (
        <button className="fab" aria-label="New note" title="New note" onClick={() => void app.newNote()}><FilePlus2 size={24} /></button>
      )}
      <nav className="bottom-nav" aria-label="Main">
        <a className={classNames(tab === 'home' && 'active')} href={href({ name: 'home' })}><HomeIcon size={22} />Home</a>
        <a className={classNames(tab === 'notes' && 'active')} href={href({ name: 'notes' })}><FileText size={22} />Notes</a>
        <a className={classNames(tab === 'folders' && 'active')} href={href({ name: 'folders' })}><FolderIcon size={22} />Folders</a>
        <a className={classNames(tab === 'tasks' && 'active')} href={href({ name: 'tasks' })}><CheckCircle2 size={22} />Tasks</a>
        <a className={classNames(tab === 'more' && 'active')} href={href({ name: 'more' })}><span style={{ position: 'relative' }}><MoreHorizontal size={22} />{app.conflicts.length > 0 && <i className="alert-badge" />}</span>More</a>
      </nav>
    </div>
  );
}

/**
 * Where a recording is controlled when nothing else on the screen shows it: a view without a note list (home, folders), a
 * phone, or a layout squeezed so far that the list is hidden to leave the note its room.
 */
function RecordingDock() {
  const r = useRecorder();
  const idle = r.phase === 'idle';
  const [covered, setCovered] = useState(true);
  useEffect(() => {
    if (idle) return;
    // closing the window would lose the part being recorded: say so first
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    // the desktop app does not run beforeunload when its window is closed: it has its own close request to answer
    let unlisten: (() => void) | undefined;
    let gone = false;
    if ('__TAURI_INTERNALS__' in window) {
      void import(/* @vite-ignore */ '@tauri-apps/api/window').then(async w => {
        const off = await w.getCurrentWindow().onCloseRequested(async e => {
          if (!confirm('A recording is running. Stop it, save what was recorded and close the app?')) { e.preventDefault(); return; }
          recorder.stop();
          // the window closes when this returns: let the save finish first (a long recording takes a moment)
          for (let i = 0; i < 600 && recorder.active; i++) await new Promise(r => setTimeout(r, 200));
        });
        if (gone) off(); else unlisten = off;
      }).catch(() => undefined);
    }
    // is the panel (or the thin bar of the list) on screen? the layout may hide the list, so it is looked at, not assumed
    const look = () => {
      const el = document.querySelector<HTMLElement>('.rec-pane, .pane-list .rec-mini');
      setCovered(!el || el.offsetParent === null);
    };
    look();
    const t = setInterval(look, 600);
    window.addEventListener('resize', look);
    return () => { gone = true; unlisten?.(); window.removeEventListener('beforeunload', warn); clearInterval(t); window.removeEventListener('resize', look); };
  }, [idle]);
  if (idle || !covered) return null;
  return <RecorderMini floating />;
}

export function Shell() {
  const app = useApp();
  const prefs = usePrefs();
  useGlobalShortcuts();
  useReminders();
  useShareIntent();
  const aside = useAsideVisible();
  const focus = prefs.focus && app.route.name === 'notes' && !!app.route.note;
  if (app.isMobile) {
    return <><MobileShell /><RightSidebar /><RecordingDock /><DialogHost /><Toasts toasts={app.toasts} /></>;
  }
  return (
    <>
      <div className={classNames('app', app.rail && 'rail', aside && !focus && 'has-aside', focus && 'focus')}>
        <Sidebar />
        <main className="main"><RouteView /></main>
        <RightSidebar />
      </div>
      <RecordingDock />
      <DialogHost />
      <Toasts toasts={app.toasts} />
    </>
  );
}
