import type { LucideIcon } from 'lucide-react';
import {
  Bot, CalendarDays, CheckCircle2, FileDown, FileText, FolderOpen, GitBranch, Home as HomeIcon, Lock, Mic, Network, Repeat2, Shapes, Sparkles, SquareCheckBig, Terminal, Wifi,
  Apple, Download, Monitor, Package, Server, Smartphone, Usb,
} from 'lucide-react';

export type Tone = 'green' | 'indigo' | 'purple' | 'orange' | 'pink';

export interface Story {
  id: string; kicker: string; icon: LucideIcon; tone: Tone;
  /** `*accent*` words get the gradient */
  headline: string; text: string; chips: string[];
  /** the words that orbit the visual */
  words: string[];
}

export const STORY: Story[] = [
  { id: 'write', kicker: 'Write', icon: FileText, tone: 'green', headline: 'Notion-style writing, *plain Markdown* underneath', text: 'Type / for headings, toggles, tasks, tables, diagrams and formulas. Every block is saved as standard Markdown you can open anywhere.', chips: ['Slash menu', '.md files', 'Mermaid · KaTeX'], words: ['# heading', '/toggle', '- [ ] task', '[[link]]', '$E=mc^2$', 'mermaid', '@due(fri)', '| table |', '**bold**', '> quote'] },
  { id: 'record', kicker: 'Record', icon: Mic, tone: 'pink', headline: 'Record the meeting, *keep the whole story*', text: 'Audio, pictures of the shared screen and a transcript, kept in one folder and played back with the pictures marked on the timeline.', chips: ['Speech to text', 'Screen frames', 'Desktop and Android'], words: ['audio', 'transcript', '[12:04]', 'screen frames', 'timeline', 'speakers', 'search it', 'replay', '00:42:17', 'summary'] },
  { id: 'assist', kicker: 'Assist', icon: Sparkles, tone: 'indigo', headline: 'An AI that *writes with you*', text: 'Grey next-word suggestions as you type. A chat that answers, edits and draws in your notes, and shows every change before you accept it.', chips: ['Suggestions', 'Chat that edits', 'Private notes never sent'], words: ['suggest', 'Tab to accept', 'rewrite', 'summarise', 'draw a diagram', 'review changes', 'ask anything', 'your key', 'private stays private', 'thinking'] },
  { id: 'connect', kicker: 'Connect', icon: Network, tone: 'purple', headline: 'Configure it yourself: *any model, MCP and skills*', text: 'Bring OpenRouter, Anthropic or a local server. The desktop app serves MCP on your own computer, and a Claude Code plugin teaches agents to write, tag, plan and draw in your notes.', chips: ['OpenRouter · Anthropic · local', 'MCP in the desktop app', 'Claude Code plugin'], words: ['MCP', 'SKILL.md', 'Claude Code', 'OpenRouter', 'Anthropic', 'Ollama', 'bearer token', 'revoke', 'tools', 'agents'] },
  { id: 'track', kicker: 'Track', icon: Repeat2, tone: 'orange', headline: 'Habits that *never nag*', text: 'Check in when you do it. Streaks, misses and the 7, 30 and 90 day rates are worked out, never stored, with a hand-drawn face and a quiet word.', chips: ['Streaks', '12 week heat map', 'Mention with @'], words: ['Run', 'Drink water', 'Read 20 pages', 'Journal', 'streak', '3 in 7 days', 'heat map', 'check in', 'fresh start', '86%'] },
  { id: 'para', kicker: 'Organise', icon: FolderOpen, tone: 'green', headline: '*PARA* is ready on day one', text: 'Projects, Areas, Resources, Archive and an Inbox to triage. Link notes with [[ ]], follow the backlinks and let tags do the rest.', chips: ['Inbox first', 'Backlinks', 'Real folders'], words: ['Projects', 'Areas', 'Resources', 'Archive', 'Inbox', '[[backlink]]', '#tags', 'pinned', 'triage', 'Zettelkasten'] },
  { id: 'code', kicker: 'For coders', icon: Terminal, tone: 'indigo', headline: 'It lives in *VS Code* too', text: 'The same vault in your editor: syntax, a live preview, links, snippets and habit check-ins. It is just files, so Git works.', chips: ['Extension (.vsix)', 'Preview and links', 'Git friendly'], words: ['syntax', 'preview', 'snippets', 'Ctrl+Click', 'git diff', 'frontmatter', '.habits/', 'extension', 'commit', 'markdownlint'] },
];

export const ALSO = ['Tasks and reminders', 'Calendar', 'A Home you arrange', 'Excalidraw sketches', 'Export to PDF, Word, HTML', 'Tabs and Open with', 'End-to-end encrypted sync', 'Works offline'];

export interface Slide { id: string; icon: LucideIcon; tone: Tone; title: string; text: string; light: string; dark?: string }
export const SLIDES: Slide[] = [
  { id: 'home', icon: HomeIcon, tone: 'orange', title: 'Home, as a dashboard', text: 'What is due, what you still want to do today, what is coming up and what you were working on, all in widgets you place yourself.', light: 'home-light', dark: 'home-dark' },
  { id: 'habits', icon: Repeat2, tone: 'green', title: 'Habits without the guilt', text: 'Check in when you do it. Streaks, misses and rates are worked out for you, and the messages are fixed sentences, not nagging.', light: 'habit-run' },
  { id: 'notes', icon: FileText, tone: 'indigo', title: 'A fast, calm editor', text: 'Headings, tasks, diagrams and tables, with a table of contents and an assistant beside the note when you want one.', light: 'assistant', dark: 'note-dark' },
  { id: 'calendar', icon: CalendarDays, tone: 'purple', title: 'Calendar and tasks together', text: 'Every task with a date and every event you wrote in a note appear here, with no second place to keep them.', light: 'calendar' },
  { id: 'tasks', icon: CheckCircle2, tone: 'pink', title: 'Tasks from anywhere', text: 'A checkbox in a meeting note and a checkbox in a recipe land in the same list, with their reminders.', light: 'tasks' },
];

export interface Dl { icon: LucideIcon; tone: Tone; title: string; sub: string; file?: string }
export const DOWNLOADS: Dl[] = [
  { icon: Monitor, tone: 'indigo', title: 'Windows installer', sub: 'Windows 10 and 11 · x64 · .exe', file: 'Ergonotes-windows-x64-setup.exe' },
  { icon: Usb, tone: 'indigo', title: 'Windows portable', sub: 'No install, run from any folder · .zip', file: 'Ergonotes-windows-x64-portable.zip' },
  { icon: Package, tone: 'orange', title: 'Linux .deb', sub: 'Debian, Ubuntu and friends · amd64', file: 'Ergonotes-linux-amd64.deb' },
  { icon: Package, tone: 'orange', title: 'Linux AppImage', sub: 'Portable, runs on most distros · x86_64', file: 'Ergonotes-linux-x86_64.AppImage' },
  { icon: Smartphone, tone: 'green', title: 'Android', sub: 'Android 7+ · signed .apk', file: 'Ergonotes-android.apk' },
  { icon: Server, tone: 'purple', title: 'Server peer', sub: 'Web UI and MCP for your own Linux box · .tgz', file: 'ergonotes-server.tgz' },
  { icon: Terminal, tone: 'pink', title: 'VS Code extension', sub: 'Read and edit your vault in VS Code · .vsix', file: 'ergonotes-vscode.vsix' },
  { icon: Apple, tone: 'pink', title: 'macOS', sub: 'Coming soon' },
];

export const STRIP = [
  [FileText, 'Plain Markdown'], [Lock, 'Encrypted sync'], [Wifi, 'Works offline'], [GitBranch, 'Open source · Apache-2.0'], [Network, 'MCP for agents'], [Terminal, 'VS Code extension'], [Sparkles, 'Optional AI'], [Download, 'No account, no sign-up'],
] as const;
