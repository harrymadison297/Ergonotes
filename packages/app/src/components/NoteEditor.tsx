import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import ListItem from '@tiptap/extension-list-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { Markdown } from 'tiptap-markdown';
import {
  ArrowLeft, Bell, Bold, CalendarDays, CheckSquare, ChevronDown, Code, Download, FileText, Flag, Folder as FolderIcon, GitMerge, History as HistoryIcon, Italic,
  ChevronsLeft, ChevronsRight, ZoomIn, ZoomOut, EyeOff, Maximize2, Minimize2, MoveHorizontal, AlignCenter, AudioLines, Mic, Sparkles, Link2, List, ListOrdered, MoreHorizontal, Paperclip, Pencil, Pin, PinOff, Plus, Quote, Redo2, RotateCcw, Share2, Strikethrough, Table2, Tag, Trash2, Undo2, Loader2, Send, Image as ImageIcon, Minus, LayoutTemplate, TableOfContents,
} from 'lucide-react';
import { mergeText, preserveBlocks, recordLinkMarkdown, toB64, type NoteDoc } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, debounce, download, isoDay } from '../state/util';
import { currentTaskTokens, ExcalidrawBlock, GhostText, InlineDecorations, LinkSuggest, MarkdownBulletList, MentionSuggest, MarkdownTaskList, setTaskToken, SingleParagraphCell, SingleParagraphHeader, SlashCommands, slashItems, StoredImage, TableKeys, TrailingParagraph } from '../editor/extensions';
import { RawBlock, RawInline, Wikilink } from '../editor/raw';
import { AudioClip, CodeWithDiagrams, DateMention, InlineCheckbox, MathBlock, MathInline, PageBreak, Toggle } from '../editor/blocks';
import { linkTo, setNoteDir, vaultPathsOf } from '../state/noteCtx';
import { habitChip } from '../state/habits';
import { HabitPanel } from './Habit';
import { RecordBlock } from '../editor/recordBlock';
import { setNotePrivate } from '../record/host';
import { RecordDialog } from './RecordDialog';
import { offeredItems, type InsertCtx } from '../editor/insertItems';
import { canShareScreen } from '../record/run';
import { InsertMenu } from './InsertMenu';
import { DateDialog, EventDialog, LinkedNoteDialog } from './InsertDialogs';
import { blobToB64, DictateDialog, TranscribeDialog, type Recording } from './Recorder';
import { DrawingDialog } from './DrawingDialog';
import { editorBridge } from '../state/editorBridge';
import { suggestionRequest, cleanSuggestion, completeText } from '@ergonotes/core';
import { canPrint, printNote } from '../state/printNote';
import { Dialog, IconBtn, TagBar, useMenu, type MenuEntry } from './ui';
import { href } from '../state/router';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, setPrefs, usePrefs, usePrefsNow } from '../state/prefs';

type SaveState = 'saved' | 'saving' | 'error';


/** A task to bring into view when the note opens: its place among the note's tasks, and its words (to find it again if the note changed). */
export interface FocusTask { index: number; text?: string }

/** `outside`: the document is a file outside the vault (its full path): no folder, tags, history or other vault things are offered for it. */
/**
 * `scratch`: the editor is the Scratchpad's (a draft that is not a Note yet): no title, folder, tags or top bar, a Send button, and
 * text files dropped on it join the draft as text. `send` gets the draft's Markdown and resolves when it has become a Note.
 */
export interface ScratchMode { send(body: string): Promise<void>; sending?: boolean }
export function NoteEditor({ id, onBack, readOnly, focusTask, outside, scratch }: { id: string; onBack?: () => void; readOnly?: boolean; focusTask?: FocusTask; outside?: string; scratch?: ScratchMode }) {
  const app = useApp();
  const { api } = app;
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [drawing, setDrawing] = useState<{ pos: number; data: string } | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [dateDialog, setDateDialog] = useState<'due' | 'remind' | null>(null);
  const dirty = useRef(false);
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  /** the note body last known to be in the vault (the base for merging what arrives from elsewhere) */
  const loadedBody = useRef('');
  /** the body as it is in the file, and what this editor wrote for it right after loading (ADR 0010: blocks nobody edited are written back as they were) */
  const rawRef = useRef('');
  const normRef = useRef('');
  const docRef = useRef<NoteDoc | null>(null);
  const paused = useRef(false);
  const [external, setExternal] = useState<{ body: string; title: string; updated: string } | null>(null);
  const loadedFor = useRef<{ id: string; updated: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportMenu = useMenu();
  const moreMenu = useMenu();
  const [insertAt, setInsertAt] = useState<DOMRect | null>(null);
  const [insertDialog, setInsertDialog] = useState<'event' | 'date' | 'linked' | null>(null);
  const [recorder, setRecorder] = useState<'recording' | 'meeting' | 'dictate' | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const ctxRef = useRef<InsertCtx | null>(null);
  const styleMenu = useMenu();
  const [, force] = useState(0);

  const summary = app.byId.get(id);
  const isTrashed = !!summary?.inTrash;
  const locked = readOnly || isTrashed;

  const editSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeHeading, setActiveHeading] = useState(0);
  const prefs = usePrefs();
  const titleRef = useRef('');
  titleRef.current = title;
  const habitsRef = useRef(app.habits);
  habitsRef.current = app.habits;
  const ghostRef = useRef({ on: false, delay: 400, transport: app.aiTransport });
  ghostRef.current = { on: app.ai.suggest && app.ai.suggestReady && !app.byId.get(id)?.private, delay: app.ai.suggestDelay, transport: app.aiTransport };
  const [ghostState, setGhostState] = useState<{ busy: boolean; error: string | null; empty: boolean }>({ busy: false, error: null, empty: false });
  const outlineRef = useRef<{ headings: { text: string; level: number }[]; active: number; goto(i: number): void } | null>(null);
  const saveBody = useMemo(() => debounce((nid: string, md: string, seq: number) => {
    setSaveState('saving');
    const body = preserveBlocks(rawRef.current, normRef.current, md);
    rawRef.current = body;
    normRef.current = md;
    inflight.current = api.saveNote(nid, { body }).then(s => {
      // our own write must not look like an outside change (it would reload and reset the cursor)
      if (loadedFor.current?.id === nid) { loadedFor.current = { id: nid, updated: s.updated }; loadedBody.current = body; }
      if (seq === editSeq.current) { dirty.current = false; setSaveState('saved'); }
    }, () => setSaveState('error'));
  }, 700), [api]);
  const saveTitle = useMemo(() => debounce((nid: string, t: string) => {
    setSaveState('saving');
    inflight.current = api.saveNote(nid, { title: t }).then(s => {
      if (loadedFor.current?.id === nid) loadedFor.current = { id: nid, updated: s.updated };
      setSaveState('saved');
    }, () => setSaveState('error'));
  }, 500), [api]);

  const editor = useEditor({
    extensions: [
      // list items hold a paragraph and nested lists only: tables and quotes inside a list item have no Markdown form
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, listItem: false, bulletList: false, codeBlock: false }),
      CodeWithDiagrams,
      TrailingParagraph, Toggle, PageBreak, DateMention, InlineCheckbox, MathBlock, MathInline, AudioClip, RecordBlock, RawBlock, RawInline,
      MarkdownBulletList,
      ListItem.extend({ content: 'paragraph (bulletList | orderedList)*' }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: scratch ? 'Start writing, drop a file or a picture here…' : 'Press "/" to insert an element' }),
      MarkdownTaskList, TaskItem.extend({ content: 'paragraph taskList?' }).configure({ nested: true }),
      Table.configure({ resizable: false }), TableRow, SingleParagraphHeader, SingleParagraphCell, TableKeys,
      StoredImage.configure({ inline: true }),
      Wikilink, ExcalidrawBlock, InlineDecorations,
      GhostText.configure({
        enabled: () => ghostRef.current.on,
        delay: () => ghostRef.current.delay,
        suggest: async (ctx, signal) => {
          setGhostState({ busy: true, error: null, empty: false });
          try {
            const raw = await completeText(ghostRef.current.transport, suggestionRequest({ title: titleRef.current, before: ctx.before, after: ctx.after }), signal);
            const text = cleanSuggestion(raw, ctx.before);
            if (!signal.aborted) setGhostState({ busy: false, error: null, empty: text === '' });
            return text;
          } catch (e) {
            // an abort is the person typing on: not an error
            setGhostState({ busy: false, error: signal.aborted ? null : e instanceof Error ? e.message : String(e), empty: false });
            throw e;
          }
        },
      }),
      LinkSuggest.configure({ api }),
      MentionSuggest.configure({ api, habits: () => habitsRef.current }),
      SlashCommands.configure({
        items: () => slashItems(() => offeredItems().map(i => ({
          id: i.id, label: i.label, hint: i.hint, keywords: i.keywords,
          off: !!(ctxRef.current && i.unavailable?.(ctxRef.current)),
          run: () => { if (ctxRef.current) i.run(ctxRef.current); },
        }))),
      }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: true, breaks: false, transformPastedText: true }),
    ],
    editorProps: { attributes: { class: 'prose', 'aria-label': 'Note body', spellcheck: 'true' } },
    onUpdate: ({ editor: e }) => {
      if (loadedFor.current?.id !== idRef.current) return;
      dirty.current = true;
      setSaveState('saving');
      editSeq.current++;
      if (paused.current) return;
      saveBody(idRef.current, (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown(), editSeq.current);
      force(n => n + 1);
    },
    onSelectionUpdate: () => force(n => n + 1),
  }, []);

  const idRef = useRef(id);
  idRef.current = id;

  const markdownOf = (e: Editor) => (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  /** put a body into the editor and remember both what the file says and what the editor makes of it */
  function loadBody(body: string) {
    if (!editor) return;
    editor.commands.setContent(body, false);
    rawRef.current = body;
    normRef.current = markdownOf(editor);
  }
  /** the body to save: the editor's text, with every block nobody edited exactly as the file has it */
  const currentBody = (e: Editor) => preserveBlocks(rawRef.current, normRef.current, markdownOf(e));

  // open a note
  useEffect(() => {
    let live = true;
    saveBody.flush(); saveTitle.flush();
    setMissing(false);
    setDoc(null);
    setExternal(null);
    paused.current = false;
    void api.getNote(id).then(d => {
      if (!live) return;
      if (!d) { setMissing(true); return; }
      setDoc(d);
      docRef.current = d;
      setNoteDir(d.filePath);
      setNotePrivate(!!d.private);
      setTitle(d.title);
      loadedFor.current = { id: d.id, updated: d.updated };
      loadedBody.current = d.body;
      dirty.current = false;
      setSaveState('saved');
      if (editor) loadBody(d.body);
      // "Sketch" in the create menu: open a new note straight into the drawing board
      if (sessionStorage.getItem('ergo.pending') === 'drawing') {
        sessionStorage.removeItem('ergo.pending');
        setTimeout(() => window.dispatchEvent(new Event('ergo-insert-drawing')), 60);
      }
    });
    return () => {
      live = false;
      saveBody.flush(); saveTitle.flush();
      // leaving the note pushes at once (ADR 0006)
      void inflight.current.then(() => api.flush()).catch(() => { /* offline */ });
    };
  }, [id, api, editor, saveBody, saveTitle]);

  // changes that arrived by sync while the note is open
  useEffect(() => {
    if (!doc || !summary || summary.updated === loadedFor.current?.updated || external) return;
    let live = true;
    void api.getNote(id).then(d => {
      if (!live || !d || !editor) return;
      if (d.updated === loadedFor.current?.updated) return;
      if (!dirty.current) {
        loadedFor.current = { id: d.id, updated: d.updated };
        loadedBody.current = d.body;
        setDoc(d);
        docRef.current = d;
        setNoteDir(d.filePath);
        if (document.activeElement?.tagName !== 'INPUT') setTitle(d.title);
        loadBody(d.body);
        return;
      }
      // the person is typing: merge the remote text into what is on screen instead of losing either side
      const ours = currentBody(editor);
      const r = mergeText(ours, loadedBody.current, d.body);
      if (r.clean) {
        loadedFor.current = { id: d.id, updated: d.updated };
        loadedBody.current = d.body;
        setDoc(d);
        docRef.current = d;
        loadBody(r.text);
        editSeq.current++;
        saveBody(id, markdownOf(editor), editSeq.current);
      } else {
        saveBody.cancel();
        paused.current = true;
        setExternal({ body: d.body, title: d.title, updated: d.updated });
      }
    });
    return () => { live = false; };
  }, [summary?.updated, doc, summary, api, id, editor, external, saveBody]);

  // the note stays read-only while the drawing board is open, so stray keys cannot replace the drawing
  useEffect(() => { editor?.setEditable(!locked && !drawing); }, [editor, locked, drawing]);

  const insertDrawing = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: 'excalidraw', attrs: { data: '' } }).run();
    // open the empty drawing we just inserted: the last one at or before the cursor
    const { from } = editor.state.selection;
    let pos = -1;
    editor.state.doc.descendants((n, p) => { if (n.type.name === 'excalidraw' && !n.attrs.data && p <= from) pos = p; });
    setDrawing({ pos: pos >= 0 ? pos : Math.max(0, from - 1), data: '' });
  }, [editor]);

  useEffect(() => {
    const on = () => { if (!locked) insertDrawing(); };
    window.addEventListener('ergo-insert-drawing', on);
    return () => window.removeEventListener('ergo-insert-drawing', on);
  }, [insertDrawing, locked]);

  useEffect(() => {
    const on = (e: Event) => {
      const pos = (e as CustomEvent<{ pos: number }>).detail.pos;
      if (locked || !editor) return;
      const node = editor.state.doc.nodeAt(pos);
      if (node?.type.name === 'excalidraw') setDrawing({ pos, data: String(node.attrs.data ?? '') });
    };
    window.addEventListener('ergo-edit-drawing', on);
    return () => window.removeEventListener('ergo-edit-drawing', on);
  }, [editor, locked]);

  const attach = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (scratch && /\.(md|markdown|txt)$/i.test(f.name)) {
        // a text file dropped on the Scratchpad is its words, not an attachment
        // (the Markdown extension reads a string given to insertContent as Markdown)
        editor?.chain().focus('end').insertContent('\n\n' + (await f.text())).run();
        continue;
      }
      const data = toB64(new Uint8Array(await f.arrayBuffer()));
      const mime = f.type || 'application/octet-stream';
      const r = await app.run(api.addFile({ name: f.name, mime, data }));
      if (!r) continue;
      const rel = linkTo(r.path);
      if (mime.startsWith('image/')) editor?.chain().focus().setImage({ src: rel, alt: f.name }).run();
      else if (mime.startsWith('audio/')) editor?.chain().focus().insertContent({ type: 'audioClip', attrs: { file: rel, label: f.name } }).run();
      else editor?.chain().focus().insertContent({ type: 'text', text: f.name, marks: [{ type: 'link', attrs: { href: rel } }] }).insertContent(' ').run();
    }
  };

  // a link to a Habit is drawn as a chip with its streak and today's state (the Markdown stays a plain link)
  useEffect(() => {
    if (!editor) return;
    const byPath = new Map(app.habits.map(h => [h.filePath.toLowerCase(), h]));
    const mark = () => {
      editor.view.dom.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
        const href = a.getAttribute('href') ?? '';
        const h = /^(https?:|ergo-file:|mailto:|#)/i.test(href) ? undefined : vaultPathsOf(href).map(p => byPath.get(p.toLowerCase())).find(Boolean);
        if (h) { const c = habitChip(h); a.classList.add('habit-chip'); a.classList.toggle('met', c.met); a.dataset.habit = c.text; }
        else if (a.classList.contains('habit-chip')) { a.classList.remove('habit-chip', 'met'); delete a.dataset.habit; }
      });
    };
    mark();
    editor.on('transaction', mark);
    return () => { editor.off('transaction', mark); };
  }, [editor, app.habits, doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // paste / drop images
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void attach(files); }
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) { e.preventDefault(); void attach(files); }
    };
    dom.addEventListener('paste', onPaste);
    dom.addEventListener('drop', onDrop);
    return () => { dom.removeEventListener('paste', onPaste); dom.removeEventListener('drop', onDrop); };
  });

  // opened from a task: scroll to it and let it show for a moment
  useEffect(() => {
    if (!editor || !doc || !focusTask) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      const items = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('li[data-checked]'));
      const text = (el: HTMLElement) => (el.querySelector(':scope > div > p, :scope > p')?.textContent ?? el.textContent ?? '').trim();
      let el: HTMLElement | undefined = items[focusTask.index];
      // the note was edited since the list was made: the task with the same words nearest to where it was
      if (focusTask.text && (!el || text(el) !== focusTask.text.trim())) {
        const same = items.map((it, i) => ({ it, i })).filter(x => text(x.it) === focusTask.text!.trim()).sort((a, b) => Math.abs(a.i - focusTask.index) - Math.abs(b.i - focusTask.index));
        el = same[0]?.it ?? el;
      }
      if (!el) { if (++tries < 25) t = setTimeout(find, 80); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('task-flash');
      setTimeout(() => el!.classList.remove('task-flash'), 1800);
    };
    t = setTimeout(find, 60);
    return () => { if (t) clearTimeout(t); };
  }, [editor, doc?.id, focusTask?.index, focusTask?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl + wheel over the note changes the size of its text (a plain wheel scrolls as always)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return;
      e.preventDefault();
      setPrefs({ textZoom: clampZoom(usePrefsNow().textZoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [id, editor, !!doc]); // the page exists once the note has loaded // eslint-disable-line react-hooks/exhaustive-deps

  // follow wiki links
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    // a link is resolved by the vault from the note as it is saved, so a link added a moment ago works too
    const fresh = async () => {
      saveBody.flush();
      await inflight.current;
      return (await api.getNote(idRef.current)) ?? docRef.current;
    };
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest('[data-wikilink]');
      if (t) {
        e.preventDefault();
        const target = t.getAttribute('data-target') ?? '';
        void fresh().then(d => {
          const noteId = d?.linkMap[target];
          if (noteId) app.go({ name: 'notes', note: noteId });
          else app.toast(`There is no note called “${target}” in this vault yet.`, 'info');
        });
        return;
      }
      const a = (e.target as HTMLElement).closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('ergo-file:')) { e.preventDefault(); app.setDialog({ kind: 'file', id: href.slice('ergo-file:'.length) }); return; }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return; // a web address
      e.preventDefault();
      void fresh().then(d => {
        const noteId = d?.linkMap[href];
        const fileId = d?.fileMap[href];
        if (noteId) app.go({ name: 'notes', note: noteId });
        else if (fileId) app.setDialog({ kind: 'file', id: fileId });
        else app.toast('That link does not point at a note or file in this vault.', 'info');
      });
    };
    dom.addEventListener('click', onClick);
    return () => dom.removeEventListener('click', onClick);
  });

  useEffect(() => {
    const on = (e: Event) => app.go({ name: 'calendar', day: (e as CustomEvent<{ day: string }>).detail.day });
    window.addEventListener('ergo-open-day', on);
    return () => window.removeEventListener('ergo-open-day', on);
  });

  // lend the headings and the text to the right sidebar (contents tab, assistant tab)
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    const o = outlineRef.current;
    if (!o || !editor) { editorBridge.set(null); return; }
    editorBridge.set({
      outline: { noteId: id, locked: lockedRef.current, headings: o.headings, active: o.active },
      fns: {
        goto: o.goto,
        live: () => ({ title: titleRef.current, body: currentBody(editor) }),
        apply: patch => {
          if (patch.title !== undefined) { setTitle(patch.title); titleRef.current = patch.title; saveTitle(idRef.current, patch.title); }
          if (patch.body !== undefined) editor.commands.setContent(patch.body, true);
        },
      },
    });
  });
  useEffect(() => () => editorBridge.set(null), []);

  if (missing) { outlineRef.current = null; return <div className="empty"><h3>This note is no longer available</h3><p>It may have been deleted on another device.</p></div>; }
  if (!doc || !editor) { outlineRef.current = null; return <div className="empty" aria-busy="true" />; }

  // table of contents: the headings of this note, in order
  const headings: { pos: number; level: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) headings.push({ pos, level: Number(node.attrs.level) || 1, text: node.textContent });
  });
  const trackHeading = () => {
    const box = scrollRef.current;
    if (!box || !headings.length) return;
    const top = box.getBoundingClientRect().top + 24;
    let idx = 0;
    headings.forEach((h, i) => { const el = editor.view.nodeDOM(h.pos) as HTMLElement | null; if (el && el.getBoundingClientRect().top <= top) idx = i; });
    setActiveHeading(idx);
  };
  const gotoHeading = (h: { pos: number }, i: number) => {
    const el = editor.view.nodeDOM(h.pos) as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editor.commands.setTextSelection(h.pos + 1);
    setActiveHeading(i);
  };

  outlineRef.current = { headings: headings.map(h => ({ text: h.text, level: h.level })), active: activeHeading, goto: i => { const h = headings[i]; if (h) gotoHeading(h, i); } };

  const aiOpen = prefs.aside && prefs.asideTab === 'ai';
  const tocOpen = prefs.aside && prefs.asideTab === 'toc';
  const tokens = currentTaskTokens(editor);
  const path = doc.path;
  const words = editor.getText().trim().split(/\s+/).filter(Boolean).length;

  const exportEntries = (): MenuEntry[] => [
    { label: 'Markdown (.md)', icon: <FileText size={16} />, onClick: async () => { await flushNow(); const r = await app.run(api.exportNote(id, 'md')); if (r) download(r.filename, r.mime, r.content); } },
    ...(outside ? [] : [{ label: 'Web page (.html)', icon: <FileText size={16} />, onClick: async () => { await flushNow(); const r = await app.run(api.exportNote(id, 'html')); if (r) download(r.filename, r.mime, r.content); } }]),
    ...(canPrint() ? [{ label: 'PDF…', icon: <Download size={16} />, onClick: async () => {
      await flushNow();
      await printNote({ title: title || doc.title, tags: doc.tags, body: editor.view.dom as HTMLElement });
    } }] : []),
  ];
  const flushNow = async () => { saveBody.flush(); saveTitle.flush(); await inflight.current; };

  const moreEntries = (): MenuEntry[] => outside ? [
    { label: 'Readable line length', icon: <AlignCenter size={16} />, checked: prefs.noteWidth === 'readable', onClick: () => setPrefs({ noteWidth: 'readable' }) },
    { label: 'Full width', icon: <MoveHorizontal size={16} />, checked: prefs.noteWidth === 'full', onClick: () => setPrefs({ noteWidth: 'full' }) },
  ] : [
    { label: doc.pinned ? 'Unpin' : 'Pin to sidebar', icon: doc.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: async () => { await app.run(api.setPinned(id, !doc.pinned)); } },
    { label: 'Move to…', icon: <FolderIcon size={16} />, onClick: () => app.setDialog({ kind: 'move', id }) },
    { label: doc.private ? 'Allow AI to see this note' : 'Keep private from AI', icon: <EyeOff size={16} />, onClick: async () => { await app.run(api.setPrivate(id, !doc.private)); const d = await api.getNote(id); if (d) setDoc(x => x && ({ ...x, private: d.private })); await app.refresh(); } },
    { label: 'Readable line length', icon: <AlignCenter size={16} />, checked: prefs.noteWidth === 'readable', onClick: () => setPrefs({ noteWidth: 'readable' }) },
    { label: 'Full width', icon: <MoveHorizontal size={16} />, checked: prefs.noteWidth === 'full', onClick: () => setPrefs({ noteWidth: 'full' }) },
    { sep: true },
    { label: doc.template ? 'Stop using as template' : 'Use as template', icon: <LayoutTemplate size={16} />, onClick: async () => { await app.run(api.setTemplate(id, !doc.template)); } },
    { label: 'Version history', icon: <HistoryIcon size={16} />, onClick: async () => { await flushNow(); app.setDialog({ kind: 'history', id }); } },
    { sep: true },
    { label: 'Move to trash', icon: <Trash2 size={16} />, danger: true, onClick: async () => { await flushNow(); await app.trashItem(id); onBack ? onBack() : app.go({ name: 'notes', folder: doc.parent ?? undefined }); } },
  ];

  const addTag = async (raw: string) => {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    await app.run(api.setTags(id, [...doc.tags, ...parts]));
    setTagDraft('');
    const d = await api.getNote(id);
    if (d) setDoc(x => x && ({ ...x, tags: d.tags }));
  };
  const removeTag = async (t: string) => {
    await app.run(api.setTags(id, doc.tags.filter(x => x !== t)));
    const d = await api.getNote(id);
    if (d) setDoc(x => x && ({ ...x, tags: d.tags }));
  };

  const insertCtx: InsertCtx = {
    editor,
    pickFile: accept => { if (fileInput.current) { fileInput.current.accept = accept; fileInput.current.click(); } },
    drawing: insertDrawing,
    eventDialog: () => setInsertDialog('event'),
    dateDialog: () => setInsertDialog('date'),
    linkedNoteDialog: () => setInsertDialog('linked'),
    link: () => setLink(),
    record: kind => setRecorder(kind),
    transcribeDialog: () => setTranscribing(true),
    contents: () => setPrefs({ aside: true, asideTab: 'toc' }),
    focusTags: () => { (document.querySelector('.editor-foot .tag-input') as HTMLInputElement | null)?.focus(); },
    stt: app.ai.speechReady,
  };

  // ---- recordings: a voice note, a meeting, dictation, an audio file
  // a string given to insertContent is read as Markdown (tiptap-markdown), so the elements arrive as themselves
  const insertMarkdown = (md: string) => { editor.chain().focus().insertContent(md).run(); };
  const paragraphs = (text: string) => {
    // a transcript arrives as one run of sentences: break it into short paragraphs
    const sentences = text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…。])\s+/);
    const out: string[] = [];
    for (let i = 0; i < sentences.length; i += 4) out.push(sentences.slice(i, i + 4).join(' '));
    return out.join('\n\n');
  };
  const transcriptBlock = (text: string) => `<details>\n<summary>Transcript</summary>\n\n${paragraphs(text)}\n\n</details>`;
  const transcript = async (file: { name: string; mime: string; data: string }, setStatus: (s: string) => void) => {
    setStatus('Writing it out…');
    const text = await app.aiTranscribe(file);
    if (!text.trim()) throw new Error('No speech was found in it.');
    return text;
  };
  const audioExt = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm');
  /** Voice dictation: what was said is written into the note at the cursor. */
  const onDictated = async (r: Recording, setStatus: (s: string) => void) => {
    const data = await blobToB64(r.blob);
    const text = await transcript({ name: `dictation.${audioExt(r.mime)}`, mime: r.mime, data }, setStatus);
    editor.chain().focus().insertContent({ type: 'text', text: text.trim() + ' ' }).run();
  };
  /** A record was started: its link is in the note from the first second, so nothing is lost if the app dies. */
  const onRecordStarted = (kind: 'recording' | 'meeting') => (dir: string) => {
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const label = `${kind === 'meeting' ? 'Meeting' : 'Recording'} ${isoDay(now)} ${hm}`;
    insertMarkdown(`${recordLinkMarkdown(label, linkTo(dir))}\n`);
  };
  const onMediaFile = async (f: File, setStatus: (s: string) => void) => {
    setStatus('Saving…');
    const data = toB64(new Uint8Array(await f.arrayBuffer()));
    const mime = f.type || 'audio/mpeg';
    const saved = await app.run(api.addFile({ name: f.name, mime, data }));
    if (!saved) throw new Error('The file could not be saved.');
    const text = await transcript({ name: f.name, mime, data }, setStatus);
    const label = f.name.replace(/[\[\]]/g, ' ');
    const head = mime.startsWith('audio/') ? `[${label}](${linkTo(saved.path)} "audio")` : `[${label}](${linkTo(saved.path)})`;
    insertMarkdown(`${head}\n\n${transcriptBlock(text)}\n`);
  };
  ctxRef.current = insertCtx;
  const styleLabel = editor.isActive('heading', { level: 1 }) ? 'Heading 1' : editor.isActive('heading', { level: 2 }) ? 'Heading 2' : editor.isActive('heading', { level: 3 }) ? 'Heading 3' : 'Normal text';
  const styleEntries = (): MenuEntry[] => [
    { label: 'Normal text', checked: styleLabel === 'Normal text', onClick: () => editor.chain().focus().setParagraph().run() },
    { label: 'Heading 1', checked: styleLabel === 'Heading 1', onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', checked: styleLabel === 'Heading 2', onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', checked: styleLabel === 'Heading 3', onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  const sendScratch = async () => {
    if (!scratch || !editor || scratch.sending) return;
    saveBody.flush();
    await inflight.current;
    const body = currentBody(editor);
    if (!body.trim()) return;
    try {
      await scratch.send(body);
      loadBody('');
      dirty.current = false;
      editSeq.current++;
      await api.saveNote(id, { body: '' });
      setSaveState('saved');
      editor.commands.focus();
    } catch { /* the Scratchpad has told the person */ }
  };

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className={classNames('editor', scratch && 'scratch')} onKeyDown={scratch ? e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void sendScratch(); } } : undefined}>
      {isTrashed && (
        <div className="banner info" role="status">
          <Trash2 size={16} /><span className="grow">This note is in the Trash.</span>
          <button className="btn" onClick={async () => { await app.run(api.restore(id)); await app.refresh(); }}><RotateCcw size={14} /> Restore</button>
          <button className="btn danger" onClick={async () => { if (confirm('Delete this note forever? This can’t be undone.')) { await app.run(api.purge(id)); await app.refresh(); app.go({ name: 'trash' }); } }}>Delete forever</button>
        </div>
      )}
      {external && (
        <div className="banner" role="alert">
          <GitMerge size={16} /><span className="grow">This note was changed on another device while you were editing, in the same place.</span>
          <button className="btn" onClick={() => { loadedFor.current = { id, updated: external.updated }; loadedBody.current = external.body; paused.current = false; setExternal(null); editSeq.current++; const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown(); saveBody(id, md, editSeq.current); }}>Keep my edits</button>
          <button className="btn" onClick={() => { loadedFor.current = { id, updated: external.updated }; loadedBody.current = external.body; loadBody(external.body); dirty.current = false; paused.current = false; setExternal(null); setSaveState('saved'); }}>Use theirs</button>
        </div>
      )}
      {doc.conflicted && !isTrashed && (
        <div className="banner" role="alert">
          <GitMerge size={16} /><span className="grow">Conflicted revision: this note was also changed on another device.</span>
          <button className="btn" onClick={async () => { await flushNow(); app.setDialog({ kind: 'conflict', id }); }}>Compare…</button>
        </div>
      )}
      {!scratch && <div className="editor-top">
        {onBack && <IconBtn label="Back" icon={<ArrowLeft size={20} />} onClick={onBack} />}
        {!onBack && !app.isMobile && app.route.name === 'notes' && (
          <>
            <IconBtn label={prefs.listHidden ? 'Show the note list' : 'Hide the note list'} icon={prefs.listHidden ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />} onClick={() => setPrefs({ listHidden: !prefs.listHidden })} />
            <IconBtn label={prefs.focus ? 'Leave full screen' : 'Full screen'} icon={prefs.focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />} onClick={() => setPrefs({ focus: !prefs.focus })} />
            <span className="top-sep" aria-hidden />
          </>
        )}
        <nav className="crumbs" aria-label="Location">
          <FolderIcon size={14} />
          {outside && <span className="crumb-path" title={outside}>{outside}</span>}
          {!outside && path.length === 0 && <span style={{ padding: '0 6px' }}>No folder</span>}
          {path.map((p, i) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && <span aria-hidden>/</span>}
              <button onClick={() => app.go({ name: 'notes', folder: p.id })}>{p.title}</button>
            </span>
          ))}
        </nav>
        <IconBtn label={aiOpen ? 'Hide AI assistant' : 'AI assistant'} active={aiOpen} icon={<Sparkles size={18} />}
          onClick={() => setPrefs(aiOpen ? { aside: false } : { aside: true, asideTab: 'ai' })} />
        {!app.isMobile && <IconBtn label={tocOpen ? 'Hide table of contents' : 'Show table of contents'} active={tocOpen} icon={<TableOfContents size={18} />}
          className="toc-toggle" onClick={() => setPrefs(tocOpen ? { aside: false } : { aside: true, asideTab: 'toc' })} />}
        {!app.isMobile && (
          <span className="zoom-ctl" role="group" aria-label="Text size">
            <IconBtn label="Smaller text" icon={<ZoomOut size={18} />} disabled={prefs.textZoom <= ZOOM_MIN} onClick={() => setPrefs({ textZoom: clampZoom(prefs.textZoom - ZOOM_STEP) })} />
            <button type="button" className="zoom-pct" title="Normal text size" aria-label={`Text size ${prefs.textZoom}%, reset`} onClick={() => setPrefs({ textZoom: 100 })}>{prefs.textZoom}%</button>
            <IconBtn label="Larger text" icon={<ZoomIn size={18} />} disabled={prefs.textZoom >= ZOOM_MAX} onClick={() => setPrefs({ textZoom: clampZoom(prefs.textZoom + ZOOM_STEP) })} />
          </span>
        )}
        <IconBtn label="Export" haspopup icon={<Share2 size={18} />} onClick={e => exportMenu.open(e, exportEntries(), 'right')} />
        <IconBtn label="More actions" haspopup icon={<MoreHorizontal size={20} />} onClick={e => moreMenu.open(e, moreEntries(), 'right')} />
      </div>}
      {exportMenu.node}{moreMenu.node}{styleMenu.node}
      {insertAt && <InsertMenu anchor={insertAt} ctx={insertCtx} onClose={() => setInsertAt(null)} />}

      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="tb-btn accent" disabled={locked} onClick={e => setInsertAt(e.currentTarget.getBoundingClientRect())}><span className="insert-dot"><Plus size={12} /></span> Insert <ChevronDown size={14} /></button>
        {!scratch && canShareScreen() && <TB locked={locked} label="Meeting" onClick={() => insertCtx.record('meeting')}><AudioLines size={18} /></TB>}
        {!scratch && <TB locked={locked} label="Recording" onClick={() => insertCtx.record('recording')}><Mic size={18} /></TB>}
        <TB locked={locked} label="Checklist" on={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={18} /></TB>
        {!scratch && <>
        <TB locked={locked} label={tokens.inTask ? 'Due date' : 'Due date (place the cursor in a task)'} on={!!tokens.due} disabled={!tokens.inTask} onClick={() => setDateDialog('due')}><CalendarDays size={18} /></TB>
        <TB locked={locked} label="Reminder" on={!!tokens.remind} disabled={!tokens.inTask} onClick={() => setDateDialog('remind')}><Bell size={18} /></TB>
        <TB locked={locked} label="Flag task" on={tokens.flag} disabled={!tokens.inTask} onClick={() => setTaskToken(editor, 'flag', tokens.flag ? null : '1')}><Flag size={18} /></TB>
        </>}
        <span className="tb-sep" />
        <TB locked={locked} label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={18} /></TB>
        <TB locked={locked} label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={18} /></TB>
        <span className="tb-sep" />
        <button type="button" className="tb-btn" disabled={locked} onClick={e => styleMenu.open(e, styleEntries())}>{styleLabel} <ChevronDown size={14} /></button>
        <span className="tb-sep" />
        <TB locked={locked} label="Bold" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></TB>
        <TB locked={locked} label="Italic" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></TB>
        <TB locked={locked} label="Strikethrough" on={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={18} /></TB>
        <TB locked={locked} label="Inline code" on={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={18} /></TB>
        <TB locked={locked} label="Link" on={editor.isActive('link')} onClick={setLink}><Link2 size={18} /></TB>
        <span className="tb-sep" />
        <TB locked={locked} label="Bulleted list" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={18} /></TB>
        <TB locked={locked} label="Numbered list" on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></TB>
        <TB locked={locked} label="Quote" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={18} /></TB>
      </div>

      <div className="editor-main">
      <div className="editor-scroll" ref={scrollRef} onScroll={trackHeading}>
        <div className={classNames('editor-page', prefs.noteWidth === 'full' && 'full')}>
          {!scratch && <div className="edited">Edited {new Date(doc.updated).toLocaleDateString('en', { month: 'short', day: 'numeric' })}{doc.private && <span className="private-flag" title="The AI assistant and AI agents cannot see this note"><EyeOff size={12} /> Private</span>}</div>}
          {!scratch && <input className="title-input" aria-label="Title" placeholder="Title" value={title} readOnly={locked || !!outside}
            onChange={e => { setTitle(e.target.value); setSaveState('saving'); saveTitle(id, e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start'); } }} />}
          {!scratch && !outside && app.habits.some(h => h.id === id) && <HabitPanel id={id} updated={doc.updated} />}
          <EditorContent editor={editor} />
          {!scratch && doc.backlinks.length > 0 && (
            <section aria-label="Backlinks" style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', margin: '0 0 8px' }}>Linked from</h3>
              {doc.backlinks.map(b => <a key={b.id} href={href({ name: 'notes', note: b.id })} className="chip reminder" style={{ marginRight: 6 }}>{b.title}</a>)}
            </section>
          )}
        </div>
      </div>
      </div>

      {scratch && (
        <div className="editor-foot scratch-foot">
          <span className="grow">{words === 0 ? 'Goes to your Inbox when you send it' : `${words} word${words === 1 ? '' : 's'} · not a note yet`}</span>
          <button type="button" className="btn primary" disabled={scratch.sending} onClick={() => void sendScratch()} title="Send to Inbox (Ctrl+Enter)">
            {scratch.sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Send
          </button>
        </div>
      )}
      {!scratch && <div className="editor-foot">
        {!outside && <Tag size={15} />}
        {!outside && <TagBar tags={doc.tags} onRemove={locked ? undefined : t => void removeTag(t)}>
          {!locked && (
            <input className="tag-input" aria-label="Add tag" placeholder="Add tag" value={tagDraft} onChange={e => setTagDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void addTag(tagDraft); } else if (e.key === 'Backspace' && !tagDraft && doc.tags.length) void removeTag(doc.tags[doc.tags.length - 1]); }}
              onBlur={() => void addTag(tagDraft)} />
          )}
        </TagBar>}
        {outside && <span className="grow" />}
        {app.ai.suggest && ghostState.busy && <span className="ghost-status" role="status"><Sparkles size={12} /> Thinking of a suggestion…</span>}
        {app.ai.suggest && !ghostState.busy && ghostState.error && <span className="ghost-status err" role="status" title={ghostState.error}>Suggestion unavailable: {ghostState.error.length > 60 ? ghostState.error.slice(0, 59) + '…' : ghostState.error}</span>}
        {app.ai.suggest && !ghostState.busy && !ghostState.error && ghostState.empty && <span className="ghost-status" role="status">No suggestion for this text</span>}
        {app.ai.suggestReady && !locked && (
          <button type="button" className={classNames('ghost-toggle', app.ai.suggest && 'on')} aria-pressed={app.ai.suggest}
            title={app.ai.suggest ? 'Turn off next-words suggestions' : 'Suggest the next words while you type (sends the text around the cursor to your AI provider)'}
            onClick={async () => { await app.run(api.setAiSettings({ suggest: !app.ai.suggest })); await app.refresh(); }}>
            <Sparkles size={13} /> Suggestions {app.ai.suggest ? 'on' : 'off'}
          </button>
        )}
        <span>{words} word{words === 1 ? '' : 's'}</span>
        <span role="status" aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save' : 'All changes saved'}</span>
      </div>}

      <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) void attach(e.target.files); e.target.value = ''; }} />

      {drawing && (
        <DrawingDialog initial={drawing.data} onClose={() => {
          // an empty, just-inserted drawing is removed again
          const n = editor.state.doc.nodeAt(drawing.pos);
          if (n?.type.name === 'excalidraw' && !n.attrs.data) editor.chain().focus().deleteRange({ from: drawing.pos, to: drawing.pos + n.nodeSize }).run();
          setDrawing(null);
        }} onSave={json => {
          const node = editor.state.doc.nodeAt(drawing.pos);
          if (node?.type.name === 'excalidraw') editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(drawing.pos, undefined, { data: json }); return true; }).run();
          else editor.chain().focus().insertContent({ type: 'excalidraw', attrs: { data: json } }).run(); // the block moved or went away: put the drawing where the cursor is
          setDrawing(null);
        }} />
      )}
      {recorder === 'dictate' && <DictateDialog sttReady={app.ai.speechReady} privateNote={!!doc.private} onClose={() => setRecorder(null)} onFinish={onDictated} />}
      {(recorder === 'recording' || recorder === 'meeting') && <RecordDialog kind={recorder} noteId={id} noteTitle={doc.title} privateNote={!!doc.private}
        onClose={() => setRecorder(null)} onStarted={onRecordStarted(recorder)} />}
      {transcribing && <TranscribeDialog privateNote={!!doc.private} onClose={() => setTranscribing(false)} onPick={onMediaFile} />}
      {insertDialog === 'date' && <DateDialog onClose={() => setInsertDialog(null)} onInsert={day => { setInsertDialog(null); editor.chain().focus().insertContent([{ type: 'dateMention', attrs: { date: day } }, { type: 'text', text: ' ' }]).run(); }} />}
      {insertDialog === 'event' && <EventDialog initialTitle={editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')} onClose={() => setInsertDialog(null)}
        onInsert={text => { setInsertDialog(null); editor.chain().focus().insertContent(text).run(); }} />}
      {insertDialog === 'linked' && <LinkedNoteDialog onClose={() => setInsertDialog(null)} onCreate={async t => {
        const n = await app.run(api.createNote({ title: t, parent: doc.parent ?? undefined }));
        if (!n) return;
        setInsertDialog(null);
        editor.chain().focus().insertContent([{ type: 'text', text: n.title, marks: [{ type: 'link', attrs: { href: linkTo(n.filePath) } }] }, { type: 'text', text: ' ' }]).run();
        await app.refresh();
      }} />}
      {dateDialog && <TaskDateDialog kind={dateDialog} value={dateDialog === 'due' ? tokens.due : tokens.remind} onClose={() => setDateDialog(null)}
        onSet={v => { setTaskToken(editor, dateDialog, v); setDateDialog(null); }} />}
    </div>
  );
}

function TB({ on, label, onClick, children, disabled, locked }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; locked: boolean }) {
  return (
    <button type="button" className={classNames('tb-btn', on && 'on')} aria-label={label} title={label} aria-pressed={on} disabled={disabled || locked} onClick={onClick}>{children}</button>
  );
}

function TaskDateDialog({ kind, value, onSet, onClose }: { kind: 'due' | 'remind'; value?: string; onSet: (v: string | null) => void; onClose: () => void }) {
  const [date, setDate] = useState(value?.slice(0, 10) ?? isoDay());
  const [time, setTime] = useState(value && value.length > 10 ? value.slice(11, 16) : kind === 'remind' ? '09:00' : '');
  return (
    <Dialog title={kind === 'due' ? 'Due date' : 'Reminder'} onClose={onClose} footer={
      <>
        {value && <button className="btn" onClick={() => onSet(null)}>Remove</button>}
        <button className="btn primary" disabled={!date} onClick={() => onSet(time ? `${date}T${time}` : date)}>Set</button>
      </>
    }>
      <div className="field"><label htmlFor="td-d">Date</label><input id="td-d" type="date" className="input" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="field"><label htmlFor="td-t">Time {kind === 'due' && <span className="hint">(optional)</span>}</label><input id="td-t" type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></div>
    </Dialog>
  );
}

export type { Editor };
