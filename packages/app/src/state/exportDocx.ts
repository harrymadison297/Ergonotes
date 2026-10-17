// A note as a Word document (.docx), made in the app from the note as it is on screen (the same clean copy as the PDF):
// text stays text, headings are Word headings, lists are lists, tasks are boxes, tables are tables, and what only a screen
// can draw (diagrams, drawings, formulas' pictures) is a picture. No Word or LibreOffice is needed to make the file.
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType, type IParagraphOptions, type ParagraphChild,
} from 'docx';
import { paperBody } from './printNote';

export interface DocxNote { title: string; tags: string[]; /** the editor's own element */ body: HTMLElement }

interface Style { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; underline?: boolean; color?: string; size?: number }
interface Ctx { /** nesting inside quotes, toggles and list items, in twips */ indent: number; list: number; quote?: boolean }
type Block = Paragraph | Table;

const MAX_PX = 600; // widest picture: about 16 cm
const MONO = 'Consolas';
const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DIV', 'FIGURE', 'DETAILS', 'SECTION', 'ASIDE', 'LI']);
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

const collapse = (s: string) => s.replace(/[ \t\r\n\f]+/g, ' ');

// ---------------------------------------------------------------- pictures
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}

async function pngOf(img: HTMLImageElement, width: number, height: number): Promise<Uint8Array | null> {
  const scale = 2;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width * scale));
  c.height = Math.max(1, Math.round(height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** An <img> or an inline <svg> as a PNG that Word can hold, at a size that fits the page. */
async function picture(node: Element): Promise<ImageRun | null> {
  let src = '';
  let w = 0, h = 0;
  if (node instanceof SVGElement || node.tagName.toLowerCase() === 'svg') {
    const svg = node.cloneNode(true) as SVGElement;
    const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    w = Number.parseFloat(svg.getAttribute('width') ?? '') || vb?.[2] || 600;
    h = Number.parseFloat(svg.getAttribute('height') ?? '') || vb?.[3] || 400;
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  } else {
    src = (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src;
    if (!src) return null;
  }
  const img = await loadImage(src);
  if (!img) return null;
  if (!w) { w = img.naturalWidth; h = img.naturalHeight; }
  if (!w || !h) return null;
  const k = Math.min(1, MAX_PX / w);
  const data = await pngOf(img, w, h);
  return data ? new ImageRun({ type: 'png', data, transformation: { width: Math.round(w * k), height: Math.round(h * k) }, altText: { title: node.getAttribute('alt') ?? '', description: node.getAttribute('alt') ?? '', name: 'picture' } }) : null;
}

// ---------------------------------------------------------------- text
function run(text: string, st: Style): TextRun {
  return new TextRun({
    text, bold: st.bold, italics: st.italics, strike: st.strike, underline: st.underline ? {} : undefined, color: st.color, size: st.size,
    font: st.code ? MONO : undefined, shading: st.code ? { type: ShadingType.CLEAR, fill: 'F0EFEE' } : undefined,
  });
}

/** The latex a formula was written with (KaTeX keeps it in its MathML), or what it shows. */
const latexOf = (m: Element): string => m.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? m.textContent ?? '';

async function inline(node: Node, st: Style, out: ParagraphChild[]): Promise<void> {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = collapse(node.textContent ?? '');
    if (t) out.push(run(t, st));
    return;
  }
  if (!(node instanceof Element)) return;
  const tag = node.tagName;
  const cls = node.classList;
  if (tag === 'BR') { out.push(new TextRun({ break: 1 })); return; }
  if (tag === 'IMG') { const p = await picture(node); if (p) out.push(p); return; }
  if (tag.toLowerCase() === 'svg') { const p = await picture(node); if (p) out.push(p); return; }
  if (cls.contains('pr-check')) { out.push(run(cls.contains('on') ? '☑ ' : '☐ ', { ...st, size: 24 })); return; }
  if (cls.contains('katex') || cls.contains('math-out')) { const l = latexOf(node); if (l) out.push(run(l, { ...st, italics: true })); return; }
  let next = st;
  if (tag === 'STRONG' || tag === 'B') next = { ...next, bold: true };
  else if (tag === 'EM' || tag === 'I') next = { ...next, italics: true };
  else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') next = { ...next, strike: true };
  else if (tag === 'U') next = { ...next, underline: true };
  else if (tag === 'CODE') next = { ...next, code: true };
  else if (cls.contains('task-meta')) next = { ...next, color: '696564' };
  if (tag === 'A' && /^(https?:|mailto:|tel:)/i.test(node.getAttribute('href') ?? '')) {
    const kids: ParagraphChild[] = [];
    for (const c of Array.from(node.childNodes)) await inline(c, { ...next, color: '0B57D0', underline: true }, kids);
    out.push(new ExternalHyperlink({ link: node.getAttribute('href')!, children: kids as TextRun[] }));
    return;
  }
  for (const c of Array.from(node.childNodes)) await inline(c, next, out);
}

// ---------------------------------------------------------------- blocks
const quoteBorder = { left: { style: BorderStyle.SINGLE, size: 18, color: 'B9B5B3', space: 10 } };

type ParagraphExtra = Omit<IParagraphOptions, 'children'>;

async function paragraph(nodes: Node[], ctx: Ctx, extra: ParagraphExtra = {}, st: Style = {}): Promise<Paragraph | null> {
  const kids: ParagraphChild[] = [];
  for (const n of nodes) await inline(n, st, kids);
  // trim the space a line break in the HTML left at the ends
  if (kids.length === 0) return null;
  return new Paragraph({ children: kids, indent: ctx.indent ? { left: ctx.indent } : undefined, border: ctx.quote ? quoteBorder : undefined, spacing: { after: 120 }, ...extra });
}

const isBlock = (n: Node) => n instanceof Element && (BLOCK.has(n.tagName) || n.classList.contains('pr-figure') || n.classList.contains('pr-diagram'));

let orderedInstance = 0;

async function listBlocks(list: Element, ctx: Ctx): Promise<Block[]> {
  const out: Block[] = [];
  const task = list.getAttribute('data-type') === 'taskList';
  const ordered = list.tagName === 'OL';
  const instance = ordered ? ++orderedInstance : 0;
  const level = Math.min(ctx.list, 5);
  for (const li of Array.from(list.children).filter(c => c.tagName === 'LI')) {
    const kids = Array.from(li.childNodes);
    let first = true;
    // the item's own words come first; a list inside it follows one level deeper
    const lead: Node[] = [];
    const rest: Node[] = [];
    for (const k of kids) {
      if (first && k instanceof Element && (k.tagName === 'P' || k.tagName === 'DIV' && !(k.classList.contains('pr-figure')))) { lead.push(...Array.from(k.childNodes)); first = false; }
      else if (first && !isBlock(k)) lead.push(k);
      else { first = false; rest.push(k); }
    }
    // the box the screen drew is replaced by one Word can show
    const box = task ? await taskBox(li) : null;
    const words = task ? lead.filter(n => !(n instanceof Element && n.classList.contains('pr-check'))) : lead;
    const p = await paragraph(box ? [box, ...words] : words, { ...ctx, indent: 0 }, task
      ? { indent: { left: ctx.indent + 360 * (level + 1) + 360, hanging: 360 } }
      : { numbering: { reference: ordered ? 'ordered' : 'bullet', level, ...(ordered ? { instance } : {}) }, indent: undefined });
    out.push(p ?? new Paragraph({ children: [], numbering: task ? undefined : { reference: ordered ? 'ordered' : 'bullet', level, ...(ordered ? { instance } : {}) } }));
    const holder = document.createElement('div');
    holder.append(...rest.map(r => r.cloneNode(true)));
    out.push(...await blocks(holder, { ...ctx, list: ctx.list + 1, indent: ctx.indent }));
  }
  return out;
}

async function taskBox(li: Element): Promise<Node> {
  const on = li.getAttribute('data-checked') === 'true' || !!li.querySelector(':scope > .pr-check.on');
  const s = document.createElement('span');
  s.textContent = on ? '☑ ' : '☐ ';
  return s;
}

async function tableBlock(t: Element, ctx: Ctx): Promise<Table> {
  const rows: TableRow[] = [];
  for (const tr of Array.from(t.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr'))) {
    const cells: TableCell[] = [];
    for (const c of Array.from(tr.children).filter(x => x.tagName === 'TD' || x.tagName === 'TH')) {
      const kids = await blocks(c, { indent: 0, list: 0 });
      cells.push(new TableCell({
        children: kids.length ? kids : [new Paragraph({ children: [] })],
        columnSpan: Number(c.getAttribute('colspan')) > 1 ? Number(c.getAttribute('colspan')) : undefined,
        rowSpan: Number(c.getAttribute('rowspan')) > 1 ? Number(c.getAttribute('rowspan')) : undefined,
        shading: c.tagName === 'TH' ? { type: ShadingType.CLEAR, fill: 'F0EFEE' } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
      }));
    }
    if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: tr.parentElement?.tagName === 'THEAD' }));
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, indent: ctx.indent ? { size: ctx.indent, type: WidthType.DXA } : undefined });
}

async function blocks(parent: Element, ctx: Ctx): Promise<Block[]> {
  const out: Block[] = [];
  let buf: Node[] = [];
  const flush = async () => {
    if (buf.some(n => (n.textContent ?? '').trim() || (n instanceof Element && n.querySelector('img, svg')) || (n instanceof Element && (n.tagName === 'IMG')))) {
      const p = await paragraph(buf, ctx);
      if (p) out.push(p);
    }
    buf = [];
  };
  for (const n of Array.from(parent.childNodes)) {
    if (!(n instanceof Element) || !isBlock(n)) { buf.push(n); continue; }
    await flush();
    const tag = n.tagName;
    const cls = n.classList;
    if (/^H[1-6]$/.test(tag)) {
      const p = await paragraph(Array.from(n.childNodes), ctx, { heading: HEADINGS[Number(tag[1]) - 1], spacing: { before: 200, after: 100 } });
      if (p) out.push(p);
    } else if (tag === 'P') {
      const p = await paragraph(Array.from(n.childNodes), ctx);
      out.push(p ?? new Paragraph({ children: [], spacing: { after: 120 } }));
    } else if (tag === 'UL' || tag === 'OL') out.push(...await listBlocks(n, ctx));
    else if (tag === 'BLOCKQUOTE') out.push(...await blocks(n, { ...ctx, indent: ctx.indent + 360, quote: true }));
    else if (tag === 'PRE') {
      for (const line of (n.textContent ?? '').replace(/\n$/, '').split('\n')) {
        out.push(new Paragraph({ children: [new TextRun({ text: line, font: MONO, size: 20 })], shading: { type: ShadingType.CLEAR, fill: 'F0EFEE' }, spacing: { after: 0 }, indent: ctx.indent ? { left: ctx.indent } : undefined }));
      }
      out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    } else if (tag === 'TABLE') { out.push(await tableBlock(n, ctx)); out.push(new Paragraph({ children: [], spacing: { after: 120 } })); }
    else if (tag === 'HR') out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B9B5B3', space: 1 } }, spacing: { after: 160 } }));
    else if (n.hasAttribute('data-pagebreak') || cls.contains('page-break')) out.push(new Paragraph({ children: [new PageBreak()] }));
    else if (cls.contains('pr-figure') || cls.contains('pr-diagram')) {
      const pic = await picture(n.querySelector('img, svg') ?? n);
      if (pic) out.push(new Paragraph({ children: [pic], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
    } else if (cls.contains('pr-audio')) out.push(new Paragraph({ children: [run(n.textContent ?? '', { italics: true, color: '696564' })], spacing: { after: 120 } }));
    else if (cls.contains('pr-record')) {
      out.push(new Paragraph({ children: [run(n.querySelector('.pr-record-title')?.textContent ?? 'Recording', { bold: true })], spacing: { after: 60 } }));
      for (const l of Array.from(n.querySelectorAll('.pr-record-line'))) out.push(new Paragraph({ children: [run(l.textContent ?? '', {})], indent: { left: 360 }, spacing: { after: 40 } }));
    } else if (cls.contains('pr-toggle')) {
      out.push(new Paragraph({ children: [run(n.querySelector('.pr-toggle-title')?.textContent ?? '', { bold: true })], spacing: { after: 80 } }));
      const body = n.querySelector('.pr-toggle-body');
      if (body) out.push(...await blocks(body, { ...ctx, indent: ctx.indent + 360 }));
    } else if (cls.contains('math-block') || n.hasAttribute('data-math-block')) {
      const l = latexOf(n) || n.getAttribute('data-math-block') || '';
      if (l) out.push(new Paragraph({ children: [run(l, { italics: true })], alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
    } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ASIDE' || tag === 'FIGURE' || tag === 'DETAILS' || tag === 'LI') out.push(...await blocks(n, ctx));
  }
  await flush();
  return out;
}

const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];

export async function noteToDocx(note: DocxNote): Promise<Blob> {
  orderedInstance = 0;
  const live = await paperBody(note.body);
  const title = note.title.trim() || 'Untitled';
  const children: Block[] = [new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 44 })], heading: HeadingLevel.TITLE, spacing: { after: 120 } })];
  if (note.tags.length) children.push(new Paragraph({ children: [run(note.tags.map(t => `#${t}`).join('  '), { color: '696564', size: 20 })], spacing: { after: 240 } }));
  children.push(...await blocks(live, { indent: 0, list: 0 }));
  const level = (i: number, text: string, format: (typeof NUMBER_FORMATS)[number] | typeof LevelFormat.BULLET) => ({
    level: i, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } },
  });
  const doc = new Document({
    creator: 'Ergonotes', title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', quickFormat: true, run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 276 } } },
        ...[32, 28, 26, 24, 22, 22].map((size, i) => ({
          id: `Heading${i + 1}`, name: `Heading ${i + 1}`, basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { bold: true, size, color: '1F1E1D' }, paragraph: { outlineLevel: i, keepNext: true, spacing: { before: 240 - i * 20, after: 100 } },
        })),
      ],
    },
    numbering: {
      config: [
        { reference: 'bullet', levels: Array.from({ length: 6 }, (_, i) => level(i, ['•', '◦', '▪'][i % 3], LevelFormat.BULLET)) },
        { reference: 'ordered', levels: Array.from({ length: 6 }, (_, i) => level(i, `%${i + 1}.`, NUMBER_FORMATS[i % 3])) },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
