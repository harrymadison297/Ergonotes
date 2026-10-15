import { Extension, Node, type Editor } from '@tiptap/core';
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
import { linkTo } from '../state/noteCtx';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
const TOKEN_RE = /@(due|remind)\(([^)]+)\)|@flag\b|@event\([^)]*\)/g;
export const InlineDecorations = Extension.create({
  name: 'inlineDecorations',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('inlineDecorations'),
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          const now = Date.now();
          state.doc.descendants((node, pos, parent) => {
            if (node.type.name === 'blockquote') {
              const first = node.firstChild?.textContent ?? '';
              if (/^\[![a-z]+\]/i.test(first)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'callout' }));
            }
            if (!node.isText || !node.text) return;
            if (parent?.type.name === 'codeBlock' || node.marks.some(mk => mk.type.name === 'code' || mk.type.name === 'link')) return;
            TOKEN_RE.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = TOKEN_RE.exec(node.text))) {
              const overdue = m[1] === 'due' && parseDue(m[2]) < now;
              const kind = m[0].startsWith('@event') ? ' event' : overdue ? ' overdue' : '';
              decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: `task-meta${kind}` }));
            }
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    })];
  },
});

// ---------------------------------------------------------------- a paragraph always waits below the last block
// After a table, a diagram, a formula or a divider the caret has nowhere to go; this keeps one empty paragraph there.
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('trailingParagraph'),
      appendTransaction(_trs, _old, state) {
        const last = state.doc.lastChild;
        if (!last || last.type.name === 'paragraph') return null;
        return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
      },
    })];
  },
});

// ---------------------------------------------------------------- [[ link picker and / commands
export interface LinkItem extends PopupItem { noteId: string; path: string }
/** `[[` + a few letters: pick a note; what is written is a standard Markdown link to its file. */
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
        return r.map(x => ({ id: x.id, noteId: x.id, label: x.title, path: x.path }));
      },
      command: ({ editor, range, props }) => {
        const href = linkTo(props.path);
        editor.chain().focus().insertContentAt(range, [{ type: 'text', text: props.label, marks: [{ type: 'link', attrs: { href } }] }, { type: 'text', text: ' ' }]).run();
      },
      render: popupRenderer<LinkItem>(),
    })];
  },
});

export interface SlashItem extends PopupItem { run: (e: Editor) => void; keywords?: string; off?: boolean }
export function slashItems(source: () => { id: string; label: string; hint?: string; keywords?: string; off?: boolean; run: () => void }[]): SlashItem[] {
  return source().map(i => ({ id: i.id, label: i.label, hint: i.hint, keywords: i.keywords, off: i.off, run: () => i.run() }));
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
      items: ({ query }) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const q = words.join(' ');
        // a name that starts with what was typed first, then one that contains it, then a match on the extra words
        const rank = (i: SlashItem) => { const l = i.label.toLowerCase(); return l.startsWith(q) ? 0 : l.includes(q) ? 1 : 2; };
        return getItems().filter(i => !i.off && words.every(w => `${i.label} ${i.keywords ?? ''}`.toLowerCase().includes(w))).sort((a, b) => rank(a) - rank(b)).slice(0, 14);
      },
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
/** schedules a suggestion for the editor's current state (also used when an IME composition ends) */
const ghostPoke = new WeakMap<object, () => void>();

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
          // typing with an input method: the text is only settled when the composition ends
          compositionend(view) { setTimeout(() => ghostPoke.get(view)?.(), 0); return false; },
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
        const run = (view: import('@tiptap/pm/view').EditorView) => {
            cancel();
            if (!opts.enabled() || !view.editable || !view.hasFocus() || view.composing) return;
            const { selection, doc } = view.state;
            if (!selection.empty) return;
            const $p = selection.$from;
            // only at the end of a line of prose: not in code, and not in the middle of a sentence
            if (!$p.parent.isTextblock || $p.parent.type.spec.code || $p.parentOffset !== $p.parent.content.size) return;
            const before = doc.textBetween(Math.max(0, $p.pos - 1500), $p.pos, '\n', ' ');
            const after = doc.textBetween($p.pos, Math.min(doc.content.size, $p.pos + 400), '\n', ' ');
            if (before.trim().length < 3) return;
            const pos = $p.pos;
            timer = setTimeout(() => {
              timer = null;
              const c = new AbortController();
              ctl = c;
              void opts.suggest({ before, after }, c.signal).then(text => {
                if (c.signal.aborted || !text) return;
                // still the same place? (the document may have moved on while the request was out)
                if (view.state.selection.from !== pos || !view.state.selection.empty) return;
                view.dispatch(view.state.tr.setMeta(ghostKey, { text, pos }));
              }, () => { /* the editor's footer shows why a suggestion failed */ });
            }, opts.delay());
        };
        return {
          update(view, prev) {
            ghostPoke.set(view, () => run(view));
            if (view.state.doc === prev.doc && view.state.selection.eq(prev.selection)) return;
            run(view);
          },
          destroy: cancel,
        };
      },
    })];
  },
});
