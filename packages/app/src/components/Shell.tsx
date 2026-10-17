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
import { HabitsView } from '../views/Habits';
import { NotesView, TrashView } from '../views/Notes';
import { TasksView } from '../views/Tasks';
import { FilePreviewDialog } from './FilePreview';
import { ExternalView } from '../views/External';
import { SearchPalette } from './SearchPalette';
import { ConflictDialog, HistoryDialog, ImportDialog, MoveDialog, NameDialog, SettingsDialog, TemplatesDialog } from './Dialogs';
import { Sidebar } from './Sidebar';
import { RightSidebar, useAsideVisible } from './RightSidebar';
import { IconBtn, TagLink, Toasts } from './ui';
import { CurveLoader } from './CurveLoader';
import { TabBar, useTabsFollowRoute } from './TabBar';
import { openInNewTabNext, tabFor } from '../state/tabs';
import { parseHash } from '../state/router';
import { canOpenExternal, onOpenWith, openWithTake } from '../backend/external';
import { vaultRelative } from '../state/externalApi';
import { nudgeDismissed, nudgeId, topNudge } from '../state/habits';
import { useSync } from './useSync';
import { RecorderMini } from './RecorderPanel';
import { recorder, useRecorder } from '../record/recorder';
import { setPrefs, usePrefs } from '../state/prefs';
import { boundGlobal, useCommands } from '../state/commands';
import { chordOf } from '../state/keymap';
import { ShortcutMatcher } from '../state/shortcuts';

function RouteView() {
  const { route } = useApp();
  switch (route.name) {
    case 'external': return <ExternalView path={route.path} />;
    case 'home': return <Home />;
    case 'notes': return <NotesView noteId={route.note} />;
    case 'habits': return <HabitsView />;
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
  const matcher = useRef(new ShortcutMatcher());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const chord = chordOf(e);
      if (!chord) return;
      const el = e.target as HTMLElement;
      const typing = el.matches('input, textarea, select, [contenteditable="true"]') || el.isContentEditable;
      const id = matcher.current.press(chord, typing, boundGlobal(latest.current.prefs.keys), Date.now());
      if (id) { e.preventDefault(); latest.current.run(id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Esc leaves the note-only view, unless something on top of it (a menu, a dialog, a suggestion list) wants the key. */
function useLeaveFocusOnEscape(focus: boolean) {
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('.menu, [role="menu"], [role="dialog"], .scrim, .palette-scrim, .ghost-text')) return;
      setPrefs({ focus: false });
    };
    // first in line: whatever Esc closes is still on screen now, and is gone by the time the bubbling listeners are done
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [focus]);
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
      // a list that is hidden, or has narrowed to nothing while it closes, shows nothing of the recording
      setCovered(!el || el.offsetParent === null || getComputedStyle(el).visibility === 'hidden' || el.getBoundingClientRect().width < 60);
    };
    look();
    const t = setInterval(look, 600);
    window.addEventListener('resize', look);
    return () => { gone = true; unlisten?.(); window.removeEventListener('beforeunload', warn); clearInterval(t); window.removeEventListener('resize', look); };
  }, [idle]);
  if (idle || !covered) return null;
  return <RecorderMini floating />;
}

/** While the vault folder is first read after opening: the app is already usable, this says why the lists are still filling. */
function ScanPill() {
  const { status } = useApp();
  const scan = status.scan;
  if (!scan) return null;
  return (
    <div className="scan-pill" role="status" aria-live="polite">
      <CurveLoader size={28} label="Reading your notes" />
      <span>{scan.total > 0 ? `Reading your notes · ${scan.done.toLocaleString('en')} of ${scan.total.toLocaleString('en')} files` : 'Reading your notes…'}</span>
    </div>
  );
}

/** Files the system opens with this app ("Open with Ergonotes", a double click): each becomes a tab. */
function useOpenWith() {
  const app = useApp();
  const latest = useRef(app);
  latest.current = app;
  useEffect(() => {
    if (!canOpenExternal()) return;
    let off: (() => void) | undefined;
    let live = true;
    const take = async () => {
      const paths = await openWithTake().catch(() => [] as string[]);
      // the lists may still be arriving when the app was started by a double click
      for (let i = 0; i < 30 && paths.length && latest.current.items.length === 0; i++) await new Promise(r => setTimeout(r, 100));
      for (const path of paths) {
        const a = latest.current;
        const rel = a.folder ? vaultRelative(path, a.folder.path) : null;
        const note = rel ? a.items.find(it => it.type === 'note' && it.filePath.toLowerCase() === rel.toLowerCase()) : undefined;
        openInNewTabNext();
        // a file of the vault folder is the note it is; anything else is opened where it is, without touching it
        if (note) a.go({ name: 'notes', note: note.id, folder: note.parent ?? undefined });
        else a.go({ name: 'external', path });
      }
    };
    void take();
    void onOpenWith(() => void take()).then(f => { if (live) off = f; else f(); });
    return () => { live = false; off?.(); };
  }, []);
}

/** When the app opens: one toast about the Habit whose message matters most (ADR 0013), unless it was put away for today. */
function useHabitToast() {
  const app = useApp();
  const said = useRef(false);
  useEffect(() => {
    if (said.current || app.items.length === 0) return;
    said.current = true;
    const top = topNudge(app.habits.filter(h => !nudgeDismissed(app.today, nudgeId(h, h.nudge ?? { key: '', tone: 'good', text: '' }))));
    if (top) app.toast(`${top.habit.title}: ${top.nudge.text}`, 'info', { label: 'Open', run: () => app.go({ name: 'habits', habit: top.habit.id }) });
  }, [app.items.length, app.habits]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Ctrl+click and middle click on a link to a note open it in a new tab. */
function useNewTabClicks() {
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
      if (!a || a.closest('.tabbar')) return;
      const fresh = e.type === 'auxclick' ? e.button === 1 : e.button === 0 && (e.ctrlKey || e.metaKey);
      if (!fresh) return;
      const h = a.getAttribute('href')!;
      if (!tabFor(parseHash(h))) return;
      e.preventDefault();
      openInNewTabNext();
      location.hash = h;
    };
    document.addEventListener('click', on, true);
    document.addEventListener('auxclick', on, true);
    return () => { document.removeEventListener('click', on, true); document.removeEventListener('auxclick', on, true); };
  }, []);
}

export function Shell() {
  const app = useApp();
  const prefs = usePrefs();
  useGlobalShortcuts();
  useTabsFollowRoute();
  useNewTabClicks();
  useHabitToast();
  useOpenWith();
  useReminders();
  useShareIntent();
  const aside = useAsideVisible();
  const focus = prefs.focus && app.route.name === 'notes' && !!app.route.note;
  useLeaveFocusOnEscape(focus);
  if (app.isMobile) {
    return <><MobileShell /><RightSidebar /><RecordingDock /><DialogHost /><ScanPill /><Toasts toasts={app.toasts} /></>;
  }
  return (
    <>
      <div className={classNames('app', app.rail && 'rail', aside && !focus && 'has-aside', focus && 'focus')}>
        <Sidebar />
        <main className="main"><TabBar /><div className="main-body"><RouteView /></div></main>
        <RightSidebar />
      </div>
      <RecordingDock />
      <DialogHost />
      <ScanPill />
      <Toasts toasts={app.toasts} />
    </>
  );
}
