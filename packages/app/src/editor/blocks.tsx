// The elements of the Insert menu that have no CommonMark form of their own. Each one stores itself in the note's
// Markdown in a plain, readable shape (docs/adr/0009) so a note stays a text file other tools can read:
//
//   toggle        :::toggle Title … :::        (blocks inside, nesting allowed)
//   contents      [TOC]
//   page break    \newpage
//   date          @date(2026-10-20)
//   checkbox      ☐ / ☑
//   formula       $x^2$   and   $$ … $$
//   diagram       ```mermaid … ```
//   voice note    [Voice note 0:42](ergo-file:<id> "audio")
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import CodeBlock from '@tiptap/extension-code-block';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Pause, Play, Trash2 } from 'lucide-react';
import type MarkdownIt from 'markdown-it';
import { getApi } from '../state/appRef';

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
  addAttributes() { return { summary: { default: '' } }; },
  parseHTML() {
    return [{ tag: 'details[data-toggle]', getAttrs: el => ({ summary: (el as HTMLElement).getAttribute('data-summary') ?? '' }), contentElement: 'div[data-toggle-body]' }];
  },
  renderHTML({ node }) {
    return ['details', { 'data-toggle': '1', 'data-summary': node.attrs.summary }, ['div', { 'data-toggle-body': '' }, 0]];
  },
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { summary: string } }) {
          state.write(`:::toggle ${String(node.attrs.summary).replace(/\s+/g, ' ').trim()}\n`);
          state.renderContent(node);
          state.ensureNewLine();
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleBlock = (state, startLine, endLine, silent) => {
              if (state.sCount[startLine] - state.blkIndent >= 4) return false;
              const m = /^:::toggle(?:[ \t]+(.*))?[ \t]*$/.exec(lineOf(state, startLine));
              if (!m) return false;
              if (silent) return true;
              let depth = 1, next = startLine + 1;
              for (; next < endLine; next++) {
                const line = lineOf(state, next);
                if (/^:::toggle\b/.test(line)) depth++;
                else if (/^:::[ \t]*$/.test(line) && --depth === 0) break;
              }
              const closed = next < endLine;
              const open = state.push('html_block', '', 0);
              open.content = `<details data-toggle="1" data-summary="${esc((m[1] ?? '').trim())}"><div data-toggle-body="">\n`;
              open.map = [startLine, next];
              const s = state as unknown as { parentType: string };
              const parentType = s.parentType, lineMax = state.lineMax;
              s.parentType = 'container';
              state.lineMax = next;
              state.md.block.tokenize(state, startLine + 1, next);
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

// ---------------------------------------------------------------- contents (table of contents of this note)
function tocOf(editor: Editor) {
  const out: { pos: number; level: number; text: string }[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'heading' && n.textContent.trim()) out.push({ pos, level: Number(n.attrs.level) || 1, text: n.textContent });
  });
  return out;
}
function TocView({ editor }: NodeViewProps) {
  const [heads, setHeads] = useState(() => tocOf(editor));
  useEffect(() => {
    const on = () => setHeads(tocOf(editor));
    editor.on('update', on);
    return () => { editor.off('update', on); };
  }, [editor]);
  const min = Math.min(...heads.map(h => h.level), 3);
  return (
    <NodeViewWrapper className="toc-block" contentEditable={false}>
      <div className="toc-title">Contents</div>
      {heads.length === 0 ? <p className="hint">Headings you add to this note show up here.</p> : (
        <ul>
          {heads.map((h, i) => (
            <li key={i} style={{ paddingLeft: (h.level - min) * 16 }}>
              <button type="button" onClick={() => {
                (editor.view.nodeDOM(h.pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                editor.commands.setTextSelection(h.pos + 1);
              }}>{h.text}</button>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}
export const Contents = Node.create({
  name: 'contents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() { return [{ tag: 'div[data-toc]' }]; },
  renderHTML() { return ['div', { 'data-toc': '1' }]; },
  addNodeView() { return ReactNodeViewRenderer(TocView); },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: unknown) { state.write('[TOC]'); state.closeBlock(node); },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll('p').forEach(p => {
              if (p.textContent?.trim() !== '[TOC]') return;
              const d = document.createElement('div');
              d.setAttribute('data-toc', '1');
              p.replaceWith(d);
            });
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
        serialize(state: Out, node: unknown) { state.write('\\newpage'); state.closeBlock(node); },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll('p').forEach(p => {
              if (p.textContent?.trim() !== '\\newpage') return;
              const d = document.createElement('div');
              d.setAttribute('data-pagebreak', '1');
              p.replaceWith(d);
            });
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
          {err ? <p className="error-text" role="alert">{err}</p> : svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="hint">Empty diagram</p>}
        </div>
      )}
      <pre style={isDiagram && !editing ? { display: 'none' } : undefined}><NodeViewContent as="code" /></pre>
      {isDiagram && editing && source.trim() !== '' && (
        <div className="diagram-out live" contentEditable={false}>
          {err ? <p className="error-text" role="alert">{err}</p> : svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : null}
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
function AudioView({ node, selected }: NodeViewProps) {
  const id = String(node.attrs.file);
  const [url, setUrl] = useState<string | null>(audioUrls.get(id) ?? null);
  const [playing, setPlaying] = useState(false);
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (url) return;
    let live = true;
    void getApi()?.getFile(id).then(f => {
      if (!f || !live) return;
      const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      const u = URL.createObjectURL(new Blob([bytes], { type: f.mime }));
      audioUrls.set(id, u);
      setUrl(u);
    });
    return () => { live = false; };
  }, [id, url]);
  const toggle = () => { const a = el.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  return (
    <NodeViewWrapper className={`audio-clip${selected ? ' ProseMirror-selectednode' : ''}`} contentEditable={false} data-drag-handle>
      <button type="button" className="icon-btn primary" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} disabled={!url}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <span className="audio-label">{String(node.attrs.label || 'Voice note')}</span>
      {url ? <audio ref={el} src={url} controls preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        : <span className="hint">Loading…</span>}
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
          state.write(`[${String(node.attrs.label).replace(/[\[\]\n]/g, ' ')}](ergo-file:${node.attrs.file} "audio")`);
          state.closeBlock(node);
        },
        parse: {
          updateDOM(root: HTMLElement) {
            root.querySelectorAll('p > a[title="audio"][href^="ergo-file:"]').forEach(a => {
              const p = a.parentElement!;
              if (p.childNodes.length !== 1) return;
              const d = document.createElement('div');
              d.setAttribute('data-audio', (a.getAttribute('href') ?? '').slice('ergo-file:'.length));
              d.setAttribute('data-label', a.textContent ?? 'Voice note');
              p.replaceWith(d);
            });
          },
        },
      },
    };
  },
});
