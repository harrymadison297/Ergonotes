// The elements of the Insert menu that have no CommonMark form of their own. Each one stores itself in the note's
// Markdown in a plain, standard shape (docs/adr/0009, 0010) so a note stays a text file other tools can read:
//
//   toggle        <details><summary>Title</summary> … </details>     (blocks inside, nesting allowed)
//   page break    <div style="page-break-after: always;"></div>
//   date          @date(2026-10-20)
//   checkbox      ☐ / ☑
//   formula       $x^2$   and   $$ … $$
//   diagram       ```mermaid … ```
//   voice note    [Voice note 0:42](attachments/Voice note.webm "audio")
// The table of contents is not stored: the app computes it from the headings when it is opened.
import { Node, mergeAttributes } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, ChevronRight, Trash2 } from 'lucide-react';
import type MarkdownIt from 'markdown-it';
import { getApi } from '../state/appRef';
import { vaultPathsOf } from '../state/noteCtx';

type RuleBlock = Parameters<MarkdownIt['block']['ruler']['push']>[1];
type RuleInline = Parameters<MarkdownIt['inline']['ruler']['push']>[1];
type Out = { write(s: string): void; ensureNewLine(): void; closeBlock(n: unknown): void; renderContent(n: unknown): void };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lineOf = (state: Parameters<RuleBlock>[0], n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);

// ---------------------------------------------------------------- toggle
function ToggleView({ node, updateAttributes, editor, getPos, deleteNode }: NodeViewProps) {
  const [open, setOpen] = useState(true);
  const editable = editor.isEditable;
  const toBody = () => { setOpen(true); const p = getPos(); if (typeof p === 'number') { editor.commands.setTextSelection(p + 2); editor.view.focus(); } };
  return (
    <NodeViewWrapper className={`toggle-block${open ? ' open' : ''}`}>
      <div className="toggle-head" contentEditable={false}>
        <button type="button" className="toggle-arrow" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => setOpen(o => !o)}><ChevronRight size={16} /></button>
        <input className="toggle-title" aria-label="Toggle title" placeholder="Toggle title" value={String(node.attrs.summary ?? '')} readOnly={!editable}
          onChange={e => updateAttributes({ summary: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); toBody(); } }} />
        {editable && <button type="button" className="toggle-del" aria-label="Remove toggle (keeps its content)" title="Remove toggle (keeps its content)"
          onClick={() => {
            // unwrap: the toggle goes, what was inside stays
            const p = getPos();
            if (typeof p !== 'number') { deleteNode(); return; }
            editor.chain().focus().command(({ tr, state }) => {
              const n = state.doc.nodeAt(p);
              if (!n) return false;
              tr.replaceWith(p, p + n.nodeSize, n.content);
              return true;
            }).run();
          }}><Trash2 size={14} /></button>}
      </div>
      <NodeViewContent className="toggle-body" style={open ? undefined : { display: 'none' }} />
    </NodeViewWrapper>
  );
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  // a click on the title bar must put the caret there, never select (and then replace) the whole toggle
  selectable: false,
  addAttributes() { return { summary: { default: '' }, open: { default: false } }; },
  parseHTML() {
    return [{ tag: 'details[data-toggle]', getAttrs: el => ({ summary: (el as HTMLElement).getAttribute('data-summary') ?? '', open: (el as HTMLElement).getAttribute('data-open') === '1' }), contentElement: 'div[data-toggle-body]' }];
  },
  renderHTML({ node }) {
    return ['details', { 'data-toggle': '1', 'data-summary': node.attrs.summary, 'data-open': node.attrs.open ? '1' : '0' }, ['div', { 'data-toggle-body': '' }, 0]];
  },
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { summary: string; open: boolean } }) {
          const title = String(node.attrs.summary).replace(/\s+/g, ' ').replace(/</g, '&lt;').trim();
          state.write(`<details${node.attrs.open ? ' open' : ''}>\n<summary>${title}</summary>`);
          state.closeBlock(node);
          state.renderContent(node);
          state.write('</details>');
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            const OPEN = /^<details(\s+open)?\s*>\s*(?:<summary>(.*?)<\/summary>)?\s*$/i;
            const SUMMARY = /^\s*<summary>(.*?)<\/summary>\s*$/i;
            const rule: RuleBlock = (state, startLine, endLine, silent) => {
              if (state.sCount[startLine] - state.blkIndent >= 4) return false;
              const m = OPEN.exec(lineOf(state, startLine));
              if (!m) return false;
              let summary = m[2];
              let bodyFrom = startLine + 1;
              if (summary === undefined) {
                // the title may sit on the next line
                const t = bodyFrom < endLine ? SUMMARY.exec(lineOf(state, bodyFrom)) : null;
                summary = t ? t[1] : '';
                if (t) bodyFrom++;
              }
              if (silent) return true;
              let depth = 1, next = bodyFrom;
              for (; next < endLine; next++) {
                const line = lineOf(state, next);
                if (/^<details(\s[^>]*)?>/i.test(line)) depth++;
                else if (/^<\/details>\s*$/i.test(line) && --depth === 0) break;
              }
              const closed = next < endLine;
              const plain = (summary ?? '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').trim();
              const open = state.push('html_block', '', 0);
              open.content = `<details data-toggle="1" data-open="${m[1] ? '1' : '0'}" data-summary="${esc(plain)}"><div data-toggle-body="">\n`;
              open.map = [startLine, next];
              const s = state as unknown as { parentType: string };
              const parentType = s.parentType, lineMax = state.lineMax;
              s.parentType = 'container';
              state.lineMax = next;
              state.md.block.tokenize(state, bodyFrom, next);
              s.parentType = parentType;
              state.lineMax = lineMax;
              const close = state.push('html_block', '', 0);
              close.content = '</div></details>\n';
              state.line = closed ? next + 1 : next;
              return true;
            };
            md.block.ruler.before('fence', 'ergo_toggle', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- page break
function PageBreakView() {
  return <NodeViewWrapper className="page-break" contentEditable={false}><span>Page break</span></NodeViewWrapper>;
}
const BREAK = /^<div\s+style="\s*page-break-after:\s*always;?\s*"\s*>\s*<\/div>\s*$/i;
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: 'div[data-pagebreak]' }]; },
  renderHTML() { return ['div', { 'data-pagebreak': '1' }]; },
  addNodeView() { return ReactNodeViewRenderer(PageBreakView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: unknown) { state.write('<div style="page-break-after: always;"></div>'); state.closeBlock(node); },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleBlock = (state, startLine, _endLine, silent) => {
              if (state.sCount[startLine] - state.blkIndent >= 4) return false;
              if (!BREAK.test(lineOf(state, startLine))) return false;
              if (silent) return true;
              const t = state.push('html_block', '', 0);
              t.content = '<div data-pagebreak="1"></div>\n';
              t.map = [startLine, startLine + 1];
              state.line = startLine + 1;
              return true;
            };
            md.block.ruler.before('fence', 'ergo_pagebreak', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- @date(2026-10-20)
const DATE_RE = /^@date\((\d{4}-\d{2}-\d{2})\)/;
export const formatDay = (iso: string): string => {
  const d = new Date(`${iso}T12:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};
function DateView({ node, selected }: NodeViewProps) {
  const day = String(node.attrs.date);
  return (
    <NodeViewWrapper as="span" className={`date-chip${selected ? ' ProseMirror-selectednode' : ''}`} data-date={day}
      onClick={() => window.dispatchEvent(new CustomEvent('ergo-open-day', { detail: { day } }))} title="Show this day in the calendar">
      {formatDay(day)}
    </NodeViewWrapper>
  );
}
export const DateMention = Node.create({
  name: 'dateMention',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { date: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-date-mention]', getAttrs: el => ({ date: (el as HTMLElement).getAttribute('data-date-mention') }) }]; },
  renderHTML({ node }) { return ['span', mergeAttributes({ 'data-date-mention': node.attrs.date, class: 'date-chip' }), formatDay(String(node.attrs.date))]; },
  addNodeView() { return ReactNodeViewRenderer(DateView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { date: string } }) { state.write(`@date(${node.attrs.date})`); },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleInline = (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 0x40) return false;
              const m = DATE_RE.exec(state.src.slice(state.pos));
              if (!m) return false;
              if (!silent) state.push('html_inline', '', 0).content = `<span data-date-mention="${m[1]}">${m[1]}</span>`;
              state.pos += m[0].length;
              return true;
            };
            md.inline.ruler.before('link', 'ergo_date', rule);
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- ☐ / ☑
function CheckboxView({ node, updateAttributes, editor }: NodeViewProps) {
  const on = node.attrs.checked === true;
  return (
    <NodeViewWrapper as="span" className="inline-check">
      <button type="button" role="checkbox" aria-checked={on} aria-label="Checkbox" className={on ? 'on' : ''} disabled={!editor.isEditable}
        onMouseDown={e => e.preventDefault()} onClick={() => updateAttributes({ checked: !on })}>{on ? '✓' : ''}</button>
    </NodeViewWrapper>
  );
}
export const InlineCheckbox = Node.create({
  name: 'inlineCheckbox',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { checked: { default: false } }; },
  parseHTML() { return [{ tag: 'span[data-checkbox]', getAttrs: el => ({ checked: (el as HTMLElement).getAttribute('data-checkbox') === '1' }) }]; },
  renderHTML({ node }) { return ['span', { 'data-checkbox': node.attrs.checked ? '1' : '0' }, node.attrs.checked ? '☑' : '☐']; },
  addNodeView() { return ReactNodeViewRenderer(CheckboxView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { checked: boolean } }) { state.write(node.attrs.checked ? '☑' : '☐'); },
        parse: {
          // ☐ and ☑ are ordinary characters to Markdown: turn them into boxes once the HTML exists
          updateDOM(root: HTMLElement) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const hits: Text[] = [];
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (/[\u2610\u2611]/.test(n.nodeValue ?? '') && !(n.parentElement?.closest('pre, code, [data-math-inline], [data-math-block]'))) hits.push(n as Text);
            }
            for (const t of hits) {
              const frag = document.createDocumentFragment();
              for (const part of (t.nodeValue ?? '').split(/([\u2610\u2611])/)) {
                if (part === '\u2610' || part === '\u2611') {
                  const s = document.createElement('span');
                  s.setAttribute('data-checkbox', part === '\u2611' ? '1' : '0');
                  frag.append(s);
                } else if (part) frag.append(document.createTextNode(part));
              }
              t.replaceWith(frag);
            }
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- formulas (KaTeX)
let katexReady: Promise<typeof import('katex').default> | null = null;
function loadKatex() {
  katexReady ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([k]) => k.default);
  return katexReady;
}
function Formula({ latex, display }: { latex: string; display: boolean }) {
  const [html, setHtml] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    void loadKatex().then(k => {
      if (!live) return;
      try { setHtml(k.renderToString(latex, { displayMode: display, throwOnError: true, output: 'htmlAndMathml' })); setErr(''); }
      catch (e) { setHtml(''); setErr(e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : String(e)); }
    });
    return () => { live = false; };
  }, [latex, display]);
  if (err) return <span className="math-err" title={err}>{latex || 'Formula'}</span>;
  return <span className="math-out" dangerouslySetInnerHTML={{ __html: html }} />;
}
function MathView({ node, updateAttributes, selected, editor, extension }: NodeViewProps) {
  const display = extension.name === 'mathBlock';
  const latex = String(node.attrs.latex ?? '');
  const [editing, setEditing] = useState(latex === '' && editor.isEditable);
  const [draft, setDraft] = useState(latex);
  useEffect(() => { if (!editing) setDraft(latex); }, [latex, editing]);
  const commit = () => { setEditing(false); if (draft !== latex) updateAttributes({ latex: draft }); };
  const Wrapper = display ? 'div' : 'span';
  return (
    <NodeViewWrapper as={Wrapper} className={`math ${display ? 'math-block' : 'math-inline'}${selected ? ' ProseMirror-selectednode' : ''}`} contentEditable={false}>
      {editing ? (
        <span className="math-edit">
          {display
            ? <textarea autoFocus value={draft} rows={3} aria-label="Formula (LaTeX)" placeholder="E = mc^2" onChange={e => setDraft(e.target.value)} onBlur={commit}
                onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commit(); } }} />
            : <input autoFocus value={draft} aria-label="Formula (LaTeX)" placeholder="x^2 + y^2" onChange={e => setDraft(e.target.value)} onBlur={commit}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(); } }} />}
          {draft.trim() !== '' && <span className="math-preview"><Formula latex={draft} display={display} /></span>}
        </span>
      ) : (
        <span role="button" tabIndex={0} className="math-view" aria-label="Edit formula" onClick={() => editor.isEditable && setEditing(true)}
          onKeyDown={e => { if (e.key === 'Enter' && editor.isEditable) setEditing(true); }}>
          {latex ? <Formula latex={latex} display={display} /> : <span className="math-err">Empty formula</span>}
        </span>
      )}
    </NodeViewWrapper>
  );
}

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-math-block]', getAttrs: el => ({ latex: (el as HTMLElement).getAttribute('data-math-block') ?? '' }) }]; },
  renderHTML({ node }) { return ['div', { 'data-math-block': node.attrs.latex }]; },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { latex: string } }) {
          state.write('$$\n' + String(node.attrs.latex).trim().replace(/\n{2,}/g, '\n') + '\n$$');
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleBlock = (state, startLine, endLine, silent) => {
              if (state.sCount[startLine] - state.blkIndent >= 4) return false;
              const first = lineOf(state, startLine);
              const one = /^\$\$(.+)\$\$[ \t]*$/.exec(first);
              if (!one && !/^\$\$[ \t]*$/.test(first)) return false;
              if (silent) return true;
              let latex = one ? one[1] : '';
              let next = startLine + 1;
              if (!one) {
                const parts: string[] = [];
                for (; next < endLine && !/^\$\$[ \t]*$/.test(lineOf(state, next)); next++) parts.push(lineOf(state, next));
                latex = parts.join('\n');
                next = next < endLine ? next + 1 : next;
              }
              const t = state.push('html_block', '', 0);
              t.content = `<div data-math-block="${esc(latex.trim())}"></div>\n`;
              t.map = [startLine, next];
              state.line = next;
              return true;
            };
            md.block.ruler.before('fence', 'ergo_math_block', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
          },
        },
      },
    };
  },
});

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { latex: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-math-inline]', getAttrs: el => ({ latex: (el as HTMLElement).getAttribute('data-math-inline') ?? '' }) }]; },
  renderHTML({ node }) { return ['span', { 'data-math-inline': node.attrs.latex }, node.attrs.latex]; },
  addNodeView() { return ReactNodeViewRenderer(MathView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { latex: string } }) { state.write('$' + String(node.attrs.latex).replace(/\s+/g, ' ').trim().replace(/(?<!\\)\$/g, '\\$') + '$'); },
        parse: {
          setup(md: MarkdownIt) {
            // Pandoc's rule, so "it costs $5 and $6" stays prose: no space inside the dollars, no digit right after
            const rule: RuleInline = (state, silent) => {
              const src = state.src;
              let pos = state.pos;
              if (src.charCodeAt(pos) !== 0x24 || src.charCodeAt(pos + 1) === 0x24) return false;
              const after = src.charCodeAt(pos + 1);
              if (after === 0x20 || after === 0x09 || Number.isNaN(after)) return false;
              pos += 1;
              for (;;) {
                const end = src.indexOf('$', pos);
                if (end < 0 || src.charCodeAt(end - 1) === 0x0a) return false;
                const bs = src.charCodeAt(end - 1) === 0x5c;
                const before = src.charCodeAt(end - 1);
                const next = src.charCodeAt(end + 1);
                if (bs) { pos = end + 1; continue; }
                if (before === 0x20 || before === 0x09 || (next >= 0x30 && next <= 0x39)) return false;
                const latex = src.slice(state.pos + 1, end);
                if (latex.includes('\n')) return false;
                if (!silent) state.push('html_inline', '', 0).content = `<span data-math-inline="${esc(latex)}">${esc(latex)}</span>`;
                state.pos = end + 1;
                return true;
              }
            };
            md.inline.ruler.before('escape', 'ergo_math_inline', rule);
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- ```mermaid
let mermaidReady: Promise<typeof import('mermaid').default> | null = null;
let mermaidSeq = 0;
function loadMermaid() {
  mermaidReady ??= import('mermaid').then(m => {
    m.default.initialize({ startOnLoad: false, securityLevel: 'strict', fontFamily: 'inherit' });
    return m.default;
  });
  return mermaidReady;
}
/** A diagram keeps its natural width (up to a point) and scrolls sideways in a narrow note, instead of shrinking to a smear. */
function DiagramSvg({ svg }: { svg: string }) {
  const w = Number(/max-width:\s*([\d.]+)px/.exec(svg)?.[1] ?? 0);
  return <div style={{ minWidth: w ? Math.min(w, 960) : undefined, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** A diagram drawn in the light theme for paper (the editor draws it in the app's theme, which may be the dark one). */
export async function renderDiagramLight(source: string): Promise<string | null> {
  try {
    const m = await loadMermaid();
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', fontFamily: 'inherit' });
    return (await m.render(`ergo-mermaid-${++mermaidSeq}`, source)).svg;
  } catch {
    document.getElementById(`dergo-mermaid-${mermaidSeq}`)?.remove();
    return null;
  }
}

function MermaidView({ node, editor, extension }: NodeViewProps) {
  const lang = String(node.attrs.language ?? '');
  const source = node.textContent;
  const isDiagram = lang === 'mermaid';
  const [editing, setEditing] = useState(source.trim() === '');
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  const seq = useRef(0);
  useEffect(() => {
    if (!isDiagram || !source.trim()) { setSvg(''); setErr(''); return; }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void loadMermaid().then(async m => {
        try {
          const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
          m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'inherit' });
          const r = await m.render(`ergo-mermaid-${++mermaidSeq}`, source);
          if (mine === seq.current) { setSvg(r.svg); setErr(''); }
        } catch (e) {
          if (mine === seq.current) { setSvg(''); setErr(e instanceof Error ? e.message.split('\n')[0] : 'Mermaid could not read this diagram.'); }
          document.getElementById(`dergo-mermaid-${mermaidSeq}`)?.remove();
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [isDiagram, source]);
  void extension;
  return (
    <NodeViewWrapper className={`code-block${isDiagram ? ' diagram' : ''}`}>
      {isDiagram && (
        <div className="diagram-bar" contentEditable={false}>
          <span>Mermaid diagram</span>
          {editor.isEditable && <button type="button" className="btn ghost" onClick={() => setEditing(e => !e)}>{editing ? 'Show diagram' : 'Edit source'}</button>}
        </div>
      )}
      {isDiagram && !editing && (
        <div className="diagram-out" contentEditable={false}>
          {err ? <p className="error-text" role="alert">{err}</p> : svg ? <DiagramSvg svg={svg} /> : <p className="hint">Empty diagram</p>}
        </div>
      )}
      <pre style={isDiagram && !editing ? { display: 'none' } : undefined}><NodeViewContent as="code" /></pre>
      {isDiagram && editing && source.trim() !== '' && (
        <div className="diagram-out live" contentEditable={false}>
          {err ? <p className="error-text" role="alert">{err}</p> : svg ? <DiagramSvg svg={svg} /> : null}
        </div>
      )}
    </NodeViewWrapper>
  );
}
export const CodeWithDiagrams = CodeBlock.extend({
  addNodeView() { return ReactNodeViewRenderer(MermaidView); },
});

// ---------------------------------------------------------------- voice notes and recordings
const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { fmtSecs };

const audioUrls = new Map<string, string>();
/** The bytes of an attachment named by a note: `ergo-file:<id>` or a path written in the note. */
async function loadAttachment(src: string) {
  const api = getApi();
  if (!api) return null;
  const m = /^ergo-file:([0-9a-f-]{36})$/.exec(src);
  if (m) return api.getFile(m[1]);
  for (const p of vaultPathsOf(src)) {
    const f = await api.getFileByPath(p);
    if (f) return f;
  }
  return null;
}
function AudioView({ node, selected }: NodeViewProps) {
  const src = String(node.attrs.file);
  const [url, setUrl] = useState<string | null>(audioUrls.get(src) ?? null);
  useEffect(() => {
    if (url) return;
    let live = true;
    void loadAttachment(src).then(f => {
      if (!f || !live) return;
      const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      const u = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
      audioUrls.set(src, u);
      setUrl(u);
    });
    return () => { live = false; };
  }, [src, url]);
  return (
    <NodeViewWrapper className={`audio-clip${selected ? ' ProseMirror-selectednode' : ''}`} contentEditable={false} data-drag-handle>
      <span className="audio-ico" aria-hidden><AudioLines size={18} /></span>
      <span className="audio-label">{String(node.attrs.label || 'Voice note')}</span>
      {url ? <audio src={url} controls preload="metadata" aria-label={String(node.attrs.label || 'Voice note')} /> : <span className="hint">Loading…</span>}
    </NodeViewWrapper>
  );
}
export const AudioClip = Node.create({
  name: 'audioClip',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { file: { default: '' }, label: { default: 'Voice note' } }; },
  parseHTML() {
    return [{ tag: 'div[data-audio]', getAttrs: el => ({ file: (el as HTMLElement).getAttribute('data-audio'), label: (el as HTMLElement).getAttribute('data-label') ?? 'Voice note' }) }];
  },
  renderHTML({ node }) { return ['div', { 'data-audio': node.attrs.file, 'data-label': node.attrs.label }]; },
  addNodeView() { return ReactNodeViewRenderer(AudioView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { file: string; label: string } }) {
          state.write(`[${String(node.attrs.label).replace(/[\[\]\n]/g, ' ')}](${node.attrs.file} "audio")`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll('p > a[title="audio"]').forEach(a => {
              const p = a.parentElement!;
              const href = a.getAttribute('href') ?? '';
              // a clip is a link to a file of the vault: a web address stays an ordinary link
              if (p.childNodes.length !== 1 || (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) && !href.startsWith('ergo-file:'))) return;
              const d = document.createElement('div');
              d.setAttribute('data-audio', href);
              d.setAttribute('data-label', a.textContent ?? 'Voice note');
              p.replaceWith(d);
            });
          },
        },
      },
    };
  },
});
