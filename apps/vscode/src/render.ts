// A note as HTML for the preview panel. Plain markdown-it plus what Ergonotes writes in a note (CONTEXT.md, ADR 0010): task boxes,
// @due / @remind / @event / @done / @flag tokens, [[wiki links]], toggles, page breaks, formulas, and fences that only the app draws.
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import katex from 'katex';
import { parseNote } from '../../../packages/core/src/folder.ts';

export interface RenderEnv {
  /** where a picture or file written relative to the note can be loaded from */
  resolveFile(src: string): string;
  /** a link to a Habit's note: what to say beside it, or null when it is not one */
  habitChip?(href: string): { text: string; met: boolean } | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- plugins
const TOKEN_RE = /@(due|remind|done|event)\(([^)]*)\)|@flag\b/g;

function tokenChips(md: MarkdownIt) {
  md.core.ruler.push('ergo_tokens', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline' || !block.children) continue;
      const out: Token[] = [];
      for (const t of block.children) {
        if (t.type !== 'text' || !/@(?:due|remind|done|event|flag)/.test(t.content)) { out.push(t); continue; }
        let last = 0;
        TOKEN_RE.lastIndex = 0;
        for (let m = TOKEN_RE.exec(t.content); m; m = TOKEN_RE.exec(t.content)) {
          if (m.index > last) { const x = new state.Token('text', '', 0); x.content = t.content.slice(last, m.index); out.push(x); }
          const chip = new state.Token('html_inline', '', 0);
          const kind = m[1] ?? 'flag';
          const label = kind === 'flag' ? 'Flagged' : `${kind === 'due' ? 'Due' : kind === 'remind' ? 'Reminder' : kind === 'done' ? 'Done' : 'Event'} ${m[2].replace('T', ' ')}`;
          chip.content = `<span class="chip chip-${kind}">${esc(label)}</span>`;
          chip.meta = { trusted: true };
          out.push(chip);
          last = m.index + m[0].length;
        }
        if (last < t.content.length) { const x = new state.Token('text', '', 0); x.content = t.content.slice(last); out.push(x); }
      }
      block.children = out;
    }
    return true;
  });
}

function taskBoxes(md: MarkdownIt) {
  md.core.ruler.push('ergo_tasks', state => {
    const toks = state.tokens;
    for (let i = 2; i < toks.length; i++) {
      const t = toks[i];
      if (t.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue;
      const m = /^\[([ xX])\][ \t]+/.exec(t.content);
      if (!m) continue;
      const done = m[1] !== ' ';
      toks[i - 2].attrJoin('class', done ? 'task done' : 'task');
      t.content = t.content.slice(m[0].length);
      const first = t.children?.[0];
      if (first && first.type === 'text') first.content = first.content.replace(/^\[([ xX])\][ \t]+/, '');
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" disabled${done ? ' checked' : ''}> `;
      box.meta = { trusted: true };
      t.children?.unshift(box);
    }
    return true;
  });
}

/** `[[Title]]` and `[[Folder/Title]]`, kept as the person wrote them. */
function wikiLinks(md: MarkdownIt) {
  md.inline.ruler.before('link', 'ergo_wiki', (state, silent) => {
    const s = state.src, p = state.pos;
    if (s.charCodeAt(p) !== 0x5b || s.charCodeAt(p + 1) !== 0x5b) return false;
    const end = s.indexOf(']]', p + 2);
    if (end < 0) return false;
    const inner = s.slice(p + 2, end);
    if (!inner || inner.includes('\n') || inner.includes('[')) return false;
    if (!silent) {
      const [target, label] = inner.split('|');
      const t = state.push('html_inline', '', 0);
      t.content = `<a href="#" class="wiki" data-wiki="${esc(target.trim())}">${esc((label ?? target).trim())}</a>`;
      t.meta = { trusted: true };
    }
    state.pos = end + 2;
    return true;
  });
}

function math(md: MarkdownIt) {
  const render = (latex: string, display: boolean) => {
    try { return katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: false }); } catch { return `<code>${esc(latex)}</code>`; }
  };
  md.block.ruler.before('fence', 'ergo_math_block', (state, start, end, silent) => {
    const pos = state.bMarks[start] + state.tShift[start];
    if (state.src.slice(pos, pos + 2) !== '$$') return false;
    const firstLine = state.src.slice(pos + 2, state.eMarks[start]);
    let body = '';
    let next = start;
    const same = firstLine.indexOf('$$');
    if (same >= 0) body = firstLine.slice(0, same);
    else {
      body = firstLine;
      for (next = start + 1; next < end; next++) {
        const line = state.src.slice(state.bMarks[next] + state.tShift[next], state.eMarks[next]);
        const close = line.indexOf('$$');
        if (close >= 0) { body += '\n' + line.slice(0, close); break; }
        body += '\n' + line;
      }
      if (next >= end) return false;
    }
    if (silent) return true;
    const t = state.push('html_block', '', 0);
    t.content = `<div class="math">${render(body.trim(), true)}</div>\n`;
    t.meta = { trusted: true };
    t.map = [start, next + 1];
    state.line = next + 1;
    return true;
  });
  md.inline.ruler.before('escape', 'ergo_math_inline', (state, silent) => {
    const s = state.src, p = state.pos;
    if (s.charCodeAt(p) !== 0x24 || s.charCodeAt(p + 1) === 0x24) return false;
    if (/\s/.test(s[p + 1] ?? ' ')) return false;
    let end = p + 1;
    for (; end < s.length; end++) { if (s[end] === '$' && s[end - 1] !== '\\') break; if (s[end] === '\n') return false; }
    if (end >= s.length || /\s/.test(s[end - 1]) || /\d/.test(s[end + 1] ?? '')) return false;
    if (!silent) { const t = state.push('html_inline', '', 0); t.content = render(s.slice(p + 1, end), false); t.meta = { trusted: true }; }
    state.pos = end + 1;
    return true;
  });
}

/** Only these tags of raw HTML survive: the ones Ergonotes writes itself (toggle, page break). */
function limitedHtml(md: MarkdownIt) {
  const clean = (html: string) => esc(html)
    .replace(/&lt;(\/?)(details|summary)(?:\s[^&]*?)?&gt;/gi, '<$1$2>')
    .replace(/&lt;div style=&quot;page-break-after:\s*always;?&quot;&gt;&lt;\/div&gt;/gi, '<div class="page-break">Page break</div>');
  md.renderer.rules.html_block = (tokens, i) => (tokens[i].meta?.trusted ? tokens[i].content : clean(tokens[i].content));
  md.renderer.rules.html_inline = (tokens, i) => (tokens[i].meta?.trusted ? tokens[i].content : clean(tokens[i].content));
}

// ---------------------------------------------------------------- the renderer
export function renderNote(text: string, env: RenderEnv): string {
  const parsed = parseNote(text);
  const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
  md.use(tokenChips).use(taskBoxes).use(wikiLinks).use(math).use(limitedHtml);

  md.renderer.rules.fence = (tokens, i) => {
    const t = tokens[i];
    const lang = t.info.trim().split(/\s+/)[0];
    if (lang === 'ergonote-excalidraw') return '<div class="block drawing">Drawing: open this note in Ergonotes to see and edit it</div>\n';
    if (lang === 'mermaid') return `<figure class="block diagram"><figcaption>Diagram (Mermaid)</figcaption><pre><code>${esc(t.content)}</code></pre></figure>\n`;
    if (lang.startsWith('ergonote-')) return `<figure class="block"><figcaption>${esc(lang)}</figcaption><pre><code>${esc(t.content)}</code></pre></figure>\n`;
    return `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(t.content)}</code></pre>\n`;
  };

  md.renderer.rules.image = (tokens, i) => {
    const t = tokens[i];
    const src = t.attrGet('src') ?? '';
    const alt = t.content;
    return /^(https?:|data:)/i.test(src) ? `<img src="${esc(src)}" alt="${esc(alt)}">` : `<img src="${esc(env.resolveFile(decodeURI(src)))}" alt="${esc(alt)}">`;
  };

  const linkOpen = md.renderer.rules.link_open ?? ((tokens, i, o, e, r) => r.renderToken(tokens, i, o));
  md.renderer.rules.link_open = (tokens, i, o, e, r) => {
    const t = tokens[i];
    const href = t.attrGet('href') ?? '';
    const title = t.attrGet('title') ?? '';
    if (/^(https?:|mailto:|tel:)/i.test(href)) { t.attrSet('data-external', '1'); return linkOpen(tokens, i, o, e, r); }
    if (href.startsWith('#')) return linkOpen(tokens, i, o, e, r);
    // a file of the vault: opened in the editor, not followed; a Habit's note also says where it stands
    const decoded = decodeURI(href);
    t.attrSet('href', '#');
    t.attrSet('data-open', decoded);
    if (title === 'audio') t.attrSet('data-audio', env.resolveFile(decoded));
    const chip = /\.md$/i.test(decoded) ? env.habitChip?.(decoded) : null;
    if (chip) { t.attrJoin('class', chip.met ? 'habit-chip met' : 'habit-chip'); t.attrSet('data-habit', chip.text); }
    return linkOpen(tokens, i, o, e, r);
  };

  const body = md.render(parsed.body);
  const props = Object.keys(parsed.fm).filter(k => !['id', 'created', 'updated'].includes(k));
  const tags = Array.isArray(parsed.fm.tags) ? (parsed.fm.tags as unknown[]).map(String) : [];
  const head = props.length
    ? `<header class="props">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}${props.filter(k => k !== 'tags').map(k => `<span class="prop"><b>${esc(k)}</b> ${esc(String(parsed.fm[k]))}</span>`).join('')}</header>`
    : '';
  return head + body;
}
