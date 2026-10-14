import { useEffect, useRef } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Cloud, FilePlus2, FileText, Folder as FolderIcon, Home as HomeIcon, Keyboard, LayoutTemplate,
  MoreHorizontal, Plus, Search, Settings as SettingsIcon, Tag as TagIcon, Trash2,
} from 'lucide-react';
import { useApp } from '../state/app';
import { href } from '../state/router';
import { classNames, isoDay } from '../state/util';
import { tagStyle } from '../state/tags';
import { CalendarView } from '../views/Calendar';
import { ConflictsView } from '../views/Conflicts';
import { FoldersView } from '../views/Folders';
import { Home } from '../views/Home';
import { NotesView, TrashView } from '../views/Notes';
import { TasksView } from '../views/Tasks';
import { FilePreviewDialog } from './FilePreview';
import { SearchPalette } from './SearchPalette';
import { ConflictDialog, HistoryDialog, ImportDialog, MoveDialog, NameDialog, SettingsDialog, ShortcutsDialog, TemplatesDialog } from './Dialogs';
import { Sidebar, useNewMenu } from './Sidebar';
import { IconBtn, NoteCard, Toasts } from './ui';

function RouteView() {
  const { route } = useApp();
  switch (route.name) {
    case 'home': return <Home />;
    case 'notes': return <NotesView noteId={route.note} />;
    case 'tasks': return <TasksView noteId={route.note} />;
    case 'calendar': return <CalendarView noteId={route.note} />;
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
    case 'shortcuts': return <ShortcutsDialog onClose={close} />;
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
  const app = useApp();
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.matches('input, textarea, select, [contenteditable="true"]') || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); app.setDialog(app.dialog?.kind === 'search' ? null : { kind: 'search' }); return; }
      if ((mod && e.key.toLowerCase() === 'n') || (e.altKey && e.key.toLowerCase() === 'n')) { e.preventDefault(); void app.newNote(); return; }
      if (mod && e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const d = await app.run(app.api.dailyNote(isoDay()));
        if (d) { await app.refresh(); app.go({ name: 'notes', note: d.id, folder: d.parent ?? undefined }); }
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const r = await app.run(app.api.sync());
        app.toast(r?.error ?? 'Synced', r?.error ? 'error' : 'info');
        return;
      }
      if (typing || mod || e.altKey) return;
      if (e.key === '?') { app.setDialog({ kind: 'shortcuts' }); return; }
      if (pending.current === 'g') {
        pending.current = null;
        const m: Record<string, Parameters<typeof app.go>[0]> = { h: { name: 'home' }, n: { name: 'notes' }, t: { name: 'tasks' }, c: { name: 'calendar' } };
        if (m[e.key]) app.go(m[e.key]);
        return;
      }
      if (e.key === 'g') { pending.current = 'g'; setTimeout(() => { pending.current = null; }, 900); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);
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
function useReminders() {
  const app = useApp();
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      for (const t of app.tasks) {
        if (t.done || !t.remind) continue;
        const at = Date.parse(t.remind.length <= 10 ? t.remind + 'T09:00' : t.remind);
        const key = `${t.noteId}:${t.index}:${t.remind}`;
        if (Number.isNaN(at) || at > now || now - at > 6 * 3600e3 || fired.current.has(key)) continue;
        fired.current.add(key);
        app.toast(`Reminder: ${t.text}`);
        try {
          if ('__TAURI_INTERNALS__' in window) {
            const n = await import(/* @vite-ignore */ '@tauri-apps/plugin-notification');
            if (await n.isPermissionGranted() || (await n.requestPermission()) === 'granted') n.sendNotification({ title: 'Reminder', body: t.text });
          } else if ('Notification' in window && Notification.permission === 'granted') new Notification('Reminder', { body: t.text });
        } catch { /* notifications unavailable */ }
      }
    };
    const id = setInterval(() => void tick(), 20_000);
    void tick();
    return () => clearInterval(id);
  }, [app.tasks, app]);
}

function MoreView() {
  const app = useApp();
  const rows: { icon: JSX.Element; label: string; to?: string; onClick?: () => void; badge?: number }[] = [
    { icon: <HomeIcon size={20} />, label: 'Home', to: href({ name: 'home' }) },
    { icon: <CalendarDays size={20} />, label: 'Calendar', to: href({ name: 'calendar' }) },
    { icon: <LayoutTemplate size={20} />, label: 'New from template', onClick: () => app.setDialog({ kind: 'templates' }) },
    { icon: <AlertTriangle size={20} />, label: 'Conflicts', to: href({ name: 'conflicts' }), badge: app.conflicts.length },
    { icon: <Trash2 size={20} />, label: 'Trash', to: href({ name: 'trash' }) },
    { icon: <Cloud size={20} />, label: 'Sync now', onClick: async () => { const r = await app.run(app.api.sync()); app.toast(r?.error ?? 'Synced', r?.error ? 'error' : 'info'); } },
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
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-2)' }}><TagIcon size={14} /> Tags</h3>
          <div className="tag-cloud">{app.tags.map(t => <a key={t.tag} href={href({ name: 'notes', tag: t.tag })} style={tagStyle(t.tag)}><i className="tag-dot" />{t.tag}<small>{t.count}</small></a>)}</div>
        </div>
      )}
    </div>
  );
}

function MobileShell() {
  const app = useApp();
  const { route } = app;
  const newMenu = useNewMenu();
  const noteOpen = 'note' in route && !!route.note;
  const tab = route.name === 'notes' || route.name === 'home' ? 'notes' : route.name === 'folders' ? 'folders' : route.name === 'tasks' ? 'tasks' : 'more';
  return (
    <div className="mobile">
      <div className="m-top">
        <button className="m-search" onClick={() => app.setDialog({ kind: 'search' })} aria-label="Search"><Search size={18} />Search notes and folders</button>
        <IconBtn label="Settings" icon={<SettingsIcon size={20} />} onClick={() => app.setDialog({ kind: 'settings' })} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {route.name === 'home' ? <MobileHome /> : <RouteView />}
      </div>
      {!noteOpen && (route.name === 'notes' || route.name === 'home' || route.name === 'folders' || route.name === 'tasks') && (
        <button className="fab" aria-label="New note" title="New note" onClick={() => void app.newNote()}><FilePlus2 size={24} /></button>
      )}
      <nav className="bottom-nav" aria-label="Main">
        <button onClick={e => newMenu.open(e)}><Plus size={22} />Create</button>
        <a className={classNames(tab === 'notes' && 'active')} href={href({ name: 'notes' })}><FileText size={22} />Notes</a>
        <a className={classNames(tab === 'folders' && 'active')} href={href({ name: 'folders' })}><FolderIcon size={22} />Folders</a>
        <a className={classNames(tab === 'tasks' && 'active')} href={href({ name: 'tasks' })}><CheckCircle2 size={22} />Tasks</a>
        <a className={classNames(tab === 'more' && 'active')} href={href({ name: 'more' })}><span style={{ position: 'relative' }}><MoreHorizontal size={22} />{app.conflicts.length > 0 && <i style={{ position: 'absolute', top: -2, right: -4, width: 8, height: 8, borderRadius: 4, background: 'var(--danger)' }} />}</span>More</a>
      </nav>
      {newMenu.node}
    </div>
  );
}

function MobileHome() {
  // on a phone the home screen is the notes grid, like the reference app
  const app = useApp();
  const notes = app.items.filter(i => i.type === 'note' && !i.inTrash && !i.template).sort((a, b) => b.updated.localeCompare(a.updated));
  return <div className="m-content">
    <div style={{ padding: '4px 16px', color: 'var(--text-2)', fontSize: 12.5 }}>{notes.length} notes</div>
    <div className="m-cards">
      {notes.map(n => <NoteCard key={n.id} n={n} href={href({ name: 'notes', note: n.id, folder: n.parent ?? undefined })} />)}
    </div>
  </div>;
}

export function Shell() {
  const app = useApp();
  useGlobalShortcuts();
  useReminders();
  useShareIntent();
  if (app.isMobile) {
    return <><MobileShell /><DialogHost /><Toasts toasts={app.toasts} /></>;
  }
  return (
    <>
      <div className={classNames('app', app.rail && 'rail')}>
        <Sidebar />
        <main className="main"><RouteView /></main>
      </div>
      <DialogHost />
      <Toasts toasts={app.toasts} />
    </>
  );
}
