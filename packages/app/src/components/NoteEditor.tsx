import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import ListItem from '@tiptap/extension-list-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import {
  ArrowLeft, Bell, Bold, CalendarDays, CheckSquare, ChevronDown, Code, Download, FileText, Flag, Folder as FolderIcon, GitMerge, History as HistoryIcon, Italic,
  Link2, List, ListOrdered, MoreHorizontal, Pencil, Pin, PinOff, Plus, Quote, Redo2, RotateCcw, Share2, Strikethrough, Table2, Tag, Trash2, Undo2, X, Image as ImageIcon, Minus, LayoutTemplate,
} from 'lucide-react';
import type { NoteDoc } from '@ergonotes/core';
import { useApp } from '../state/app';
import { classNames, debounce, download } from '../state/util';
import { currentTaskTokens, ExcalidrawBlock, InlineDecorations, LinkSuggest, MarkdownBulletList, MarkdownTaskList, setTaskToken, SlashCommands, slashItems, StoredImage, Wikilink } from '../editor/extensions';
import { DrawingDialog } from './DrawingDialog';
import { useMenu, type MenuEntry } from './ui';

type SaveState = 'saved' | 'saving' | 'error';

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function NoteEditor({ id, onBack, readOnly }: { id: string; onBack?: () => void; readOnly?: boolean }) {
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
  const loadedFor = useRef<{ id: string; updated: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportMenu = useMenu();
  const moreMenu = useMenu();
  const insertMenu = useMenu();
  const styleMenu = useMenu();
  const [, force] = useState(0);

  const summary = app.byId.get(id);
  const isTrashed = !!summary?.inTrash;
  const locked = readOnly || isTrashed;

  const editSeq = useRef(0);
  const saveBody = useMemo(() => debounce((nid: string, body: string, seq: number) => {
    setSaveState('saving');
    api.saveNote(nid, { body }).then(s => {
      // our own write must not look like an outside change (it would reload and reset the cursor)
      if (loadedFor.current?.id === nid) loadedFor.current = { id: nid, updated: s.updated };
      if (seq === editSeq.current) { dirty.current = false; setSaveState('saved'); }
    }, () => setSaveState('error'));
  }, 700), [api]);
  const saveTitle = useMemo(() => debounce((nid: string, t: string) => {
    setSaveState('saving');
    api.saveNote(nid, { title: t }).then(s => {
      if (loadedFor.current?.id === nid) loadedFor.current = { id: nid, updated: s.updated };
      setSaveState('saved');
    }, () => setSaveState('error'));
  }, 500), [api]);

  const editor = useEditor({
    extensions: [
      // list items hold a paragraph and nested lists only: tables and quotes inside a list item have no Markdown form
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, listItem: false, bulletList: false }),
      MarkdownBulletList,
      ListItem.extend({ content: 'paragraph (bulletList | orderedList)*' }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: 'Start writing…  type / for commands, [[ to link a note' }),
      MarkdownTaskList, TaskItem.extend({ content: 'paragraph taskList?' }).configure({ nested: true }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      StoredImage.configure({ inline: true }),
      Wikilink, ExcalidrawBlock, InlineDecorations,
      LinkSuggest.configure({ api }),
      SlashCommands.configure({
        items: () => slashItems({
          drawing: () => insertDrawing(),
          image: () => fileInput.current?.click(),
        }),
      }),
      Markdown.configure({ html: false, tightLists: true, bulletListMarker: '-', linkify: true, breaks: false, transformPastedText: true }),
    ],
    editorProps: { attributes: { class: 'prose', 'aria-label': 'Note body', spellcheck: 'true' } },
    onUpdate: ({ editor: e }) => {
      if (loadedFor.current?.id !== idRef.current) return;
      dirty.current = true;
      setSaveState('saving');
      editSeq.current++;
      saveBody(idRef.current, (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown(), editSeq.current);
      force(n => n + 1);
    },
    onSelectionUpdate: () => force(n => n + 1),
  }, []);

  const idRef = useRef(id);
  idRef.current = id;

  // open a note
  useEffect(() => {
    let live = true;
    saveBody.flush(); saveTitle.flush();
    setMissing(false);
    setDoc(null);
    void api.getNote(id).then(d => {
      if (!live) return;
      if (!d) { setMissing(true); return; }
      setDoc(d);
      setTitle(d.title);
      loadedFor.current = { id: d.id, updated: d.updated };
      dirty.current = false;
      setSaveState('saved');
      if (editor) editor.commands.setContent(d.body, false);
    });
    return () => { live = false; saveBody.flush(); saveTitle.flush(); };
  }, [id, api, editor, saveBody, saveTitle]);

  // pick up changes that arrived by sync while the note is open and untouched
  useEffect(() => {
    if (!doc || !summary || dirty.current || summary.updated === loadedFor.current?.updated) return;
    let live = true;
    void api.getNote(id).then(d => {
      if (!live || !d || dirty.current) return;
      loadedFor.current = { id: d.id, updated: d.updated };
      setDoc(d);
      if (document.activeElement?.tagName !== 'INPUT') setTitle(d.title);
      editor?.commands.setContent(d.body, false);
    });
    return () => { live = false; };
  }, [summary?.updated, doc, summary, api, id, editor]);

  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);

  const insertDrawing = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertContent({ type: 'excalidraw', attrs: { data: '' } }).run();
    // the node we just inserted is the selected node; open it
    const pos = editor.state.selection.from - 1;
    setDrawing({ pos: Math.max(0, pos), data: '' });
  }, [editor]);

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
      if (!f.type.startsWith('image/')) { app.toast(`“${f.name}” is not an image`, 'error'); continue; }
      const data = await fileToBase64(f);
      const r = await app.run(api.addFile({ name: f.name, mime: f.type, data }));
      if (r) editor?.chain().focus().setImage({ src: `ergo-file:${r.id}`, alt: f.name }).run();
    }
  };

  // paste / drop images
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void attach(files); }
    };
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); void attach(files); }
    };
    dom.addEventListener('paste', onPaste);
    dom.addEventListener('drop', onDrop);
    return () => { dom.removeEventListener('paste', onPaste); dom.removeEventListener('drop', onDrop); };
  });

  // follow wiki links
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest('[data-wikilink]');
      if (t) { e.preventDefault(); app.go({ name: 'notes', note: t.getAttribute('data-wikilink') ?? undefined }); }
    };
    dom.addEventListener('click', onClick);
    return () => dom.removeEventListener('click', onClick);
  });

  if (missing) return <div className="empty"><h3>This note is no longer available</h3><p>It may have been deleted on another device.</p></div>;
  if (!doc || !editor) return <div className="empty" aria-busy="true" />;

  const tokens = currentTaskTokens(editor);
  const path = doc.path;
  const words = editor.getText().trim().split(/\s+/).filter(Boolean).length;

  const exportEntries = (): MenuEntry[] => [
    { label: 'Markdown (.md)', icon: <FileText size={16} />, onClick: async () => { await flushNow(); const r = await app.run(api.exportNote(id, 'md')); if (r) download(r.filename, r.mime, r.content); } },
    { label: 'Web page (.html)', icon: <FileText size={16} />, onClick: async () => { await flushNow(); const r = await app.run(api.exportNote(id, 'html')); if (r) download(r.filename, r.mime, r.content); } },
    { label: 'PDF / Print…', icon: <Download size={16} />, onClick: () => window.print() },
  ];
  const flushNow = async () => { saveBody.flush(); saveTitle.flush(); await new Promise(r => setTimeout(r, 60)); };

  const moreEntries = (): MenuEntry[] => [
    { label: doc.pinned ? 'Unpin from Shortcuts' : 'Add to Shortcuts', icon: doc.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: async () => { await app.run(api.setPinned(id, !doc.pinned)); } },
    { label: 'Move to…', icon: <FolderIcon size={16} />, onClick: () => app.setDialog({ kind: 'move', id }) },
    { label: doc.template ? 'Stop using as template' : 'Use as template', icon: <LayoutTemplate size={16} />, onClick: async () => { await app.run(api.setTemplate(id, !doc.template)); } },
    { label: 'Version history', icon: <HistoryIcon size={16} />, onClick: async () => { await flushNow(); app.setDialog({ kind: 'history', id }); } },
    { sep: true },
    { label: 'Move to Trash', icon: <Trash2 size={16} />, danger: true, onClick: async () => { await flushNow(); await app.run(api.trash(id)); await app.refresh(); onBack ? onBack() : app.go({ name: 'notes', folder: doc.parent ?? undefined }); } },
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

  const insertEntries = (): MenuEntry[] => [
    { label: 'Checklist', icon: <CheckSquare size={16} />, onClick: () => editor.chain().focus().toggleTaskList().run() },
    { label: 'Table', icon: <Table2 size={16} />, onClick: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: 'Drawing', icon: <Pencil size={16} />, onClick: insertDrawing },
    { label: 'Image', icon: <ImageIcon size={16} />, onClick: () => fileInput.current?.click() },
    { label: 'Link to a note', icon: <Link2 size={16} />, onClick: () => editor.chain().focus().insertContent('[[').run() },
    { label: 'Divider', icon: <Minus size={16} />, onClick: () => editor.chain().focus().setHorizontalRule().run() },
    { label: 'Code block', icon: <Code size={16} />, onClick: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: 'Callout', icon: <Quote size={16} />, onClick: () => editor.chain().focus().toggleBlockquote().insertContent('[!note] ').run() },
  ];
  const styleLabel = editor.isActive('heading', { level: 1 }) ? 'Heading 1' : editor.isActive('heading', { level: 2 }) ? 'Heading 2' : editor.isActive('heading', { level: 3 }) ? 'Heading 3' : 'Normal text';
  const styleEntries = (): MenuEntry[] => [
    { label: 'Normal text', checked: styleLabel === 'Normal text', onClick: () => editor.chain().focus().setParagraph().run() },
    { label: 'Heading 1', checked: styleLabel === 'Heading 1', onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: 'Heading 2', checked: styleLabel === 'Heading 2', onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Heading 3', checked: styleLabel === 'Heading 3', onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  ];

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link address', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const TB = ({ on, label, onClick, children, disabled }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button type="button" className={classNames('tb-btn', on && 'on')} aria-label={label} title={label} aria-pressed={on} disabled={disabled || locked} onClick={onClick}>{children}</button>
  );

  return (
    <div className="editor">
      {isTrashed && (
        <div className="banner info" role="status">
          <Trash2 size={16} /><span className="grow">This note is in the Trash.</span>
          <button className="btn" onClick={async () => { await app.run(api.restore(id)); await app.refresh(); }}><RotateCcw size={14} /> Restore</button>
          <button className="btn danger" onClick={async () => { if (confirm('Delete this note forever? This cannot be undone.')) { await app.run(api.purge(id)); await app.refresh(); app.go({ name: 'trash' }); } }}>Delete forever</button>
        </div>
      )}
      {doc.conflicted && !isTrashed && (
        <div className="banner" role="alert">
          <GitMerge size={16} /><span className="grow">Conflicted revision: this note was also changed on another device.</span>
          <button className="btn" onClick={async () => { await flushNow(); app.setDialog({ kind: 'conflict', id }); }}>Compare…</button>
        </div>
      )}
      <div className="editor-top">
        {onBack && <button className="icon-btn" aria-label="Back" onClick={onBack}><ArrowLeft size={20} /></button>}
        <nav className="crumbs" aria-label="Location">
          <FolderIcon size={14} />
          {path.length === 0 && <span style={{ padding: '0 6px' }}>No folder</span>}
          {path.map((p, i) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 0 && <span aria-hidden>/</span>}
              <button onClick={() => app.go({ name: 'notes', folder: p.id })}>{p.title}</button>
            </span>
          ))}
        </nav>
        <button className="btn blue" onClick={e => exportMenu.open(e, exportEntries(), 'right')}><Share2 size={15} /> Export</button>
        <button className="icon-btn" aria-label="More actions" onClick={e => moreMenu.open(e, moreEntries(), 'right')}><MoreHorizontal size={20} /></button>
      </div>
      {exportMenu.node}{moreMenu.node}{insertMenu.node}{styleMenu.node}

      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="tb-btn accent" disabled={locked} onClick={e => insertMenu.open(e, insertEntries())}><Plus size={16} /> Insert <ChevronDown size={14} /></button>
        <TB label="Checklist" on={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><CheckSquare size={18} /></TB>
        <TB label={tokens.inTask ? 'Due date' : 'Due date (place the cursor in a task)'} on={!!tokens.due} disabled={!tokens.inTask} onClick={() => setDateDialog('due')}><CalendarDays size={18} /></TB>
        <TB label="Reminder" on={!!tokens.remind} disabled={!tokens.inTask} onClick={() => setDateDialog('remind')}><Bell size={18} /></TB>
        <TB label="Flag task" on={tokens.flag} disabled={!tokens.inTask} onClick={() => setTaskToken(editor, 'flag', tokens.flag ? null : '1')}><Flag size={18} /></TB>
        <span className="tb-sep" />
        <TB label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={18} /></TB>
        <TB label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={18} /></TB>
        <span className="tb-sep" />
        <button type="button" className="tb-btn" disabled={locked} onClick={e => styleMenu.open(e, styleEntries())}>{styleLabel} <ChevronDown size={14} /></button>
        <span className="tb-sep" />
        <TB label="Bold" on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></TB>
        <TB label="Italic" on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></TB>
        <TB label="Strikethrough" on={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={18} /></TB>
        <TB label="Inline code" on={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code size={18} /></TB>
        <TB label="Link" on={editor.isActive('link')} onClick={setLink}><Link2 size={18} /></TB>
        <span className="tb-sep" />
        <TB label="Bulleted list" on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={18} /></TB>
        <TB label="Numbered list" on={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></TB>
        <TB label="Quote" on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={18} /></TB>
      </div>

      <div className="editor-scroll">
        <div className="editor-page">
          <input className="title-input" aria-label="Title" placeholder="Untitled" value={title} readOnly={locked}
            onChange={e => { setTitle(e.target.value); setSaveState('saving'); saveTitle(id, e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start'); } }} />
          <EditorContent editor={editor} />
          {doc.backlinks.length > 0 && (
            <section aria-label="Backlinks" style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 13, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '0 0 8px' }}>Linked from</h3>
              {doc.backlinks.map(b => <a key={b.id} href={`#/notes/${b.id}`} className="chip reminder" style={{ marginRight: 6 }}>{b.title}</a>)}
            </section>
          )}
        </div>
      </div>

      <div className="editor-foot">
        <Tag size={15} />
        {doc.tags.map(t => (
          <span key={t} className="chip">{t}{!locked && <button aria-label={`Remove tag ${t}`} onClick={() => void removeTag(t)} style={{ display: 'inline-flex' }}><X size={12} /></button>}</span>
        ))}
        {!locked && (
          <input className="tag-input" aria-label="Add tag" placeholder="Add tag" value={tagDraft} onChange={e => setTagDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void addTag(tagDraft); } else if (e.key === 'Backspace' && !tagDraft && doc.tags.length) void removeTag(doc.tags[doc.tags.length - 1]); }}
            onBlur={() => void addTag(tagDraft)} />
        )}
        <span className="grow" />
        <span>{words} word{words === 1 ? '' : 's'}</span>
        <span role="status" aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save' : 'All changes saved'}</span>
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files) void attach(e.target.files); e.target.value = ''; }} />

      {drawing && (
        <DrawingDialog initial={drawing.data} onClose={() => {
          // an empty, just-inserted drawing is removed again
          const n = editor.state.doc.nodeAt(drawing.pos);
          if (n?.type.name === 'excalidraw' && !n.attrs.data) editor.chain().focus().deleteRange({ from: drawing.pos, to: drawing.pos + n.nodeSize }).run();
          setDrawing(null);
        }} onSave={json => {
          editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(drawing.pos, undefined, { data: json }); return true; }).run();
          setDrawing(null);
        }} />
      )}
      {dateDialog && <TaskDateDialog kind={dateDialog} value={dateDialog === 'due' ? tokens.due : tokens.remind} onClose={() => setDateDialog(null)}
        onSet={v => { setTaskToken(editor, dateDialog, v); setDateDialog(null); }} />}
    </div>
  );
}

function TaskDateDialog({ kind, value, onSet, onClose }: { kind: 'due' | 'remind'; value?: string; onSet: (v: string | null) => void; onClose: () => void }) {
  const [date, setDate] = useState(value?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(value && value.length > 10 ? value.slice(11, 16) : kind === 'remind' ? '09:00' : '');
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={kind === 'due' ? 'Due date' : 'Reminder'} style={{ width: 360 }}>
        <header><h2>{kind === 'due' ? 'Due date' : 'Reminder'}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        <div className="content">
          <div className="field"><label htmlFor="td-d">Date</label><input id="td-d" type="date" className="input" value={date} onChange={e => setDate(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="td-t">Time {kind === 'due' && <span className="hint">(optional)</span>}</label><input id="td-t" type="time" className="input" value={time} onChange={e => setTime(e.target.value)} /></div>
        </div>
        <footer>
          {value && <button className="btn" onClick={() => onSet(null)}>Remove</button>}
          <button className="btn primary" disabled={!date} onClick={() => onSet(time ? `${date}T${time}` : date)}>Set</button>
        </footer>
      </div>
    </div>
  );
}

export type { Editor };
