import { tagColor } from './tags';
import { renderDiagramLight } from '../editor/blocks';

/**
 * A note on paper. The note as it is on screen (so formulas, diagrams and pictures are the ones the person sees) is copied
 * into a sheet of its own, `#print-root`, that only the printer shows (see "A note on paper" in app.css), stripped of what
 * only an editor needs: buttons, fields, players, drag handles. The browser's own print dialog then makes the PDF, so text
 * stays text, every language prints, and the paper size and margins can still be changed there.
 */
export interface PrintableNote { title: string; tags: string[]; /** the editor's own element (ProseMirror's root) */ body: HTMLElement }

/** Printing needs the browser's print dialog: a phone app's webview has none. */
export const canPrint = (): boolean => !(/Android/i.test(navigator.userAgent) && '__TAURI_INTERNALS__' in window);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Strips the editing furniture from a copy of the note and swaps what only works on a screen for what works on paper. */
export async function paperBody(live: HTMLElement): Promise<HTMLElement> {
  const root = live.cloneNode(true) as HTMLElement;

  // a toggle: its title, then what is inside, open
  root.querySelectorAll('.toggle-block').forEach(t => {
    const title = t.querySelector<HTMLInputElement>('.toggle-title');
    const body = t.querySelector('.toggle-body');
    const out = el('div', 'pr-toggle');
    out.append(el('div', 'pr-toggle-title', title?.getAttribute('value') ?? title?.value ?? ''));
    const inner = el('div', 'pr-toggle-body');
    if (body) inner.append(...Array.from(body.childNodes));
    out.append(inner);
    t.replaceWith(out);
  });
  // ticks: a drawn box, ticked or not
  root.querySelectorAll('ul[data-type="taskList"] > li').forEach(li => {
    const label = li.querySelector(':scope > label');
    if (label) label.replaceWith(el('span', li.getAttribute('data-checked') === 'true' ? 'pr-check on' : 'pr-check'));
  });
  root.querySelectorAll('.inline-check').forEach(c => {
    const on = c.querySelector('button')?.classList.contains('on');
    c.replaceChildren(el('span', on ? 'pr-check on' : 'pr-check'));
  });
  // a voice note is a line, not a player
  root.querySelectorAll('.audio-clip').forEach(a => {
    a.replaceWith(el('div', 'pr-audio', `Audio: ${a.querySelector('.audio-label')?.textContent ?? 'Voice note'}`));
  });
  // a recording or meeting: its name, and what was said when it has been written out
  root.querySelectorAll('.record-wrap').forEach(r => {
    const out = el('div', 'pr-record');
    out.append(el('div', 'pr-record-title', r.querySelector('.record-card strong')?.textContent ?? 'Recording'));
    r.querySelectorAll('.record-line').forEach(line => {
      const row = el('div', 'pr-record-line');
      const parts = line.querySelectorAll('span');
      row.append(el('span', 'pr-record-time', parts[0]?.textContent ?? ''), el('span', undefined, parts[parts.length - 1]?.textContent ?? ''));
      out.append(row);
    });
    r.replaceWith(out);
  });
  // a drawing: the picture only
  root.querySelectorAll('.excalidraw-block').forEach(d => {
    const img = d.querySelector('img.drawing');
    if (img) { const f = el('figure', 'pr-figure'); f.append(img); d.replaceWith(f); } else d.remove();
  });
  // a diagram: drawn again in the light theme; if that fails, its source
  const diagrams = Array.from(root.querySelectorAll('.code-block.diagram'));
  await Promise.all(diagrams.map(async d => {
    const source = d.querySelector('pre')?.textContent ?? '';
    const svg = source.trim() ? await renderDiagramLight(source) : null;
    if (svg) { const f = el('div', 'pr-diagram'); f.innerHTML = svg; d.replaceWith(f); }
    else { d.querySelectorAll('.diagram-bar, .diagram-out').forEach(x => x.remove()); (d.querySelector('pre') as HTMLElement | null)?.removeAttribute('style'); }
  }));
  // a table whose first row is its header repeats that row on every page it runs onto
  root.querySelectorAll('table').forEach(t => {
    if (t.querySelector(':scope > thead')) return;
    const first = t.querySelector(':scope > tbody > tr:first-child');
    if (!first || !first.children.length || !Array.from(first.children).every(c => c.tagName === 'TH')) return;
    const head = document.createElement('thead');
    head.append(first);
    t.insertBefore(head, t.querySelector(':scope > tbody'));
  });
  // a link to another note is its words; a web address is kept (and shown in full on paper)
  root.querySelectorAll('a[href]').forEach(a => {
    if (/^(https?:|mailto:|tel:)/i.test(a.getAttribute('href') ?? '')) return;
    const s = el('span', 'pr-link');
    s.append(...Array.from(a.childNodes));
    a.replaceWith(s);
  });
  // what only an editor has
  root.querySelectorAll('button, input, textarea, select, audio, video, script, .ProseMirror-widget, .ProseMirror-separator, .ProseMirror-gapcursor, .column-resize-handle, .ghost-text, .math-edit, .math-preview, .hint').forEach(x => x.remove());
  root.querySelectorAll('style').forEach(x => { if (!x.closest('svg')) x.remove(); }); // a diagram carries its own style
  root.querySelectorAll('.chip').forEach(c => { if (/^image…?$/.test(c.textContent ?? '')) c.remove(); });
  root.querySelectorAll('*').forEach(x => {
    for (const a of ['contenteditable', 'draggable', 'tabindex', 'spellcheck', 'data-drag-handle', 'role', 'aria-label', 'aria-checked', 'aria-expanded', 'translate']) x.removeAttribute(a);
    x.classList.remove('ProseMirror-selectednode', 'selectedCell', 'ProseMirror-hideselection');
    if (x.tagName === 'DIV' && (x as HTMLElement).style.display === 'none') (x as HTMLElement).style.display = '';
  });
  root.removeAttribute('contenteditable');
  root.className = 'prose pr-body';
  return root;
}

/** Everything the note embeds has arrived (pictures are read from the Vault a moment after the note opens). */
async function settled(host: HTMLElement) {
  const limit = new Promise<void>(r => setTimeout(r, 6000));
  const imgs = Array.from(host.querySelectorAll('img')).filter(i => !i.complete).map(i => new Promise<void>(r => { i.onload = i.onerror = () => r(); }));
  await Promise.race([Promise.all([...imgs, document.fonts?.ready]), limit]);
}

const pageWord = () => (/^vi\b/i.test(navigator.language) ? ['Trang ', ' / '] : ['Page ', ' of ']);

/**
 * The sheet is one table whose header and footer rows are empty spacers: the printer repeats them on every page, which
 * makes the 20 mm top and bottom margins. The page itself has almost no margin: the browser adds its own header and footer
 * (date, address, page number) in any page margin of about 9 mm or more, so the margins stay under that, and the page
 * number the sheet wants goes in the 8 mm that are left.
 */
const PAGE_MARGIN_BOTTOM = '8mm';

/** Builds the sheet that only the printer shows. The caller prints, then `done()` takes it away again. */
export async function preparePrint(note: PrintableNote): Promise<{ host: HTMLElement; done: () => void }> {
  document.getElementById('print-root')?.remove();
  const host = el('div');
  host.id = 'print-root';
  const title = note.title.trim() || 'Untitled';
  const cell = el('td', 'pr-cell');
  cell.append(el('h1', 'pr-title', title));
  if (note.tags.length) {
    const row = el('div', 'pr-tags');
    for (const t of note.tags) { const pill = el('span', 'tag-ghost pr-tag'); pill.style.setProperty('--c', tagColor(t)); pill.append(el('i', 'tag-dot'), document.createTextNode(t)); row.append(pill); }
    cell.append(row);
  }
  cell.append(await paperBody(note.body));
  const sheet = el('table', 'pr-sheet');
  const gap = (cls: string) => { const td = el('td'); td.append(el('div', `pr-gap ${cls}`)); const tr = el('tr'); tr.append(td); return tr; };
  const head = el('thead'); head.append(gap('top'));
  const foot = el('tfoot'); foot.append(gap('bottom'));
  const body = el('tbody'); const row = el('tr'); row.append(cell); body.append(row);
  sheet.append(head, foot, body);
  host.append(sheet);
  // the page: A4, a bottom strip for the page number (in the language of the app's person; margin boxes need a recent engine and are left out elsewhere)
  const [a, b] = pageWord();
  const css = el('style');
  css.textContent = `@page { size: A4; margin: 0 0 ${PAGE_MARGIN_BOTTOM} 0; @bottom-right { content: "${a}" counter(page) "${b}" counter(pages); vertical-align: top; padding: 1.5mm 20mm 0 0; font: 9pt 'Inter Variable', Inter, system-ui, sans-serif; color: #696564; } }`;
  host.append(css);
  document.body.append(host);
  await settled(host);
  const prevTitle = document.title;
  // the dialog proposes the title as the file name
  document.title = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Note';
  document.documentElement.classList.add('printing-note');
  const done = () => { host.remove(); document.documentElement.classList.remove('printing-note'); document.title = prevTitle; };
  return { host, done };
}

/** PDF: the browser's print dialog, where "Save as PDF" is one of the printers. */
export async function printNote(note: PrintableNote): Promise<void> {
  const { done } = await preparePrint(note);
  const off = () => { window.removeEventListener('afterprint', off); clearTimeout(timer); done(); };
  window.addEventListener('afterprint', off);
  // some webviews never say the dialog is closed: the sheet is out of sight anyway, so just do not keep it for ever
  const timer = setTimeout(off, 10 * 60e3);
  window.print();
}
