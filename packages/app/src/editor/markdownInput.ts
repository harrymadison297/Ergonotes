// Typing Markdown in the editor: what is written by hand becomes the element, the same one the Insert menu makes.
//
//   [text](address)        a link            (also `[text](address "title")`)
//   $x^2$                  an inline formula
//   @date(2026-10-20)      a date mention
//   | a | b |  then  |---|---|   and Enter      a table (the first line is its header)
//   $$  and Enter          a formula block
//
// A link needs no dialog. The Link button and the "/" item put the Markdown into the note ready to fill in
// (`[text]()` with `text` selected, Tab moves into the brackets), and it turns into the link as soon as the person
// types `)` or moves away. On a link, the same button shows its Markdown again so the address can be edited as text.
import { Extension, InputRule, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Mark } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** `[label](address)` or `[label](address "title")`, whole. */
const WHOLE = /^\[([^\[\]\n]*)\]\(([^()\s]*)(?:\s+"([^"\n]*)")?\)$/;
/** a link being filled in: the brackets are there, what is in them may still be unfinished (`[text](https://a.b "ti)`) */
const LOOSE = /^\[[^\[\]\n]*\]\([^()\n]*\)$/;
/** the same, ending at the cursor: what is matched while typing the closing `)` */
const TYPED = /(?<![!\\])\[([^\[\]\n]+)\]\(([^()\s]+)(?:\s+"([^"\n]*)")?\)$/;

export interface MarkdownLink { label: string; href: string; title?: string }

/** The pieces of a complete Markdown link, or null when the text is not one or has no label or address yet. */
export function parseMarkdownLink(text: string): MarkdownLink | null {
  const m = WHOLE.exec(text);
  if (!m || !m[1].trim() || !m[2]) return null;
  return { label: m[1], href: cleanHref(m[2]), ...(m[3] ? { title: m[3] } : {}) };
}

/** `www.example.com` is a web address even without the scheme; anything else (a note's path, `#top`, `mailto:`) stays as written. */
export function cleanHref(raw: string): string {
  return /^www\./i.test(raw) ? `https://${raw}` : raw;
}

/** The text of a link as the Markdown a person would type, for showing it again to be edited. */
export function linkMarkdown(label: string, href: string, title?: string | null): string {
  return `[${label.replace(/[\[\]\n]/g, ' ')}](${href}${title ? ` "${title}"` : ''})`;
}

/** the cells of a `| a | b |` line, or null when it is not one */
export function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.includes('|')) return null;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return cells.length >= 1 && cells.some(Boolean) ? cells : null;
}
/** `|---|:--:|`: the line under a table's header */
export const isTableRule = (line: string): boolean => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim()) && line.includes('-');

type Range = { from: number; to: number };
const key = new PluginKey<Range | null>('markdownLink');

/** the Markdown being filled in, if there is one and it is still whole in the document */
function pendingOf(state: EditorState): Range | null {
  const r = key.getState(state);
  if (!r || r.from >= r.to || r.to > state.doc.content.size) return null;
  return r;
}

const textAt = (state: EditorState, r: Range) => state.doc.textBetween(r.from, r.to, '\n', '\n');

/** Replace the Markdown in `r` by the link it spells; false when it does not spell one yet. */
function finish(view: EditorView, r: Range): boolean {
  const link = parseMarkdownLink(textAt(view.state, r));
  const { state } = view;
  const mark = state.schema.marks.link;
  if (!link || !mark) return false;
  const tr = state.tr;
  const text = state.schema.text(link.label, [mark.create({ href: link.href, ...(link.title ? { title: link.title } : {}) })]);
  tr.replaceWith(r.from, r.to, text);
  tr.setMeta(key, null);
  tr.setSelection(TextSelection.create(tr.doc, r.from + link.label.length));
  tr.setStoredMarks([]);
  view.dispatch(tr);
  return true;
}

/** The text around `pos` that carries `link`: from the first to the last piece of it. */
function linkRun(state: EditorState, pos: number, link: Mark): Range {
  const run: Range = { from: pos, to: pos };
  for (;;) {
    const prev = state.doc.resolve(run.from).nodeBefore;
    if (!prev?.isText || !link.isInSet(prev.marks)) break;
    run.from -= prev.nodeSize;
  }
  for (;;) {
    const next = state.doc.resolve(run.to).nodeAfter;
    if (!next?.isText || !link.isInSet(next.marks)) break;
    run.to += next.nodeSize;
  }
  return run;
}

/** Start filling in a link: `[selected text]()` or `[text]()` put into the note as plain text, ready to be completed. */
export function startMarkdownLink(editor: Editor): void {
  const { state, view } = editor;
  const { from, to, empty } = state.selection;
  const linkMark = state.schema.marks.link;
  let tr: Transaction = state.tr;
  // on a link: show its Markdown, address selected
  const here = empty ? state.selection.$from.marks().find(m => m.type === linkMark) : undefined;
  if (here) {
    const run = linkRun(state, from, here);
    const label = state.doc.textBetween(run.from, run.to);
    const href = String(here.attrs.href ?? '');
    const md = linkMarkdown(label, href, here.attrs.title as string | null | undefined);
    tr.replaceWith(run.from, run.to, state.schema.text(md));
    const urlFrom = run.from + label.length + 3;
    tr.setSelection(TextSelection.create(tr.doc, urlFrom, urlFrom + href.length));
    tr.setMeta(key, { from: run.from, to: run.from + md.length });
    view.dispatch(tr.scrollIntoView());
    view.focus();
    return;
  }
  const picked = empty ? '' : state.doc.textBetween(from, to, ' ');
  const label = picked.replace(/[\[\]\n]/g, ' ').trim();
  const md = `[${label || 'text'}]()`;
  tr.replaceWith(from, to, state.schema.text(md));
  if (label) tr.setSelection(TextSelection.create(tr.doc, from + label.length + 3));
  else tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + 'text'.length));
  tr.setMeta(key, { from, to: from + md.length });
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

export const MarkdownInput = Extension.create({
  name: 'markdownInput',

  addInputRules() {
    const linkType = this.editor.schema.marks.link;
    const mathType = this.editor.schema.nodes.mathInline;
    const dateType = this.editor.schema.nodes.dateMention;
    const rules: InputRule[] = [];
    if (linkType) {
      rules.push(new InputRule({
        find: TYPED,
        handler: ({ state, range, match }) => {
          if (state.doc.resolve(range.from).marks().some(m => m.type.spec.code)) return null;
          if (state.doc.resolve(range.from).parent.type.spec.code) return null;
          const link = parseMarkdownLink(match[0].slice(match[0].indexOf('[')));
          if (!link) return null;
          const start = range.from + match[0].indexOf('[');
          // the `)` the editor put in when `(` was typed is still there after the cursor: it goes with the link
          const pending = pendingOf(state);
          const end = pending && pending.to === range.to + 1 && state.doc.textBetween(range.to, range.to + 1) === ')' ? range.to + 1 : range.to;
          const text = state.schema.text(link.label, [linkType.create({ href: link.href, ...(link.title ? { title: link.title } : {}) })]);
          state.tr.replaceWith(start, end, text).setStoredMarks([]).setMeta(key, null);
        },
      }));
    }
    if (mathType) {
      // Pandoc's rule, as when a note is read: no space inside the dollars, no digit right after the closing one ("$5 and $6" stays prose)
      rules.push(new InputRule({
        find: /(?<![\\$\w])\$([^\s$](?:[^$\n]*[^\s$\\])?)\$$/,
        handler: ({ state, range, match }) => {
          if (state.doc.resolve(range.from).parent.type.spec.code) return null;
          state.tr.replaceWith(range.from, range.to, mathType.create({ latex: match[1] }));
        },
      }));
    }
    if (dateType) {
      rules.push(new InputRule({
        find: /@date\((\d{4}-\d{2}-\d{2})\)$/,
        handler: ({ state, range, match }) => {
          if (state.doc.resolve(range.from).parent.type.spec.code) return null;
          state.tr.replaceWith(range.from, range.to, [dateType.create({ date: match[1] }), state.schema.text(' ')]);
        },
      }));
    }
    return rules;
  },

  // before the lists' and tables' own Enter: it answers only to the two lines above and otherwise lets it through
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        const para = $from.parent;
        if (!empty || para.type.name !== 'paragraph' || $from.parentOffset !== para.content.size) return false;
        const text = para.textContent.trim();
        const depth = $from.depth - 1;
        const holder = $from.node(depth);
        const index = $from.index(depth);
        const { mathBlock, table, tableRow, tableHeader, tableCell, paragraph } = state.schema.nodes;
        if (text === '$$' && mathBlock && holder.canReplaceWith(index, index + 1, mathBlock)) {
          return editor.chain().command(({ tr }) => { tr.replaceWith($from.before(), $from.after(), mathBlock.create()); return true; }).run();
        }
        const prev = index > 0 ? holder.child(index - 1) : null;
        if (table && isTableRule(text) && prev?.type === paragraph && holder.canReplaceWith(index - 1, index + 1, table)) {
          const head = tableCells(prev.textContent);
          const rule = text.replace(/^\|/, '').replace(/\|$/, '').split('|');
          if (!head || head.length !== rule.length) return false;
          const cell = (type: typeof tableCell, t: string) => type.create(null, paragraph.create(null, t ? state.schema.text(t) : undefined));
          const node = table.create(null, [
            tableRow.create(null, head.map(h => cell(tableHeader, h))),
            tableRow.create(null, head.map(() => cell(tableCell, ''))),
          ]);
          const from = $from.before() - prev.nodeSize;
          return editor.chain().command(({ tr }) => {
            tr.replaceWith(from, $from.after(), node);
            // the caret goes to the first cell of the empty row
            const rowStart = from + 1 + node.child(0).nodeSize;
            tr.setSelection(TextSelection.create(tr.doc, rowStart + 3));
            return true;
          }).run();
        }
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin<Range | null>({
      key,
      state: {
        init: () => null,
        apply(tr, prev) {
          const meta = tr.getMeta(key) as Range | null | undefined;
          if (meta !== undefined) return meta;
          if (!prev || !tr.docChanged) return prev;
          const from = tr.mapping.map(prev.from, 1);
          const to = tr.mapping.map(prev.to, -1);
          return from < to ? { from, to } : null;
        },
      },
      // the person has gone elsewhere: what was being filled in becomes the link, or stays plain text when it is not one
      appendTransaction(trs, _old, state) {
        const r = pendingOf(state);
        if (!r || !trs.some(t => t.docChanged || t.selectionSet)) return null;
        if (!LOOSE.test(textAt(state, r))) return state.tr.setMeta(key, null);
        const { from, to } = state.selection;
        // inside the brackets the person is still writing; at either edge or beyond, they have moved on
        if (from > r.from && to < r.to) return null;
        const link = parseMarkdownLink(textAt(state, r));
        const mark = state.schema.marks.link;
        if (!link || !mark) return state.tr.setMeta(key, null);
        const tr = state.tr.replaceWith(r.from, r.to, state.schema.text(link.label, [mark.create({ href: link.href, ...(link.title ? { title: link.title } : {}) })]));
        // the caret keeps its place after the text that came before it
        const shift = link.label.length - (r.to - r.from);
        const at = (p: number) => (p >= r.to ? p + shift : p);
        tr.setSelection(TextSelection.create(tr.doc, at(from), at(to)));
        return tr.setMeta(key, null);
      },
      props: {
        handleTextInput(view, from, to, text) {
          const { state } = view;
          const r = pendingOf(state);
          // `)` where the closing bracket already is: that finishes the link
          if (text === ')' && r && from === to && from === r.to - 1 && state.doc.textBetween(from, from + 1) === ')') {
            // with no address yet there is no link: the caret just steps over the bracket
            if (!finish(view, r)) view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, r.to)).setMeta(key, null));
            return true;
          }
          // `(` straight after `[text]`: the closing bracket is put in, and the link is filled in between
          if (text === '(' && from === to && !state.doc.resolve(from).parent.type.spec.code) {
            const $f = state.doc.resolve(from);
            const before = $f.parent.textBetween(Math.max(0, $f.parentOffset - 200), $f.parentOffset, undefined, '￼');
            const m = /(?<![!\\])\[([^\[\]\n]+)\]$/.exec(before);
            if (!m || $f.marks().some(mk => mk.type.spec.code)) return false;
            const tr = state.tr.insertText('()', from, to);
            tr.setSelection(TextSelection.create(tr.doc, from + 1));
            tr.setMeta(key, { from: from - m[0].length, to: from + 2 });
            view.dispatch(tr);
            return true;
          }
          return false;
        },
        handleKeyDown(view, e) {
          const r = pendingOf(view.state);
          if (!r || e.ctrlKey || e.metaKey || e.altKey) return false;
          const { from, to } = view.state.selection;
          if (from < r.from || to > r.to) return false;
          const md = textAt(view.state, r);
          const open = md.indexOf('](');
          if (open < 0) return false;
          const urlFrom = r.from + open + 2;
          // Tab: from the text into the brackets, from the brackets out of the link
          if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            if (from < urlFrom - 1) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, urlFrom, r.to - 1))); return true; }
            if (finish(view, r)) return true;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, r.to)).setMeta(key, null));
            return true;
          }
          if (e.key === 'Enter' && from >= urlFrom) { e.preventDefault(); return finish(view, r) || true; }
          if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(key, null)); return true; }
          return false;
        },
      },
    })];
  },
});
