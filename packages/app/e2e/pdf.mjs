// Export as PDF: the note is copied into a sheet of its own that only the printer shows, then the browser's print dialog makes the PDF.
// Here the dialog is replaced by Chromium's own print-to-PDF of that same sheet, and the PDF and the sheet are looked at.
// usage: node pdf.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 500) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 150)); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, colorScheme: 'dark' }); // dark on screen, light on paper
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
const fresh = await page.getByRole('heading', { name: 'Set up Ergonotes' }).waitFor({ timeout: 6000 }).then(() => true, () => false);
if (fresh) {
  await page.getByLabel('Vault password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
} else {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
await page.locator('.sidebar').waitFor({ timeout: 30000 });
const rpc = (method, ...args) => page.evaluate(async ([m, a]) => (await (await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json()), [method, args]);

// ---- a note with one of everything
const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 480; c.height = 220; const g = c.getContext('2d'); g.fillStyle = '#3d8bd9'; g.fillRect(0, 0, 480, 220); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('A picture', 140, 120); return c.toDataURL('image/png').split(',')[1]; });
const pic = await rpc('addFile', { name: 'picture.png', mime: 'image/png', data: png });
await rpc('addFile', { name: 'transcript.txt', mime: 'text/plain', data: Buffer.from('[0:00]\nWelcome everyone, today we plan the quarter.\n\n[1:00]\nThe budget is approved. Chào cả nhà.\n').toString('base64'), dir: 'attachments/record_20261016_100000' });
await rpc('addFile', { name: 'audio-001.webm', mime: 'audio/webm', data: Buffer.from('GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FBAUKGgQAUQoOBAhVCgQAUQoOBAhVCgQAU', 'base64').toString('base64'), dir: 'attachments/record_20261016_100000' });
const lorem = 'Báo cáo này tóm tắt những gì đã làm trong quý vừa rồi, những việc còn dang dở và kế hoạch cho quý tới. '.repeat(6);
const body = [
  '# Báo cáo quý — kế hoạch tuần', '',
  `${lorem}**Chữ đậm**, *chữ nghiêng*, ~~gạch~~, \`inline code\` and a [web link](https://example.com/some/long/path?x=1) and [another note](Other.md).`, '',
  '## Danh sách', '',
  '- first item', '  - nested item with more words in it', '    - third level', '- second item', '',
  '1. step one', '2. step two', '',
  '## Tasks', '',
  '- [ ] Call the agent @due(2026-10-20)', '- [x] Book a viewing', '- [ ] Write the report @remind(2026-10-19T09:00)', '',
  'Plain ticks: ☐ not yet, ☑ done', '',
  '> A quote that says something worth keeping,\n> over two lines.', '',
  '```js\nfunction greet(name) {\n  return `Hello, ${name}! This line is quite long on purpose so that it has to wrap around the page edge instead of running off it`;\n}\n```', '',
  '## Table', '',
  '| Item | Owner | Due | Notes |', '|---|---|---|---|', '| Budget | An | 20 Oct | Approved by the board |', '| Hiring | Bình | 30 Oct | Two roles open, one offer out |', '| Launch | Chi | 12 Nov | Waiting on legal |', '',
  `![A picture](${pic.path})`, '',
  '## Formulas and diagrams', '',
  'Inline $E = mc^2$ and a block:', '', '$$', '\\int_0^1 x^2 \\, dx = \\frac{1}{3}', '$$', '',
  '```mermaid\ngraph TD\n  A[Start] --> B{Ready?}\n  B -->|Yes| C[Ship]\n  B -->|No| D[Wait]\n```', '',
  '<details><summary>Hidden details</summary>', '', 'This is inside the toggle, and it is printed open.', '', '</details>', '',
  '## Dates, audio, recordings', '',
  'Kick-off @date(2026-10-20) and Team sync @event(2026-10-21T09:00-10:30)', '',
  '[Voice note 14:30 · 0:42](attachments/voice.webm "audio")', '',
  '[Meeting 2026-10-16 10:00](attachments/record_20261016_100000 "type_record")', '',
  '<div style="page-break-after: always;"></div>', '',
  '## After the page break', '', lorem, '', lorem,
].join('\n');
const note = await rpc('createNote', { title: 'Báo cáo quý', body, tags: ['work/reports', 'q4', 'planning'] });
await page.goto(`${base}/#/notes/${note.id}`);
await page.locator('.prose h1').waitFor({ timeout: 15000 });
await page.locator('.prose .math-out').first().waitFor({ timeout: 15000 });
await page.locator('.prose .diagram-out svg').first().waitFor({ timeout: 20000 });
await page.locator('.prose .record-line').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);

// ---- the menu entry
await page.addInitScript(() => {});
await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
await page.getByRole('button', { name: 'Export' }).click();
const entries = await page.locator('.menu .menu-item').allTextContents();
check('the Export menu has Markdown, Web page and PDF', entries.some(e => /Markdown/.test(e)) && entries.some(e => /Web page/.test(e)) && entries.some(e => /^PDF/.test(e.trim())), entries.join(' | '));
await page.getByRole('menuitem', { name: /^PDF/ }).click();
await until(async () => (await page.evaluate(() => window.__printed)) === 1);
check('it opens the print dialog once, with the note on a sheet of its own', (await page.evaluate(() => window.__printed)) === 1 && (await page.locator('#print-root').count()) === 1);
check('the sheet is not on the screen', !(await page.locator('#print-root').isVisible()));
check('the page title is the note title while printing (the proposed file name)', (await page.title()) === 'Báo cáo quý', await page.title());

// ---- what is on the sheet
await page.emulateMedia({ media: 'print' });
const sheet = await page.evaluate(() => {
  const r = document.querySelector('#print-root');
  const cs = getComputedStyle(r);
  const text = r.innerText;
  const imgs = [...r.querySelectorAll('img')];
  return {
    visibleSiblings: [...document.body.children].filter(c => c !== r && getComputedStyle(c).display !== 'none').length,
    bg: cs.backgroundColor, color: getComputedStyle(r.querySelector('.pr-body p')).color,
    title: r.querySelector('.pr-title')?.textContent, tags: [...r.querySelectorAll('.pr-tag')].map(t => t.textContent),
    h: [...r.querySelectorAll('.pr-body h1, .pr-body h2')].map(h => h.textContent),
    furniture: r.querySelectorAll('button, input, textarea, audio, video, [contenteditable], .diagram-bar, .toggle-arrow, .math-edit').length,
    checks: r.querySelectorAll('.pr-check').length, checked: r.querySelectorAll('.pr-check.on').length,
    imgsOk: imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0), imgs: imgs.map(i => `${i.className}|${i.alt}|${i.src.slice(0, 30)}|${i.naturalWidth}`).join(' ; '),
    math: r.querySelectorAll('.katex').length, diagram: r.querySelectorAll('.pr-diagram svg').length,
    toggleTitle: r.querySelector('.pr-toggle-title')?.textContent, toggleBody: r.querySelector('.pr-toggle-body')?.textContent.trim(), toggleHidden: getComputedStyle(r.querySelector('.pr-toggle-body')).display === 'none',
    audio: r.querySelector('.pr-audio')?.textContent, record: r.querySelector('.pr-record-title')?.textContent, recordLines: [...r.querySelectorAll('.pr-record-line')].map(l => l.textContent),
    links: [...r.querySelectorAll('a')].map(a => a.getAttribute('href')), internalLink: r.querySelector('.pr-link')?.textContent,
    external: getComputedStyle(r.querySelector('a[href^="http"]'), '::after').content,
    codeWrap: getComputedStyle(r.querySelector('pre')).whiteSpace, codeBg: getComputedStyle(r.querySelector('pre')).backgroundColor,
    tableRows: r.querySelectorAll('tbody tr').length, pageBreak: !!r.querySelector('.page-break'),
    text: text.slice(0, 40), hasMeta: /Updated|Edited|ago/.test(text), hasBrand: /Ergonotes/.test(text),
  };
});
check('only the sheet is left for the printer (the app is out of the way)', sheet.visibleSiblings === 0, sheet.visibleSiblings);
check('it is white paper with dark text even though the app is in the dark theme', sheet.bg === 'rgb(255, 255, 255)' && sheet.color === 'rgb(52, 51, 50)', `${sheet.bg} ${sheet.color}`);
check('it starts with the title, then the tags with their names', sheet.title === 'Báo cáo quý' && sheet.tags.join('|') === 'planning|q4|work/reports' || sheet.tags.sort().join('|') === 'planning|q4|work/reports', JSON.stringify([sheet.title, sheet.tags]));
check('there is no meta line and no app name on the sheet', !sheet.hasMeta && !sheet.hasBrand, sheet.text);
check('the headings of the note follow', ['Báo cáo quý — kế hoạch tuần', 'Danh sách', 'Tasks', 'Table', 'Formulas and diagrams', 'Dates, audio, recordings', 'After the page break'].every(h => sheet.h.includes(h)), sheet.h.join(' | '));
check('no buttons, fields, players or editing handles came along', sheet.furniture === 0, sheet.furniture);
check('tasks and ticks are drawn boxes, the done ones filled', sheet.checks === 5 && sheet.checked === 2, `${sheet.checks} boxes, ${sheet.checked} done`);
check('the picture is there and loaded', sheet.imgsOk, `${sheet.imgs} images`);
check('formulas are set and the diagram is drawn (in the light theme)', sheet.math >= 2 && sheet.diagram === 1, `${sheet.math} formulas, ${sheet.diagram} diagrams`);
check('a toggle is printed open, its title above its content', sheet.toggleTitle === 'Hidden details' && /inside the toggle/.test(sheet.toggleBody) && !sheet.toggleHidden, JSON.stringify([sheet.toggleTitle, sheet.toggleBody]));
check('a voice note is a line with its name', /^Audio: Voice note 14:30/.test(sheet.audio), sheet.audio);
check('a recording shows its name and what was said', /Meeting 2026-10-16/.test(sheet.record) && sheet.recordLines.length === 2 && /Welcome everyone/.test(sheet.recordLines[0]) && /Chào cả nhà/.test(sheet.recordLines[1]), JSON.stringify([sheet.record, sheet.recordLines]));
check('a link to the web keeps its address, shown in full; a link to another note is just its words', sheet.links.length === 1 && sheet.links[0].startsWith('https://example.com') && sheet.external.includes('attr') === false && /example\.com/.test(sheet.external) && sheet.internalLink === 'another note', JSON.stringify([sheet.links, sheet.external, sheet.internalLink]));
check('code wraps instead of running off the page, on a light panel', sheet.codeWrap === 'pre-wrap' && sheet.codeBg === 'rgb(246, 245, 244)', `${sheet.codeWrap} ${sheet.codeBg}`);
check('the table and the page break are there', sheet.tableRows >= 3 && sheet.pageBreak, JSON.stringify([sheet.tableRows, sheet.pageBreak]));

// ---- the PDF itself
const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
writeFileSync(`${shots}/note.pdf`, pdf);
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
check('the PDF is A4, and has several pages (the page break and the long text)', pages >= 3 && !!box && Math.abs(Number(box[1]) - 595) < 1.5 && Math.abs(Number(box[2]) - 842) < 1.5, `${pages} pages, ${pdf.length} bytes, ${(pdf.toString('latin1').match(/\/MediaBox[^\]]*\]/) ?? [''])[0]}`);

// ---- afterwards the app is as it was
await page.emulateMedia({ media: 'screen' });
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
await page.waitForTimeout(200);
check('when the dialog closes the sheet is taken away and the title is back', (await page.locator('#print-root').count()) === 0 && (await page.title()) === 'Ergonotes' && !(await page.evaluate(() => document.documentElement.classList.contains('printing-note'))), await page.title());
check('the note on screen is untouched', (await page.locator('.prose h1').count()) === 1 && (await page.locator('.editor-foot').isVisible()));

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
