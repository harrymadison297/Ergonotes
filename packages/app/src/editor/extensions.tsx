import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import Image from '@tiptap/extension-image';
import BulletList from '@tiptap/extension-bullet-list';
import TaskList from '@tiptap/extension-task-list';
import taskListPlugin from 'markdown-it-task-lists';
import Suggestion from '@tiptap/suggestion';
import { useEffect, useState } from 'react';
import type { VaultApi } from '@ergonotes/core';
import { popupRenderer, type PopupItem } from './suggest';
import { FileImg } from '../components/FileImg';
import { parseDue } from '../state/util';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WIKI_RE = /^\[\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([^\]\n]*)\]\]/;

// ---------------------------------------------------------------- [[id|Title]] links
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { id: { default: '' }, title: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'span[data-wikilink]', getAttrs: el => ({ id: (el as HTMLElement).getAttribute('data-wikilink'), title: (el as HTMLElement).textContent ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-wikilink': node.attrs.id, class: 'wikilink' }), node.attrs.title];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void }, node: { attrs: { id: string; title: string } }) {
          state.write(`[[${node.attrs.id}|${String(node.attrs.title).replace(/[\]|\n]/g, ' ')}]]`);
        },
        parse: {
          setup(md: { inline: { ruler: { before(a: string, b: string, fn: (s: unknown, silent: boolean) => boolean): void } } }) {
            md.inline.ruler.before('link', 'ergo_wikilink', (st: unknown, silent: boolean) => {
              const state = st as { src: string; pos: number; push(type: string, tag: string, nesting: number): { content: string } };
              if (state.src.charCodeAt(state.pos) !== 0x5b) return false;
              const m = WIKI_RE.exec(state.src.slice(state.pos));
              if (!m) return false;
              if (!silent) state.push('html_inline', '', 0).content = `<span data-wikilink="${m[1]}">${esc(m[2])}</span>`;
              state.pos += m[0].length;
              return true;
            });
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- ```ergonote-excalidraw
function DrawingView({ node, selected, getPos }: NodeViewProps) {
  const [svg, setSvg] = useState<string>('');
  const data = String(node.attrs.data ?? '');
  useEffect(() => {
    let live = true;
    if (!data) { setSvg(''); return; }
    (async () => {
      try {
        const scene = JSON.parse(data) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
        if (!scene.elements?.length) { if (live) setSvg(''); return; }
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const el = await exportToSvg({
          elements: scene.elements as never, files: (scene.files ?? {}) as never,
          appState: { ...(scene.appState ?? {}), exportBackground: false, exportWithDarkMode: false } as never,
        });
        if (live) setSvg(el.outerHTML);
      } catch { if (live) setSvg(''); }
    })();
    return () => { live = false; };
  }, [data]);
  const open = () => window.dispatchEvent(new CustomEvent('ergo-edit-drawing', { detail: { pos: getPos() } }));
  return (
    <NodeViewWrapper className={`excalidraw-block${svg ? '' : ' empty'}${selected ? ' ProseMirror-selectednode' : ''}`} data-drag-handle>
      <div role="button" tabIndex={0} aria-label="Edit drawing" onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}>
        {svg ? <img className="drawing" alt="Drawing" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} draggable={false} /> : <div style={{ padding: 28 }}>Empty drawing — click to draw</div>}
        <span className="hint">Click to edit</span>
      </div>
    </NodeViewWrapper>
  );
}

export const ExcalidrawBlock = Node.create({
  name: 'excalidraw',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() { return { data: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-excalidraw]', getAttrs: el => ({ data: (el as HTMLElement).getAttribute('data-excalidraw') ?? '' }) }]; },
  renderHTML({ node }) { return ['div', { 'data-excalidraw': node.attrs.data }]; },
  addNodeView() { return ReactNodeViewRenderer(DrawingView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write(s: string): void; closeBlock(n: unknown): void }, node: { attrs: { data: string } }) {
          state.write('```ergonote-excalidraw\n' + String(node.attrs.data).replace(/\n/g, ' ') + '\n```');
          state.closeBlock(node);
        },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll('pre > code.language-ergonote-excalidraw').forEach(code => {
              const div = document.createElement('div');
              div.setAttribute('data-excalidraw', code.textContent?.trim() ?? '');
              code.parentElement!.replaceWith(div);
            });
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- images stored as file items
function ImageView({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block', maxWidth: '100%' }} className={selected ? 'ProseMirror-selectednode' : undefined}>
      <FileImg src={String(node.attrs.src ?? '')} alt={String(node.attrs.alt ?? '')} />
    </NodeViewWrapper>
  );
}
export const StoredImage = Image.extend({
  addNodeView() { return ReactNodeViewRenderer(ImageView); },
});

// ---------------------------------------------------------------- @due(..) / @remind(..) / @flag chips and callouts
const TOKEN_RE = /@(due|remind)\(([^)]+)\)|@flag\b/g;
export const InlineDecorations = Extension.create({
  name: 'inlineDecorations',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('inlineDecorations'),
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          const now = Date.now();
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'blockquote') {
              const first = node.firstChild?.textContent ?? '';
              if (/^\[![a-z]+\]/i.test(first)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'callout' }));
            }
            if (!node.isText || !node.text) return;
            TOKEN_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = TOKEN_RE.exec(node.text))) {
              const overdue = m[1] === 'due' && parseDue(m[2]) < now;
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: `task-meta${overdue ? ' overdue' : ''}` }));
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// ---------------------------------------------------------------- [[ link picker and / commands
export interface LinkItem extends PopupItem { noteId: string }
export const LinkSuggest = Extension.create<{ api: VaultApi | null }>({
  name: 'linkSuggest',
  addOptions() { return { api: null }; },
  addProseMirrorPlugins() {
    const api = this.options.api;
    return [Suggestion<LinkItem>({
      editor: this.editor,
      pluginKey: new PluginKey('linkSuggest'),
      char: '[[',
      allowSpaces: true,
      items: async ({ query }) => {
        if (!api) return [];
        const r = await api.linkTargets(query);
        return r.map(x => ({ id: x.id, noteId: x.id, label: x.title }));
      },
      command: ({ editor, range, props }) => {
        editor.chain().focus().insertContentAt(range, [{ type: 'wikilink', attrs: { id: props.noteId, title: props.label } }, { type: 'text', text: ' ' }]).run();
      },
      render: popupRenderer<LinkItem>(),
    })];
  },
});

export interface SlashItem extends PopupItem { run: (e: Editor) => void }
export function slashItems(extra: { drawing: () => void; image: () => void }): SlashItem[] {
  return [
    { id: 'h1', label: 'Heading 1', hint: '#', run: e => e.chain().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', hint: '##', run: e => e.chain().toggleHeading({ level: 2 }).run() },
    { id: 'h3', label: 'Heading 3', hint: '###', run: e => e.chain().toggleHeading({ level: 3 }).run() },
    { id: 'task', label: 'Task list', hint: '[ ]', run: e => e.chain().toggleTaskList().run() },
    { id: 'bullet', label: 'Bulleted list', hint: '-', run: e => e.chain().toggleBulletList().run() },
    { id: 'number', label: 'Numbered list', hint: '1.', run: e => e.chain().toggleOrderedList().run() },
    { id: 'quote', label: 'Quote', hint: '>', run: e => e.chain().toggleBlockquote().run() },
    { id: 'callout', label: 'Callout', run: e => e.chain().toggleBlockquote().insertContent('[!note] ').run() },
    { id: 'code', label: 'Code block', hint: '```', run: e => e.chain().toggleCodeBlock().run() },
    { id: 'table', label: 'Table', run: e => e.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'divider', label: 'Divider', hint: '---', run: e => e.chain().setHorizontalRule().run() },
    { id: 'drawing', label: 'Drawing', run: () => extra.drawing() },
    { id: 'image', label: 'Image…', run: () => extra.image() },
  ];
}

export const SlashCommands = Extension.create<{ items: () => SlashItem[] }>({
  name: 'slashCommands',
  addOptions() { return { items: () => [] }; },
  addProseMirrorPlugins() {
    const getItems = this.options.items;
    return [Suggestion<SlashItem>({
      editor: this.editor,
      pluginKey: new PluginKey('slashCommands'),
      char: '/',
      startOfLine: false,
      allowSpaces: false,
      items: ({ query }) => getItems().filter(i => i.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
      command: ({ editor, range, props }) => {
        editor.chain().focus().deleteRange(range).run();
        props.run(editor);
      },
      render: popupRenderer<SlashItem>(),
    })];
  },
});

/** Set / replace / clear an `@due(...)`, `@remind(...)` or `@flag` token on the paragraph holding the cursor. */
export function setTaskToken(editor: Editor, kind: 'due' | 'remind' | 'flag', value: string | null): void {
  const { state } = editor;
  const $from = state.selection.$from;
  let depth = $from.depth;
  while (depth > 0 && $from.node(depth).type.name !== 'paragraph') depth--;
  if (depth === 0) return;
  const start = $from.start(depth);
  const node = $from.node(depth);
  const text = node.textContent;
  const re = kind === 'flag' ? /\s*@flag\b/ : new RegExp(`\\s*@${kind}\\([^)]*\\)`);
  const m = re.exec(text);
  const tr = state.tr;
  if (m) tr.delete(start + m.index, start + m.index + m[0].length);
  if (value !== null) {
    const token = kind === 'flag' ? ' @flag' : ` @${kind}(${value})`;
    tr.insertText(token, tr.mapping.map(start + node.content.size));
  }
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function currentTaskTokens(editor: Editor): { inTask: boolean; due?: string; remind?: string; flag: boolean } {
  const $from = editor.state.selection.$from;
  let inTask = false;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'taskItem') inTask = true;
  const text = $from.parent.textContent;
  return {
    inTask,
    due: /@due\(([^)]+)\)/.exec(text)?.[1],
    remind: /@remind\(([^)]+)\)/.exec(text)?.[1],
    flag: /@flag\b/.test(text),
  };
}

// A bullet list directly followed by a checklist (or the reverse) would merge into one list when read back as
// Markdown because both use the same marker. Alternate the marker when the previous sibling is the other kind.
type Serializer = { renderList(node: unknown, indent: string, first: () => string): void };
type Parent = { child(i: number): { type: { name: string } } } | null;
const prevName = (parent: Parent, index: number) => (parent && index > 0 ? parent.child(index - 1).type.name : '');

export const MarkdownBulletList = BulletList.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: Serializer, node: unknown, parent: Parent, index: number) {
          const m = prevName(parent, index) === 'taskList' ? '*' : '-';
          state.renderList(node, '  ', () => `${m} `);
        },
        parse: {},
      },
    };
  },
});

export const MarkdownTaskList = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: Serializer, node: unknown, parent: Parent, index: number) {
          const m = prevName(parent, index) === 'bulletList' ? '*' : '-';
          state.renderList(node, '  ', () => `${m} `);
        },
        parse: {
          setup(md: { use(p: unknown): void }) { md.use(taskListPlugin); },
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('.contains-task-list').forEach(list => list.setAttribute('data-type', 'taskList'));
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- tables that survive Markdown
// A table cell holds one paragraph. A cell with two blocks has no Markdown form and the serializer
// would write the literal text "[table]" over the whole table, losing it on the next save.
export const SingleParagraphCell = TableCell.extend({ content: 'paragraph' });
export const SingleParagraphHeader = TableHeader.extend({ content: 'paragraph' });

/** Enter moves to the next cell (a new row after the last one); Mod-Enter leaves the table below. */
export const TableKeys = Extension.create({
  name: 'tableKeys',
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (!editor.isActive('table')) return false;
        if (editor.commands.goToNextCell()) return true;
        return editor.chain().addRowAfter().goToNextCell().run();
      },
      'Mod-Enter': ({ editor }) => {
        if (!editor.isActive('table')) return false;
        const { state, view } = editor;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name !== 'table') continue;
          const pos = $from.after(d);
          const para = state.schema.nodes.paragraph.create();
          const tr = state.tr.insert(pos, para);
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
          view.dispatch(tr.scrollIntoView());
          return true;
        }
        return false;
      },
    };
  },
});

// ---------------------------------------------------------------- next-words suggestion ("ghost text")
export interface GhostOptions {
  enabled: () => boolean;
  delay: () => number;
  /** the continuation for the text around the cursor, or '' */
  suggest: (ctx: { before: string; after: string }, signal: AbortSignal) => Promise<string>;
}
type Ghost = { text: string; pos: number } | null;
const ghostKey = new PluginKey<Ghost>('ergoGhost');

export const GhostText = Extension.create<GhostOptions>({
  name: 'ghostText',
  addOptions() { return { enabled: () => false, delay: () => 400, suggest: async () => '' }; },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: ghostKey,
      state: {
        init: (): Ghost => null,
        apply(tr, prev): Ghost {
          const meta = tr.getMeta(ghostKey) as Ghost | undefined;
          if (meta !== undefined) return meta;
          // any edit or cursor move drops the suggestion
          return tr.docChanged || tr.selectionSet ? null : prev;
        },
      },
      props: {
        decorations(state) {
          const g = ghostKey.getState(state);
          if (!g) return null;
          const el = document.createElement('span');
          el.className = 'ghost-text';
          el.textContent = g.text;
          el.setAttribute('aria-hidden', 'true');
          el.dataset.ghost = '1';
          return DecorationSet.create(state.doc, [Decoration.widget(g.pos, el, { side: 1, key: 'ghost' })]);
        },
        handleKeyDown(view, e) {
          const g = ghostKey.getState(view.state);
          if (!g) return false;
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            view.dispatch(view.state.tr.setMeta(ghostKey, null).insertText(g.text, g.pos));
            return true;
          }
          if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(ghostKey, null)); return true; }
          return false;
        },
        handleDOMEvents: {
          // touch screens have no Tab key: tapping the grey text accepts it
          mousedown(view, e) {
            const g = ghostKey.getState(view.state);
            if (!g || !(e.target as HTMLElement).closest?.('[data-ghost]')) return false;
            e.preventDefault();
            view.dispatch(view.state.tr.setMeta(ghostKey, null).insertText(g.text, g.pos));
            return true;
          },
        },
      },
      view() {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let ctl: AbortController | null = null;
        const cancel = () => { if (timer) clearTimeout(timer); timer = null; ctl?.abort(); ctl = null; };
        return {
          update(view, prev) {
            if (view.state.doc === prev.doc && view.state.selection.eq(prev.selection)) return;
            cancel();
            if (!opts.enabled() || !view.editable || !view.hasFocus() || view.composing) return;
            const { selection, doc } = view.state;
            if (!selection.empty) return;
            const $p = selection.$from;
            // only at the end of a line of prose: not in code, and not in the middle of a sentence
            if (!$p.parent.isTextblock || $p.parent.type.spec.code || $p.parentOffset !== $p.parent.content.size) return;
            const before = doc.textBetween(Math.max(0, $p.pos - 1500), $p.pos, '\n', ' ');
            if (before.trim().length < 12) return;
            const pos = $p.pos;
            timer = setTimeout(() => {
              timer = null;
              const c = new AbortController();
              ctl = c;
              void opts.suggest({ before, after: '' }, c.signal).then(text => {
                if (c.signal.aborted || !text) return;
                // still the same place? (the document may have moved on while the request was out)
                if (view.state.selection.from !== pos || !view.state.selection.empty) return;
                view.dispatch(view.state.tr.setMeta(ghostKey, { text, pos }));
              }, () => { /* a failed suggestion is silent: the chat panel is where errors are shown */ });
            }, opts.delay());
          },
          destroy: cancel,
        };
      },
    })];
  },
});
