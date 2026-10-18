import type { LucideIcon } from 'lucide-react';
import {
  Bot, CalendarDays, CheckCircle2, FileDown, FileText, FolderOpen, GitBranch, Home as HomeIcon, Lock, Mic, Network, Repeat2, Shapes, Sparkles, SquareCheckBig, Terminal, Wifi,
  Apple, Download, Monitor, Package, Server, Smartphone, Usb,
} from 'lucide-react';

export type Tone = 'green' | 'indigo' | 'purple' | 'orange' | 'pink';

export interface Feature { icon: LucideIcon; title: string; text: string; tone: Tone; tag?: string; size?: 'wide' | 'big' | 'full' }

export const FEATURES: Feature[] = [
  { icon: FolderOpen, size: 'big', tone: 'green', title: 'Plain Markdown files in a folder', text: 'Your vault is a folder. Every note is a .md file you can open with any other editor, and uninstalling the app never takes a note with it.', tag: 'Like an Obsidian vault' },
  { icon: Wifi, tone: 'indigo', title: 'Offline first', text: 'Everything works with no connection. Sync is optional and catches up when you are back.' },
  { icon: HomeIcon, size: 'wide', tone: 'orange', title: 'A Home you arrange', text: '18 widgets: tasks due, habits, events, pinned notes, a scratch pad and charts. Arranged per device, never synced.', tag: 'Drag, resize, make it yours' },
  { icon: Repeat2, size: 'wide', tone: 'green', title: 'Habits that record only what you did', text: 'Streaks, misses, 7, 30 and 90 day rates and a heat map are worked out, never stored. A hand-drawn face cheers you on, quietly.', tag: 'Run · Water · Read · Journal' },
  { icon: Lock, tone: 'purple', title: 'End-to-end encrypted sync', text: 'Sync through an S3 bucket, a WebDAV share or a plain folder. Notes are sealed on your device before they leave it.' },
  { icon: SquareCheckBig, tone: 'purple', title: 'Tasks and reminders', text: 'Any checkbox in any note is a task. Add @due and @remind and it shows up on Home, in Tasks and on the Calendar.' },
  { icon: CalendarDays, tone: 'orange', title: 'Calendar', text: 'Each day shows tasks done and open, reminders, notes and events at a glance.' },
  { icon: Mic, size: 'wide', tone: 'indigo', title: 'Meetings and recordings', text: 'Keep the audio of a call, pictures of the shared screen and a transcript in one folder, played back with the pictures marked on the timeline.', tag: 'Desktop and Android' },
  { icon: Bot, size: 'wide', tone: 'green', title: 'An assistant that respects privacy', text: 'Optional chat that answers, writes, edits and draws in your notes. Bring your own OpenRouter or Anthropic key. Off until you add one, and notes marked private are never sent.', tag: 'Your key, your model' },
  { icon: Shapes, tone: 'pink', title: 'Insert almost anything', text: 'Toggles, Mermaid diagrams, formulas, Excalidraw sketches, tables, dates and events. All stored as standard Markdown.' },
  { icon: FileDown, tone: 'orange', title: 'Export anywhere', text: 'Markdown, HTML, PDF and Word (.docx), made right in the app.' },
  { icon: Network, tone: 'indigo', title: 'MCP for AI agents', text: 'The optional server peer speaks MCP over HTTP, with revocable tokens, so agents can read and write your notes.' },
  { icon: Terminal, size: 'full', tone: 'purple', title: 'VS Code extension', text: 'Read and edit the same files in VS Code, with syntax, preview, links, snippets and habit check-ins.' },
];

export interface Slide { id: string; icon: LucideIcon; tone: Tone; title: string; text: string; light: string; dark?: string }
export const SLIDES: Slide[] = [
  { id: 'home', icon: HomeIcon, tone: 'orange', title: 'Home, as a dashboard', text: 'What is due, what you still want to do today, what is coming up and what you were working on, all in widgets you place yourself.', light: 'home-light', dark: 'home-dark' },
  { id: 'habits', icon: Repeat2, tone: 'green', title: 'Habits without the guilt', text: 'Check in when you do it. Streaks, misses and rates are worked out for you, and the messages are fixed sentences, not nagging.', light: 'habit-run' },
  { id: 'notes', icon: FileText, tone: 'indigo', title: 'A fast, calm editor', text: 'Headings, tasks, diagrams and tables, with a table of contents and an assistant beside the note when you want one.', light: 'assistant', dark: 'note-dark' },
  { id: 'calendar', icon: CalendarDays, tone: 'purple', title: 'Calendar and tasks together', text: 'Every task with a date and every event you wrote in a note appear here, with no second place to keep them.', light: 'calendar' },
  { id: 'tasks', icon: CheckCircle2, tone: 'pink', title: 'Tasks from anywhere', text: 'A checkbox in a meeting note and a checkbox in a recipe land in the same list, with their reminders.', light: 'tasks' },
];

export interface Dl { icon: LucideIcon; tone: Tone; title: string; sub: string; file?: string; os?: 'windows' | 'linux' | 'android' }
export const DOWNLOADS: Dl[] = [
  { icon: Monitor, tone: 'indigo', title: 'Windows installer', sub: 'Windows 10 and 11 · x64 · .exe', file: 'Ergonotes-windows-x64-setup.exe', os: 'windows' },
  { icon: Usb, tone: 'indigo', title: 'Windows portable', sub: 'No install, run from any folder · .zip', file: 'Ergonotes-windows-x64-portable.zip' },
  { icon: Package, tone: 'orange', title: 'Linux .deb', sub: 'Debian, Ubuntu and friends · amd64', file: 'Ergonotes-linux-amd64.deb', os: 'linux' },
  { icon: Package, tone: 'orange', title: 'Linux AppImage', sub: 'Portable, runs on most distros · x86_64', file: 'Ergonotes-linux-x86_64.AppImage' },
  { icon: Smartphone, tone: 'green', title: 'Android', sub: 'Android 7+ · signed .apk', file: 'Ergonotes-android.apk', os: 'android' },
  { icon: Server, tone: 'purple', title: 'Server peer', sub: 'Web UI and MCP for your own Linux box · .tgz', file: 'ergonotes-server.tgz' },
  { icon: Terminal, tone: 'pink', title: 'VS Code extension', sub: 'Read and edit your vault in VS Code · .vsix', file: 'ergonotes-vscode.vsix' },
  { icon: Apple, tone: 'pink', title: 'macOS', sub: 'Coming soon' },
];

export const STRIP = [
  [FileText, 'Plain Markdown'], [Lock, 'Encrypted sync'], [Wifi, 'Works offline'], [GitBranch, 'Open source · Apache-2.0'], [Network, 'MCP for agents'], [Terminal, 'VS Code extension'], [Sparkles, 'Optional AI'], [Download, 'No account, no sign-up'],
] as const;
