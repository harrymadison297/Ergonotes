// The Commands of the app: one list that the search palette runs, the keyboard runs, and Settings → Keyboard rebinds.
import type { ReactNode } from 'react';
import {
  AlignHorizontalSpaceAround, CalendarDays, Clipboard, Copy, FilePlus2, FileText, Folder, Home, Keyboard, ListChecks, PanelLeft, PanelRight, Paperclip, RefreshCw,
  Scissors, Search, Settings as SettingsIcon, ZoomIn, ZoomOut, Maximize2, Trash2, CalendarCheck, X, RotateCcw, Repeat,
} from 'lucide-react';
import { usePrefs, setPrefs, ZOOM_STEP, clampZoom, type Prefs } from './prefs';
import { useApp, type AppCtx } from './app';
import { formatBinding, normalizeBinding, type Bound } from './keymap';
import { commandForChord } from './shortcuts';
import { closeTab, neighbourTab, reopenTab, tabsState } from './tabs';
import { useSync } from '../components/useSync';

export type CommandGroup = 'General' | 'Navigate' | 'View' | 'Items';

export interface CommandCtx { app: AppCtx; sync: () => unknown; prefs: Prefs }

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** extra words the palette matches */
  keywords?: string;
  icon?: ReactNode;
  /** the keys it has until the person changes them (a binding is `Mod+K`, or two chords: `g h`) */
  keys: string[];
  /** acts on what is picked in a list (the Explorer), not on the whole app: rebindable, not run by the palette or a global key */
  scoped?: boolean;
  run(c: CommandCtx): void | Promise<void>;
}

const S = 16;
const nav = (id: string, title: string, icon: ReactNode, route: Parameters<AppCtx['go']>[0], keys: string[] = []): Command =>
  ({ id: `go.${id}`, title: `Go to ${title}`, group: 'Navigate', icon, keys, keywords: `open show ${title}`, run: c => c.app.go(route) });

export const COMMANDS: Command[] = [
  { id: 'search.open', title: 'Search', group: 'General', icon: <Search size={S} />, keys: ['Mod+k'], keywords: 'find notes tasks tags commands', run: c => c.app.setDialog(c.app.dialog?.kind === 'search' ? null : { kind: 'search' }) },
  { id: 'note.new', title: 'New note', group: 'General', icon: <FilePlus2 size={S} />, keys: ['Mod+n', 'Alt+n'], keywords: 'create write', run: c => void c.app.newNote() },
  { id: 'daily.open', title: 'Open today’s note', group: 'General', icon: <CalendarCheck size={S} />, keys: ['Mod+Alt+d'], keywords: 'daily journal', run: c => void c.app.openDaily() },
  { id: 'sync.now', title: 'Sync now', group: 'General', icon: <RefreshCw size={S} />, keys: ['Mod+Shift+s'], keywords: 'store devices', run: c => void c.sync() },
  { id: 'settings.open', title: 'Open Settings', group: 'General', icon: <SettingsIcon size={S} />, keys: ['Mod+,'], keywords: 'preferences options', run: c => c.app.setDialog({ kind: 'settings' }) },
  { id: 'keyboard.open', title: 'Keyboard shortcuts', group: 'General', icon: <Keyboard size={S} />, keys: ['Shift+/'], keywords: 'keys bindings customize help', run: c => c.app.setDialog({ kind: 'shortcuts' }) },

  nav('home', 'Home', <Home size={S} />, { name: 'home' }, ['g h']),
  nav('notes', 'Notes', <FileText size={S} />, { name: 'notes' }, ['g n']),
  nav('tasks', 'Tasks', <ListChecks size={S} />, { name: 'tasks' }, ['g t']),
  nav('habits', 'Habits', <Repeat size={S} />, { name: 'habits' }, ['g b']),
  nav('calendar', 'Calendar', <CalendarDays size={S} />, { name: 'calendar' }, ['g c']),
  nav('files', 'Files', <Paperclip size={S} />, { name: 'files' }, ['g f']),
  nav('folders', 'Folders', <Folder size={S} />, { name: 'folders' }),
  nav('trash', 'Trash', <Trash2 size={S} />, { name: 'trash' }),

  // Ctrl+W, Ctrl+Shift+T and Ctrl+Tab belong to the browser in a web page, so the web build also has the Alt ones
  { id: 'tab.close', title: 'Close the tab', group: 'Navigate', icon: <X size={S} />, keys: ['Mod+w', 'Alt+w'], keywords: 'tab close note', run: () => { const t = tabsState().active; const h = t ? closeTab(t) : null; if (h) location.hash = h; } },
  { id: 'tab.reopen', title: 'Reopen the closed tab', group: 'Navigate', icon: <RotateCcw size={S} />, keys: ['Mod+Shift+t', 'Alt+Shift+t'], keywords: 'tab undo close restore', run: () => { const h = reopenTab(); if (h) location.hash = h; } },
  { id: 'tab.next', title: 'Next tab', group: 'Navigate', keys: ['Mod+Tab', 'Alt+]'], keywords: 'tab switch', run: () => { const h = neighbourTab(1); if (h) location.hash = h; } },
  { id: 'tab.prev', title: 'Previous tab', group: 'Navigate', keys: ['Mod+Shift+Tab', 'Alt+['], keywords: 'tab switch', run: () => { const h = neighbourTab(-1); if (h) location.hash = h; } },

  { id: 'view.sidebar', title: 'Show or hide the sidebar', group: 'View', icon: <PanelLeft size={S} />, keys: ['Mod+\\'], keywords: 'toggle navigation rail left', run: c => c.app.toggleRail() },
  { id: 'view.aside', title: 'Show or hide the right sidebar', group: 'View', icon: <PanelRight size={S} />, keys: ['Mod+Shift+\\'], keywords: 'toggle contents assistant', run: c => setPrefs({ aside: !c.prefs.aside }) },
  { id: 'view.list', title: 'Show or hide the note list', group: 'View', icon: <AlignHorizontalSpaceAround size={S} />, keys: [], keywords: 'toggle', run: c => setPrefs({ listHidden: !c.prefs.listHidden }) },
  { id: 'view.focus', title: 'Focus on the note', group: 'View', icon: <Maximize2 size={S} />, keys: ['Mod+Shift+f'], keywords: 'distraction free zen full screen', run: c => setPrefs({ focus: !c.prefs.focus }) },
  { id: 'zoom.in', title: 'Larger text in notes', group: 'View', icon: <ZoomIn size={S} />, keys: ['Mod+=', 'Mod+Shift+='], keywords: 'zoom font size bigger', run: c => setPrefs({ textZoom: clampZoom(c.prefs.textZoom + ZOOM_STEP) }) },
  { id: 'zoom.out', title: 'Smaller text in notes', group: 'View', icon: <ZoomOut size={S} />, keys: ['Mod+-'], keywords: 'zoom font size smaller', run: c => setPrefs({ textZoom: clampZoom(c.prefs.textZoom - ZOOM_STEP) }) },
  { id: 'zoom.reset', title: 'Normal text size in notes', group: 'View', icon: <ZoomIn size={S} />, keys: ['Mod+0'], keywords: 'zoom font size reset 100', run: () => setPrefs({ textZoom: 100 }) },

  { id: 'item.copy', title: 'Copy the picked notes and folders', group: 'Items', icon: <Copy size={S} />, keys: ['Mod+c'], scoped: true, run: () => undefined },
  { id: 'item.cut', title: 'Cut the picked notes and folders', group: 'Items', icon: <Scissors size={S} />, keys: ['Mod+x'], scoped: true, run: () => undefined },
  { id: 'item.paste', title: 'Paste notes and folders', group: 'Items', icon: <Clipboard size={S} />, keys: ['Mod+v'], scoped: true, run: () => undefined },
  { id: 'item.selectAll', title: 'Pick everything in the folder', group: 'Items', keys: ['Mod+a'], scoped: true, run: () => undefined },
  { id: 'item.rename', title: 'Rename the picked note or folder', group: 'Items', keys: ['F2'], scoped: true, run: () => undefined },
  { id: 'item.delete', title: 'Move the picked notes and folders to the Trash', group: 'Items', keys: ['Delete'], scoped: true, run: () => undefined },
];

export const commandById = (id: string): Command | undefined => COMMANDS.find(c => c.id === id);

/** The keys a command has now: the person's own, else the ones it came with. An empty list means they took them off. */
export function keysFor(cmd: Command, overrides: Record<string, string[]>): string[] {
  const own = overrides[cmd.id];
  return (own ?? cmd.keys).map(normalizeBinding);
}

/** Every command with the keys it has now. */
export function boundCommands(overrides: Record<string, string[]>): Bound[] {
  return COMMANDS.map(c => ({ id: c.id, keys: keysFor(c, overrides) }));
}

/** Only the commands that act on the whole app (`scoped: false`), or only those that act on what is picked in a list. */
export const boundGlobal = (overrides: Record<string, string[]>): Bound[] => COMMANDS.filter(c => !c.scoped).map(c => ({ id: c.id, keys: keysFor(c, overrides) }));
export const boundScoped = (overrides: Record<string, string[]>): Bound[] => COMMANDS.filter(c => c.scoped).map(c => ({ id: c.id, keys: keysFor(c, overrides) }));

/** Run a command for the keyboard or the palette. */
export function useCommands() {
  const app = useApp();
  const sync = useSync();
  const prefs = usePrefs();
  return {
    prefs,
    keys: (id: string): string[] => { const c = commandById(id); return c ? keysFor(c, prefs.keys) : []; },
    /** The keys of a command as a person reads them (`Ctrl+C`), or undefined when it has none: for hints in menus. */
    hint: (id: string): string | undefined => { const k = commandById(id); const first = k ? keysFor(k, prefs.keys)[0] : undefined; return first ? formatBinding(first) : undefined; },
    /** Which list command (copy, cut, paste, rename, delete, select all) a key press is, if any. */
    scoped: (chord: string | null): string | null => commandForChord(chord, boundScoped(prefs.keys)),
    run: (id: string) => { const c = commandById(id); if (c && !c.scoped) void c.run({ app, sync: sync.run, prefs }); },
  };
}
