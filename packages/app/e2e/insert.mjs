// End-to-end check of the Insert menu and the elements it puts into a note: what is written to the Markdown, that it
// reads back as the same element, and the note-width switch. usage: node insert.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 1200) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 150)); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

const rpc = (method, ...args) => page.evaluate(async ([m, a]) => (await (await fetch(`/api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json()), [method, args]);
const noteBody = async title => {
  const items = await rpc('listItems');
  const it = items.find(i => i.title === title);
  return it ? (await rpc('getNote', it.id)).body : '';
};

await page.getByRole('button', { name: 'New note' }).first().click();
await page.getByLabel('Title').waitFor();
await page.getByLabel('Title').fill('Elements');
await page.locator('.prose').click();
await page.keyboard.type('Start of the note');
await page.keyboard.press('Enter');

const openInsert = async () => { await page.getByRole('button', { name: /^Insert/ }).click(); await page.getByRole('dialog', { name: 'Insert' }).waitFor(); };
const choose = async label => {
  await openInsert();
  await page.getByRole('dialog', { name: 'Insert' }).getByPlaceholder('Search insert options…').fill(label);
  await page.getByRole('dialog', { name: 'Insert' }).getByRole('option', { name: new RegExp(`^${label}`) }).first().click();
  await page.waitForTimeout(120);
};

// ---- the menu itself
await openInsert();
const menu = page.getByRole('dialog', { name: 'Insert' });
const titles = await menu.locator('.menu-title').allTextContents();
check('the Insert menu has the six groups', ['Essentials', 'Text styles', 'Lists', 'Media', 'Advanced', 'Utilities'].every(t => titles.includes(t)), titles.join(', '));
const count = await menu.getByRole('option').count();
check('the Insert menu lists every element', count >= 30, `${count} entries`);
await menu.getByPlaceholder('Search insert options…').fill('toggle');
check('search narrows the list', (await menu.getByRole('option').count()) === 1);
await menu.getByPlaceholder('Search insert options…').fill('zzzz');
check('search says when nothing matches', await menu.getByText('Nothing matches').isVisible());
await page.screenshot({ path: `${shots}/insert-menu.png` });
await page.keyboard.press('Escape');
await menu.waitFor({ state: 'detached' });

// pin to the top
await openInsert();
await page.getByRole('button', { name: 'Pin Toggle' }).click({ force: true });
await page.keyboard.press('Escape');
await openInsert();
check('a pinned entry moves to a Pinned group', (await page.getByRole('dialog', { name: 'Insert' }).locator('.menu-title').first().textContent()) === 'Pinned');
await page.keyboard.press('Escape');

// ---- toggle
await choose('Toggle');
await page.getByLabel('Toggle title').fill('More details');
await page.keyboard.press('Enter');
await page.keyboard.type('Inside the toggle');
check('a toggle is inserted with a title and a body', (await page.locator('.toggle-block').count()) === 1);

// ---- the rest, each inserted at the end of the note
// the empty paragraph that always waits below the last block is where the caret goes
const endOfNote = async () => { await page.locator('.prose > p:last-child').click(); await page.waitForTimeout(120); await page.keyboard.press('Control+End'); };
await endOfNote();
await page.keyboard.press('Enter');
await choose('Contents');
await page.locator('.toc .toc-item').first().waitFor({ timeout: 4000 }).catch(() => {});
check('Contents opens the outline of the note, computed from its headings', await page.locator('.toc').count() === 1);
await endOfNote();
await choose('Page break');
await endOfNote();
await page.keyboard.press('Enter');
await page.keyboard.type('Tick ');
await choose('Checkbox');
await page.keyboard.type('and a date ');
await choose('Date mention');
await page.locator('#dm-d').fill('2026-10-20');
await page.locator('.dialog footer .btn.primary').click();
await page.keyboard.press('Enter');
await choose('Event');
await page.locator('#ev-t').fill('Team sync');
await page.locator('#ev-d').fill('2026-10-20');
await page.locator('#ev-s').fill('09:00');
await page.locator('#ev-e').fill('10:30');
await page.locator('.dialog footer .btn.primary').click();
await page.keyboard.press('Enter');
await choose('Formula');
await page.getByLabel('Formula (LaTeX)').fill('x^2 + y^2');
await page.keyboard.press('Enter');
await endOfNote();
await page.keyboard.press('Enter');
await choose('Formula block');
await page.getByLabel('Formula (LaTeX)').fill('E = mc^2');
await page.keyboard.press('Control+Enter');
await endOfNote();
await choose('Mermaid diagram');
await page.locator('.diagram-out svg').first().waitFor({ timeout: 15000 });
await endOfNote();
await page.keyboard.press('Enter');
await choose('Current date');
await endOfNote();
await page.keyboard.press('Enter');
await page.keyboard.type('Plan ');
await choose('Tag');
check('Tag puts the cursor in the tag field of the note', await page.evaluate(() => document.activeElement?.classList.contains('tag-input') === true));
await page.keyboard.type('proj');
await page.keyboard.press('Enter');
await page.screenshot({ path: `${shots}/insert-elements.png` });

check('the toggle, page break, date, checkbox and formulas render',
  (await page.locator('.page-break').count()) === 1 && (await page.locator('.date-chip').count()) === 1
  && (await page.locator('.inline-check').count()) === 1 && (await page.locator('.math .katex').count()) >= 2);
check('the diagram renders', !!(await until(() => page.locator('.diagram-out svg').count().then(n => n > 0), 15000)));

// ---- what is stored
const stored = await until(async () => { const b = await noteBody('Elements'); return b.includes('@event(') && b.includes('$$') && /\nPlan\s*$/.test(b) ? b : null; }, 10000) ?? '';
check('toggle is stored as <details><summary>', /<details>\n<summary>More details<\/summary>\n\nInside the toggle\n\n<\/details>/.test(stored), JSON.stringify(stored.slice(0, 160)));
check('contents is not stored anywhere', !stored.includes('[TOC]') && !stored.includes('toc'));
check('page break is stored as a div', stored.includes('<div style="page-break-after: always;"></div>'));
check('checkbox is stored as ☐', stored.includes('Tick ☐'));
check('date is stored as @date(…)', stored.includes('@date(2026-10-20)'));
check('event is stored as @event(…)', stored.includes('Team sync @event(2026-10-20T09:00-10:30)'));
check('formulas are stored as $…$ and $$ … $$', stored.includes('$x^2 + y^2$') && /\$\$\nE = mc\^2\n\$\$/.test(stored));
check('diagram is stored as a ```mermaid fence', /```mermaid\nflowchart TD/.test(stored));
check('the tag is a property of the note, not text in it', (await rpc('tags')).some(t => t.tag === 'proj') && !stored.includes('#proj'));

// ---- it reads back as the same elements, and as the same text
await page.reload();
await page.locator('.sidebar').waitFor();
await page.getByText('Elements').first().click();
await page.locator('.toggle-block').waitFor();
check('after a reload every element is back',
  (await page.locator('.toggle-block').count()) === 1 && (await page.locator('.page-break').count()) === 1
  && (await page.locator('.date-chip').count()) === 1 && (await page.locator('.inline-check').count()) === 1 && (await page.locator('.math .katex').count()) >= 2
  && !!(await until(() => page.locator('.diagram-out svg').count().then(n => n > 0), 15000)));
await endOfNote();
await page.keyboard.type(' ');
await page.keyboard.press('Backspace');
await page.waitForTimeout(1800);
const again = await noteBody('Elements');
// a space left at the end of a line is the one thing Markdown does not keep
check('reading and writing again changes nothing', again.trim() === stored.trim() || again.trim() === stored.replace(/ +\n/g, '\n').trim(), again === stored ? '' : '\nSTORED ' + JSON.stringify(stored) + '\nAGAIN  ' + JSON.stringify(again));

// clicking the checkbox ticks it
await page.locator('.inline-check button').first().click();
await page.waitForTimeout(1500);
check('a checkbox can be ticked', (await noteBody('Elements')).includes('Tick ☑'));

// ---- the date mention opens the calendar on that day; the event is listed there
await page.locator('.date-chip').first().click();
await page.getByRole('heading', { name: /October 2026/ }).waitFor({ timeout: 5000 }).catch(() => {});
check('a date mention opens the calendar on its month', await page.getByRole('heading', { name: /October 2026/ }).isVisible());
check('the event shows on the calendar', (await page.locator('.cal-ev.event').count()) > 0 && (await page.locator('.cal-ev.event').first().textContent()).includes('Team sync'));
await page.screenshot({ path: `${shots}/insert-calendar.png` });

// ---- new linked note
await page.getByText('Elements').first().waitFor({ timeout: 3000 }).catch(() => {});
await page.goto(`${base}/#/notes`);
await page.getByText('Elements').first().click();
await page.locator('.prose').waitFor();
await endOfNote();
await page.keyboard.press('Enter');
await choose('New linked note');
await page.getByLabel('Title of the new note').fill('Spin-off');
await page.getByRole('button', { name: 'Create and link' }).click();
await until(async () => (await noteBody('Elements')).includes('Spin-off.md') ? true : null, 8000);
check('a linked note is created and linked with a standard link', (await noteBody('Elements')).includes('[Spin-off](Spin-off.md)') && (await rpc('listItems')).some(i => i.title === 'Spin-off'));

// ---- the slash menu offers the same elements
await endOfNote();
await page.keyboard.press('Enter');
await page.keyboard.type('/tog');
check('the / menu lists the same elements', (await page.locator('.menu[role=listbox] .menu-item').first().textContent())?.includes('Toggle') ?? false);
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');

// ---- line length
const width = async () => page.evaluate(() => Math.round(document.querySelector('.editor-page').getBoundingClientRect().width));
await page.getByRole('button', { name: 'Full screen' }).click();
await page.waitForTimeout(400);
const readable = await width();
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Full width' }).click();
await page.waitForTimeout(500);
const full = await width();
check('Full width gives the text all the room', full > readable + 100 && (await page.locator('.editor-page.full').count()) === 1, `${readable} → ${full}`);
await page.screenshot({ path: `${shots}/insert-full-width.png` });
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Readable line length' }).click();
await page.waitForTimeout(500);
check('Readable line length goes back', (await width()) === readable);
await page.getByRole('button', { name: 'Leave full screen' }).click();

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
