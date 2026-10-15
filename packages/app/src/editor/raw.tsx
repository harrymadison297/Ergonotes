// Syntax this editor does not understand but must never damage (ADR 0010): other tools' links, comments,
// footnotes, block ids and HTML. Each is an atom that shows its source and writes it back character for character.
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import type MarkdownIt from 'markdown-it';
import { FileImg } from '../components/FileImg';

type RuleBlock = Parameters<MarkdownIt['block']['ruler']['push']>[1];
type RuleInline = Parameters<MarkdownIt['inline']['ruler']['push']>[1];
type Out = { write(s: string): void; closeBlock(n: unknown): void };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lineOf = (state: Parameters<RuleBlock>[0], n: number) => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);

// ---------------------------------------------------------------- [[Note]] and [[Note#Heading|alias]]
const WIKI = /^\[\[([^\]\n|#^]*)((?:[#^][^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]/;
export function parseWiki(raw: string): { target: string; label: string } {
  const m = /^!?\[\[([^\]\n|#^]*)((?:[#^][^\]\n|]*)?)((?:\|[^\]\n]*)?)\]\]$/.exec(raw);
  if (!m) return { target: '', label: raw };
  const target = m[1].trim();
  return { target, label: m[3].slice(1).trim() || target || m[2].slice(1) };
}

export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { raw: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-wikilink]', getAttrs: el => ({ raw: (el as HTMLElement).getAttribute('data-wikilink') }) }]; },
  renderHTML({ node }) {
    const w = parseWiki(String(node.attrs.raw));
    return ['span', mergeAttributes({ 'data-wikilink': node.attrs.raw, 'data-target': w.target, class: 'wikilink' }), w.label];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { raw: string } }) { state.write(node.attrs.raw); },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleInline = (state, silent) => {
              if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
              const m = WIKI.exec(state.src.slice(state.pos));
              if (!m) return false;
              if (!silent) state.push('html_inline', '', 0).content = `<span data-wikilink="${esc(m[0])}">${esc(parseWiki(m[0]).label)}</span>`;
              state.pos += m[0].length;
              return true;
            };
            md.inline.ruler.before('link', 'ergo_wikilink', rule);
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- inline atoms
const EMBED_IMG = /^!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))(?:\|[^\]]*)?\]\]$/i;
function RawInlineView({ node, selected }: NodeViewProps) {
  const raw = String(node.attrs.raw);
  const img = EMBED_IMG.exec(raw)?.[1];
  return (
    <NodeViewWrapper as="span" className={`raw-inline${img ? ' raw-embed' : ''}${selected ? ' ProseMirror-selectednode' : ''}`} title={img ? raw : undefined}>
      {img ? <FileImg src={img.trim()} alt={img} /> : raw}
    </NodeViewWrapper>
  );
}

export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addNodeView() { return ReactNodeViewRenderer(RawInlineView); },
  addAttributes() { return { raw: { default: '' } }; },
  parseHTML() { return [{ tag: 'span[data-raw-inline]', getAttrs: el => ({ raw: (el as HTMLElement).getAttribute('data-raw-inline') }) }]; },
  renderHTML({ node }) { return ['span', mergeAttributes({ 'data-raw-inline': node.attrs.raw, class: 'raw-inline' }), node.attrs.raw]; },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { raw: string } }) { state.write(node.attrs.raw); },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleInline = (state, silent) => {
              const src = state.src, pos = state.pos, c = src.charCodeAt(pos);
              const rest = src.slice(pos, pos + 2000);
              let m: RegExpExecArray | null = null;
              if (c === 0x21) m = /^!\[\[[^\]\n]+\]\]/.exec(rest);                                  // ![[embed.png]]
              else if (c === 0x25) m = /^%%[^\n]*?%%/.exec(rest);                                   // %%comment%%
              else if (c === 0x5e) { if (pos === 0 || /\s/.test(src[pos - 1])) m = /^\^[A-Za-z0-9-]+(?=[ \t]*(?:\n|$))/.exec(rest); } // ^block-id
              else if (c === 0x5b) m = /^\[\^[^\]\s]+\]/.exec(rest);                                // [^footnote]
              else if (c === 0x3c) m = /^(?:<\/?[A-Za-z][^>\n]*>|<!--[\s\S]*?-->)/.exec(rest);      // <kbd>, <br>, <!-- -->
              else if (c === 0x23 && pos === 0) m = /^#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/u.exec(rest);  // #tag opening a paragraph
              if (!m) return false;
              if (!silent) state.push('html_inline', '', 0).content = `<span data-raw-inline="${esc(m[0])}">${esc(m[0])}</span>`;
              state.pos += m[0].length;
              return true;
            };
            md.inline.ruler.before('escape', 'ergo_raw_inline', rule);
          },
        },
      },
    };
  },
});

// ---------------------------------------------------------------- block atoms: HTML, comments, anything in angle brackets
const START = /^ {0,3}<(?:[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)|\/[A-Za-z]|!--|\?|![A-Za-z])/;
const VERBATIM = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i;

export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() { return { raw: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-raw-block]', getAttrs: el => ({ raw: (el as HTMLElement).getAttribute('data-raw-block') }) }]; },
  renderHTML({ node }) { return ['div', mergeAttributes({ 'data-raw-block': node.attrs.raw, class: 'raw-block' }), ['pre', {}, node.attrs.raw]]; },
  addStorage() {
    return {
      markdown: {
        serialize(state: Out, node: { attrs: { raw: string } }) { state.write(node.attrs.raw); state.closeBlock(node); },
        parse: {
          setup(md: MarkdownIt) {
            const rule: RuleBlock = (state, startLine, endLine, silent) => {
              if (state.sCount[startLine] - state.blkIndent >= 4) return false;
              const first = lineOf(state, startLine);
              if (!START.test(first)) return false;
              if (silent) return true;
              let next = startLine;
              const verb = VERBATIM.exec(first);
              if (/^ {0,3}<!--/.test(first)) { while (next < endLine && !/-->/.test(lineOf(state, next))) next++; }
              else if (/^ {0,3}<\?/.test(first)) { while (next < endLine && !/\?>/.test(lineOf(state, next))) next++; }
              else if (verb) { const close = new RegExp(`</${verb[1]}>`, 'i'); while (next < endLine && !close.test(lineOf(state, next))) next++; }
              else { while (next + 1 < endLine && lineOf(state, next + 1).trim() !== '') next++; }
              next = Math.min(next + 1, endLine);
              const raw = state.getLines(startLine, next, state.blkIndent, false).replace(/\n+$/, '');
              const t = state.push('html_block', '', 0);
              t.content = `<div data-raw-block="${esc(raw)}"></div>\n`;
              t.map = [startLine, next];
              state.line = next;
              return true;
            };
            md.block.ruler.before('html_block', 'ergo_raw_html', rule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
          },
        },
      },
    };
  },
});
