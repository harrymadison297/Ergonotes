// Everything the Insert menu and the "/" menu can put into a note: one list, two front ends.
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import {
  AudioLines, Bell, Calendar, CalendarClock, CalendarDays, CheckCircle2, CheckSquare, Clock, Code, FilePlus2, FileText, Flag, FunctionSquare, Hash, Heading1, Heading2, Heading3,
  ImageIcon, Link2, List, ListOrdered, ListTree, Mic, MicVocal, Minus, Network, Paperclip, Pencil, Quote, Scissors, Sigma, StickyNote, Table2, ToggleLeft,
} from 'lucide-react';
import { canShareScreen } from '../record/run';

export type InsertGroup = 'Essentials' | 'Text styles' | 'Lists' | 'Media' | 'Advanced' | 'Utilities';
export const INSERT_GROUPS: InsertGroup[] = ['Essentials', 'Text styles', 'Lists', 'Media', 'Advanced', 'Utilities'];

/** What an item may ask the host (the note editor) to do: open a dialog, a file picker, the recorder. */
export interface InsertCtx {
  editor: Editor;
  pickFile(accept: string): void;
  drawing(): void;
  eventDialog(): void;
  dateDialog(): void;
  linkedNoteDialog(): void;
  /** start a link: its Markdown is put into the note to be filled in (no dialog) */
  link(): void;
  /** set an `@due(...)`, `@remind(...)` or `@flag` on the task holding the cursor (the line becomes a task first) */
  taskToken(kind: 'due' | 'remind' | 'flag'): void;
  record(kind: 'recording' | 'meeting' | 'dictate'): void;
  transcribeDialog(): void;
  /** open the contents of the note (computed from its headings) */
  contents(): void;
  /** put the cursor in the note's tag field */
  focusTags(): void;
  /** speech-to-text is set up (Settings → AI) */
  stt: boolean;
}

export interface InsertItem {
  id: string;
  group: InsertGroup;
  label: string;
  icon: ReactNode;
  /** extra words the search matches */
  keywords?: string;
  /** the Markdown shortcut, shown at the right */
  hint?: string;
  /** set when the item cannot be used right now: shown greyed with this text */
  unavailable?: (c: Pick<InsertCtx, 'stt'>) => string | null;
  /** false where the item makes no sense at all (not greyed: not listed) */
  offered?: () => boolean;
  run(c: InsertCtx): void;
}

const NEEDS_STT = (c: Pick<InsertCtx, 'stt'>) => (c.stt ? null : 'Set up speech-to-text in Settings → AI first');
const S = 16;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nowHm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const INSERT_ITEMS: InsertItem[] = [
  // Essentials
  { id: 'task', group: 'Essentials', label: 'New task', icon: <CheckCircle2 size={S} />, keywords: 'todo checklist', run: c => c.editor.chain().focus().toggleTaskList().run() },
  { id: 'event', group: 'Essentials', label: 'Event', icon: <CalendarClock size={S} />, keywords: 'calendar meeting appointment', run: c => c.eventDialog() },
  { id: 'new-note', group: 'Essentials', label: 'New linked note', icon: <FilePlus2 size={S} />, keywords: 'create note link', run: c => c.linkedNoteDialog() },
  { id: 'link-note', group: 'Essentials', label: 'Link to note', icon: <FileText size={S} />, keywords: 'wiki backlink [[', hint: '[[', run: c => c.editor.chain().focus().insertContent('[[').run() },
  { id: 'tag', group: 'Essentials', label: 'Tag', icon: <Hash size={S} />, keywords: 'hashtag label inline tag', run: c => c.focusTags() },
  { id: 'date', group: 'Essentials', label: 'Date mention', icon: <Calendar size={S} />, keywords: 'day mention', hint: '@date', run: c => c.dateDialog() },
  { id: 'link', group: 'Essentials', label: 'Link', icon: <Link2 size={S} />, keywords: 'url web address http markdown [](', hint: '[text](url)', run: c => c.link() },
  { id: 'due', group: 'Essentials', label: 'Due date', icon: <CalendarDays size={S} />, keywords: '@due deadline task by when', hint: '@due', run: c => c.taskToken('due') },
  { id: 'remind', group: 'Essentials', label: 'Reminder', icon: <Bell size={S} />, keywords: '@remind alarm notify task', hint: '@remind', run: c => c.taskToken('remind') },
  { id: 'flag', group: 'Essentials', label: 'Flag task', icon: <Flag size={S} />, keywords: '@flag important priority star task', hint: '@flag', run: c => c.taskToken('flag') },
  { id: 'toc', group: 'Essentials', label: 'Contents', icon: <ListTree size={S} />, keywords: 'table of contents outline toc headings', run: c => c.contents() },
  { id: 'table', group: 'Essentials', label: 'Table', icon: <Table2 size={S} />, run: c => c.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'divider', group: 'Essentials', label: 'Divider', icon: <Minus size={S} />, keywords: 'rule line separator', hint: '---', run: c => c.editor.chain().focus().setHorizontalRule().run() },
  { id: 'pagebreak', group: 'Essentials', label: 'Page break', icon: <Scissors size={S} />, keywords: 'print newpage', run: c => c.editor.chain().focus().insertContent({ type: 'pageBreak' }).run() },
  { id: 'quote', group: 'Essentials', label: 'Quote', icon: <Quote size={S} />, keywords: 'blockquote cite', hint: '>', run: c => c.editor.chain().focus().toggleBlockquote().run() },
  { id: 'callout', group: 'Essentials', label: 'Note', icon: <StickyNote size={S} />, keywords: 'callout box info admonition', run: c => c.editor.chain().focus().toggleBlockquote().insertContent('[!note] ').run() },
  {
    id: 'toggle', group: 'Essentials', label: 'Toggle', icon: <ToggleLeft size={S} />, keywords: 'collapse expand collapsible details fold', hint: '<details>',
    run: c => c.editor.chain().focus().insertContent({ type: 'toggle', attrs: { summary: '' }, content: [{ type: 'paragraph' }] }).run(),
  },
  // Text styles
  { id: 'h1', group: 'Text styles', label: 'Heading 1', icon: <Heading1 size={S} />, keywords: 'title large', hint: '#', run: c => c.editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', group: 'Text styles', label: 'Heading 2', icon: <Heading2 size={S} />, keywords: 'subtitle medium', hint: '##', run: c => c.editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', group: 'Text styles', label: 'Heading 3', icon: <Heading3 size={S} />, keywords: 'small', hint: '###', run: c => c.editor.chain().focus().toggleHeading({ level: 3 }).run() },
  // Lists
  { id: 'bullets', group: 'Lists', label: 'Bulleted list', icon: <List size={S} />, keywords: 'unordered', hint: '-', run: c => c.editor.chain().focus().toggleBulletList().run() },
  { id: 'checklist', group: 'Lists', label: 'Checklist', icon: <CheckSquare size={S} />, keywords: 'todo tasks', hint: '[ ]', run: c => c.editor.chain().focus().toggleTaskList().run() },
  { id: 'numbers', group: 'Lists', label: 'Numbered list', icon: <ListOrdered size={S} />, keywords: 'ordered', hint: '1.', run: c => c.editor.chain().focus().toggleOrderedList().run() },
  { id: 'checkbox', group: 'Lists', label: 'Checkbox', icon: <CheckSquare size={S} />, keywords: 'tick box inline', run: c => c.editor.chain().focus().insertContent([{ type: 'inlineCheckbox', attrs: { checked: false } }, { type: 'text', text: ' ' }]).run() },
  // Media
  { id: 'image', group: 'Media', label: 'Image', icon: <ImageIcon size={S} />, keywords: 'picture photo', run: c => c.pickFile('image/*') },
  { id: 'file', group: 'Media', label: 'File', icon: <Paperclip size={S} />, keywords: 'attachment upload pdf xlsx csv pptx', run: c => c.pickFile('') },
  { id: 'meeting', group: 'Media', label: 'Meeting', icon: <AudioLines size={S} />, keywords: 'record meeting lecture call share screen frames transcript summary minutes', offered: canShareScreen, run: c => c.record('meeting') },
  { id: 'voice', group: 'Media', label: 'Recording', icon: <Mic size={S} />, keywords: 'record audio microphone voice note transcript', run: c => c.record('recording') },
  { id: 'dictate', group: 'Media', label: 'Voice dictation', icon: <MicVocal size={S} />, keywords: 'speech to text type by voice', unavailable: NEEDS_STT, run: c => c.record('dictate') },
  { id: 'transcribe', group: 'Media', label: 'Transcribe media', icon: <FileText size={S} />, keywords: 'audio video file speech text', unavailable: NEEDS_STT, run: c => c.transcribeDialog() },
  { id: 'sketch', group: 'Media', label: 'Sketch', icon: <Pencil size={S} />, keywords: 'drawing draw excalidraw', run: c => c.drawing() },
  // Advanced
  { id: 'code', group: 'Advanced', label: 'Code block', icon: <Code size={S} />, keywords: 'snippet pre', hint: '```', run: c => c.editor.chain().focus().toggleCodeBlock().run() },
  { id: 'inline-code', group: 'Advanced', label: 'Inline code', icon: <Code size={S} />, keywords: 'monospace', hint: '`', run: c => c.editor.chain().focus().toggleCode().run() },
  { id: 'formula', group: 'Advanced', label: 'Formula', icon: <FunctionSquare size={S} />, keywords: 'math latex katex equation inline', hint: '$', run: c => c.editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: '' } }).run() },
  { id: 'formula-block', group: 'Advanced', label: 'Formula block', icon: <Sigma size={S} />, keywords: 'math latex katex equation display', hint: '$$', run: c => c.editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: '' } }).run() },
  {
    id: 'mermaid', group: 'Advanced', label: 'Mermaid diagram', icon: <Network size={S} />, keywords: 'flowchart sequence diagram graph chart', hint: '```mermaid',
    run: c => c.editor.chain().focus().insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'flowchart TD\n  A[Start] --> B{Decide}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]' }] }).run(),
  },
  // Utilities
  { id: 'now-date', group: 'Utilities', label: 'Current date', icon: <CalendarDays size={S} />, keywords: 'today', run: c => c.editor.chain().focus().insertContent(todayIso()).run() },
  { id: 'now-time', group: 'Utilities', label: 'Current time', icon: <Clock size={S} />, keywords: 'now clock', run: c => c.editor.chain().focus().insertContent(nowHm()).run() },
];

/** Case-insensitive match on the name or the extra words. */
export function matchInsert(items: InsertItem[], q: string): InsertItem[] {
  const t = q.trim().toLowerCase();
  if (!t) return items;
  const words = t.split(/\s+/);
  const rank = (i: InsertItem) => { const l = i.label.toLowerCase(); return l === t ? -1 : l.startsWith(t) ? 0 : l.includes(t) ? 1 : 2; };
  return items.filter(i => { const hay = `${i.label} ${i.keywords ?? ''} ${i.hint ?? ''}`.toLowerCase(); return words.every(w => hay.includes(w)); }).sort((a, b) => rank(a) - rank(b));
}

/** The items this device can use at all: a meeting needs a screen to share. */
export const offeredItems = (): InsertItem[] => INSERT_ITEMS.filter(i => !i.offered || i.offered());
