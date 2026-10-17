// End-to-end smoke test: drives the real web build served by the Server peer in headless Chromium.
// usage: node smoke.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
/** Poll until `fn` returns something truthy (or `ms` pass); replaces fixed sleeps before persistence checks. */
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise(r => setTimeout(r, 150));
  }
};
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// the reference UI starts with the icon rail; most checks here use the full sidebar with its folder tree
await ctx.addInitScript(() => { try { if (localStorage.getItem('ergo.rail') === null) localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base);
await page.getByRole('heading', { name: 'Set up Ergonotes' }).waitFor({ timeout: 15000 });
check('first run shows setup', true);
await page.getByLabel('Vault password').fill(PASSWORD);
await page.getByLabel('Repeat password').fill(PASSWORD);
await page.getByRole('button', { name: 'Create vault' }).click();
await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 30000 });
check('vault created and shell visible', true);
await page.locator('.home h1').waitFor();
check('home screen rendered', true);
check('default folders listed', (await page.getByRole('link', { name: 'Inbox' }).count()) > 0);
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/01-home.png` });

// new note
await page.getByRole('button', { name: 'New note (Ctrl+N)' }).click();
await page.getByLabel('Title').waitFor();
await page.getByLabel('Title').fill('Property listings');
await page.getByLabel('Title').press('Enter');
const body = page.locator('.prose');
await body.click();
await page.keyboard.type('A curated selection of available listings.');
await page.keyboard.press('Enter');
await page.keyboard.type('## 5347 Silver Lake Dr.');
await page.keyboard.press('Enter');
await page.keyboard.type('- 3 bed, 2 bath');
await page.keyboard.press('Enter');
await page.keyboard.type('1,980 sqft');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('[ ] Call the agent');
await page.keyboard.press('Enter');
await page.keyboard.type('Book a viewing');
await page.waitForTimeout(1200);
check('note saved', await page.getByText('All changes saved').isVisible());
check('table of contents lists the heading', (await page.locator('.toc .toc-item', { hasText: '5347 Silver Lake Dr.' }).count()) === 1);
await page.getByRole('button', { name: 'Hide table of contents' }).click();
check('table of contents can be hidden', await page.locator('.toc').waitFor({ state: 'detached', timeout: 3000 }).then(() => true, () => false));
await page.getByRole('button', { name: 'Show table of contents' }).click();
check('and shown again', (await page.locator('.toc').count()) === 1);
const tagInput = page.getByLabel('Add tag');
await tagInput.fill('Business');
await tagInput.press('Enter');
await page.waitForTimeout(400);
check('tag shown as a coloured pill', (await page.locator('.editor-foot .tag-pill', { hasText: 'Business' }).count()) === 1);
await page.screenshot({ path: `${shots}/02-note.png` });

// persisted through the server: reload and reopen
await page.reload();
await page.getByRole('navigation', { name: 'Main' }).waitFor();
await page.getByRole('button', { name: 'Unlock' }).count();
await page.goto(`${base}/#/notes`);
await page.getByText('Property listings').first().waitFor({ timeout: 10000 });
check('note listed after reload', true);
await page.getByText('Property listings').first().click();
await page.locator('.prose').waitFor();
const text = await page.locator('.prose').innerText();
check('body persisted', text.includes('5347 Silver Lake Dr.') && text.includes('Call the agent'), JSON.stringify(text.slice(0, 80)));
check('checklist survives the markdown round trip', (await page.locator('.prose ul[data-type="taskList"] li').count()) === 2);
check('bullet list survives', (await page.locator('.prose ul:not([data-type]) li').count()) === 2);

// tasks
await page.goto(`${base}/#/tasks`);
await page.getByText('Call the agent').first().waitFor({ timeout: 10000 });
check('tasks view lists the checklist item', true);
await page.screenshot({ path: `${shots}/03-tasks.png` });
await page.getByRole('checkbox', { name: /Complete Call the agent/ }).click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: 'Completed' }).click();
check('task completes', (await page.getByText('Call the agent').count()) > 0);

// search
await page.goto(`${base}/#/notes`);
await page.keyboard.press('Control+k');
const combo = page.getByRole('combobox', { name: 'Search' });
await combo.fill('silver');
await page.locator('.palette-item', { hasText: 'Property listings' }).waitFor({ timeout: 10000 });
check('search popup shows the note with the matching passage', (await page.locator('.palette-item mark').count()) > 0);
await page.screenshot({ path: `${shots}/04a-search.png` });
await combo.press('Enter');
await page.getByLabel('Title').waitFor();
check('Enter opens the result', (await page.getByLabel('Title').inputValue()) === 'Property listings');
await page.keyboard.press('Control+k');
await combo.fill('inbox');
await page.locator('.palette-item .ico.folder').first().waitFor({ timeout: 10000 });
check('folders are found by name in the popup', true);
await page.keyboard.press('Escape');


// calendar + folders
await page.goto(`${base}/#/calendar`);
await page.getByRole('grid', { name: 'Calendar' }).waitFor();
await page.screenshot({ path: `${shots}/04-calendar.png` });
await page.goto(`${base}/#/folders`);
await page.getByRole('heading', { name: 'Folders' }).waitFor();
await page.screenshot({ path: `${shots}/05-folders.png` });

// slash command inserts a table
await page.goto(`${base}/#/notes`);
await page.locator('.note-row', { hasText: 'Property listings' }).first().click();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.keyboard.type('/table');
await page.waitForTimeout(300);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('slash command inserts a table', (await page.locator('.prose table').count()) === 1);
await page.waitForTimeout(1200);
await page.reload();
await page.locator('.prose').waitFor();
check('table and tasks survive a reload', (await page.locator('.prose table').count()) === 1 && (await page.locator('.prose ul[data-type="taskList"] li').count()) === 2);
await page.screenshot({ path: `${shots}/06-note-table.png` });
// Enter inside a table cell moves on instead of splitting it; the table must still be saved as a table
await page.locator('.prose table td').last().click();
await page.keyboard.type('x');
await page.keyboard.press('Enter');
await page.keyboard.type('y');
{
  const rpcT = (m, ...a) => page.evaluate(async ([m, a]) => (await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json(), [m, a]);
  const n = (await rpcT('listItems')).find(i => i.title === 'Property listings');
  const saved = (await until(async () => { const b = (await rpcT('getNote', n.id)).body; return b.includes('| y ') ? b : null; })) ?? (await rpcT('getNote', n.id)).body;
  check('a table keeps its Markdown form after Enter in a cell', saved.includes('| ') && !saved.includes('[table]'), JSON.stringify(saved.slice(-160)));
}

// attachments: a CSV is stored as a file item and previewed as a table
await page.goto(`${base}/#/notes`);
await page.locator('.note-row', { hasText: 'Property listings' }).first().click();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.setInputFiles('input[type=file]', { name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('city,price\nOslo,100\n"Bergen, NO",90\n') });
await page.getByRole('link', { name: 'prices.csv' }).waitFor({ timeout: 10000 });
await page.getByRole('link', { name: 'prices.csv' }).click();
await page.getByRole('dialog', { name: 'prices.csv' }).waitFor();
check('csv attachment previews as a table', (await page.getByRole('dialog').getByText('Bergen, NO').count()) === 1);
await page.screenshot({ path: `${shots}/10-csv-preview.png` });
await page.keyboard.press('Escape');

// files page lists the attachment and previews it beside the list
await page.goto(`${base}/#/files`);
await page.locator('.file-card', { hasText: 'prices.csv' }).waitFor({ timeout: 10000 });
await page.locator('.file-card', { hasText: 'Property listings' }).waitFor({ timeout: 10000 }).then(
  () => check('files page lists the attachment with its note', true),
  async () => {
    const rpc = (m, ...a) => page.evaluate(async ([m, a]) => (await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json(), [m, a]);
    const items = await rpc('listItems');
    const n = items.find(i => i.title === 'Property listings');
    const body = n ? (await rpc('getNote', n.id)).body : null;
    const files = await rpc('listFiles');
    check('files page lists the attachment with its note', false, JSON.stringify({ cards: await page.locator('.file-card').allInnerTexts(), body: body && body.slice(-200), files }));
  });
await page.locator('.file-card', { hasText: 'prices.csv' }).click();
await page.getByText('Bergen, NO').waitFor({ timeout: 10000 });
check('file preview opens beside the list', true);
await page.screenshot({ path: `${shots}/10b-files.png` });

// create menu next to New note
await page.goto(`${base}/#/`);
await page.getByRole('button', { name: 'Create…' }).click();
check('create menu offers template and folder', (await page.getByRole('menuitem', { name: 'Note from template' }).count()) === 1 && (await page.getByRole('menuitem', { name: 'Folder' }).count()) === 1);
await page.keyboard.press('Escape');
await page.goto(`${base}/#/notes`);
await page.locator('.note-row', { hasText: 'Property listings' }).first().click();

// wiki link picker
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
await page.keyboard.press('Enter');
await page.keyboard.type('See [[Welcome');
await page.waitForTimeout(500);
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('link inserted from the [[ picker is a standard link to the note file', (await page.locator('.prose a[href$="Welcome%20to%20Ergonotes.md"]').count()) === 1);
{
  // clicking it opens that note
  await page.locator('.prose a[href$="Welcome%20to%20Ergonotes.md"]').click();
  check('the link opens the note it points at', !!(await until(async () => (await page.getByLabel('Title').inputValue()) === 'Welcome to Ergonotes')));
  await page.goBack();
}

// drawing block: opens the board and keeps an (empty) drawing block when done
await page.getByRole('button', { name: /Insert/ }).click();
await page.getByRole('option', { name: /^Sketch/ }).click();
await page.getByRole('dialog', { name: 'Drawing' }).waitFor({ timeout: 30000 });
// keys go to the drawing board (rectangle tool), not to the note under it; then draw and finish
await page.locator('.excalidraw canvas').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(300);
await page.keyboard.press('r');
const board = await page.locator('.excalidraw canvas').last().boundingBox();
await page.mouse.move(board.x + 420, board.y + 300); await page.mouse.down();
await page.mouse.move(board.x + 600, board.y + 400, { steps: 5 }); await page.mouse.up();
await page.getByRole('button', { name: 'Done' }).click();
await page.locator('.excalidraw-block img.drawing').first().waitFor({ timeout: 10000 });
check('first drawing saves with its strokes, and keys did not touch the note', !(await page.locator('.prose').innerText()).split('\n').some(l => l.trim() === 'r'));
await page.waitForTimeout(500);
check('drawing block present', (await page.locator('.excalidraw-block').count()) === 1);
await page.waitForTimeout(1500);

// an ergonote-* block this build does not know must survive an edit round trip untouched
const call = (method, ...args) => page.evaluate(async ([m, a]) => (await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json(), [method, args]);
const unk = await call('createNote', { title: 'Unknown block', body: 'before\n\n```ergonote-future\n{"a":1,"b":[1,2,3]}\n```\n\nafter' });
await page.goto(`${base}/#/notes/${unk.id}`);
await page.locator('.prose').waitFor();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' edited');
await page.waitForTimeout(1500);
const unkBody = (await call('getNote', unk.id)).body;
check('unknown ergonote block round-trips through an edit', unkBody.includes('```ergonote-future\n{"a":1,"b":[1,2,3]}\n```') && unkBody.includes('after edited'), JSON.stringify(unkBody));

// resizable sidebar
const sbW0 = (await page.locator('.sidebar').boundingBox()).width;
const rz = await page.getByRole('separator', { name: 'Resize sidebar' }).boundingBox();
await page.mouse.move(rz.x + rz.width / 2, rz.y + 200);
await page.mouse.down();
await page.mouse.move(rz.x + rz.width / 2 + 80, rz.y + 200, { steps: 6 });
await page.mouse.up();
const sbW1 = (await page.locator('.sidebar').boundingBox()).width;
check('sidebar can be resized by dragging its edge', sbW1 > sbW0 + 60, `${Math.round(sbW0)} -> ${Math.round(sbW1)}`);
await page.getByRole('separator', { name: 'Resize sidebar' }).dblclick();
await page.waitForTimeout(400); // the sidebar eases back
check('double-click resets the width', Math.abs((await page.locator('.sidebar').boundingBox()).width - sbW0) < 2);

// type scale: every rendered text size comes from the reference scale
const oddSizes = async () => page.evaluate(() => {
  const bad = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg, .ex-paper, .excalidraw')) continue;
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (![11, 12, 13, 14, 15, 16, 18, 22, 24, 30].includes(px)) bad.add(`${px}px ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
  }
  return [...bad];
});
for (const route of ['#/', '#/notes', '#/tasks', '#/calendar', '#/folders']) {
  await page.goto(`${base}/${route}`);
  await page.waitForTimeout(500);
  const bad = await oddSizes();
  check(`all text sizes are on the scale on ${route}`, bad.length === 0, bad.slice(0, 5).join(', '));
}

// pinned and trash with undo
await page.goto(`${base}/#/notes`);
await page.locator('.note-row', { hasText: 'Property listings' }).first().click();
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click();
await page.locator('.nav-children a.nav-item', { hasText: 'Property listings' }).waitFor({ timeout: 10000 });
check('a pinned note appears under Pinned', true);
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Move to trash' }).click();
await page.locator('.toast-action', { hasText: 'Undo' }).waitFor({ timeout: 5000 });
check('trashing offers Undo', true);
await page.locator('.toast-action', { hasText: 'Undo' }).click();
await page.waitForTimeout(600);
await page.goto(`${base}/#/notes`);
check('Undo brings the note back', (await page.locator('.note-row', { hasText: 'Property listings' }).count()) > 0);
await page.getByRole('button', { name: 'Unpin' }).count();

// hide the list and go full screen: the note must stay on screen
await page.goto(`${base}/#/notes`);
await page.locator('.note-row', { hasText: 'Property listings' }).first().click();
await page.getByRole('button', { name: 'Hide the note list' }).click();
await page.waitForTimeout(250);
const hiddenBox = await page.locator('.pane-body').boundingBox();
check('hiding the note list leaves the note visible and wider', !!hiddenBox && hiddenBox.width > 700 && (await page.locator('.pane-list').count()) === 1 && !(await page.locator('.pane-list').isVisible()));
await page.getByRole('button', { name: 'Full screen' }).click();
await page.waitForTimeout(250);
const fullBox = await page.locator('.pane-body').boundingBox();
check('full screen shows only the note', !!fullBox && fullBox.width > 1300 && !(await page.locator('.sidebar').isVisible()));
await page.getByRole('button', { name: 'Leave full screen' }).click();
await page.getByRole('button', { name: 'Show the note list' }).click();
await page.waitForTimeout(250);
check('both come back', (await page.locator('.sidebar').isVisible()) && (await page.locator('.pane-list').isVisible()));

// folder explorer, drag and drop, icon-only sidebar
await page.goto(`${base}/#/notes`);
await page.locator('.ex-tile', { hasText: 'Inbox' }).dblclick();
await page.locator('.ex-tile', { hasText: 'Property listings' }).waitFor({ timeout: 10000 });
check('an open folder fills the right pane like a file manager', true);
await page.screenshot({ path: `${shots}/05a-explorer.png` });
await page.locator('.ex-tile', { hasText: 'Property listings' }).dragTo(page.locator('.nav-item', { has: page.getByRole('link', { name: 'Projects' }) }).first());
await page.locator('.ex-tile', { hasText: 'Property listings' }).waitFor({ state: 'detached', timeout: 10000 });
check('dragging a note onto a sidebar folder moves it', true);
await page.getByRole('button', { name: 'Collapse sidebar' }).click();
await page.waitForTimeout(300);
check('sidebar collapses to icons', (await page.locator('.sidebar.rail').count()) === 1 && (await page.locator('.sidebar.rail .new-pill-label').isVisible()) === false);
await page.screenshot({ path: `${shots}/05b-rail.png` });
await page.getByRole('button', { name: 'Expand sidebar' }).click();

// mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(base);
await mp.getByLabel('Password').fill(PASSWORD);
await mp.getByRole('button', { name: 'Sign in' }).click();
await mp.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 20000 });
await mp.waitForTimeout(600);
await mp.screenshot({ path: `${shots}/07-mobile-notes.png` });
check('mobile bottom navigation present', (await mp.locator('.bottom-nav').count()) === 1);
await mp.goto(`${base}/#/`);
await mp.locator('.home h1').waitFor();
check('mobile has a home screen with notes and a scratch pad', (await mp.locator('.home .card.create').count()) === 1 && (await mp.locator('.home .scratch-box .ProseMirror').count()) === 1);
check('mobile home has no horizontal overflow', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await mp.screenshot({ path: `${shots}/07a-mobile-home.png` });
await mp.goto(`${base}/#/tasks`);
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${shots}/08-mobile-tasks.png` });
await mp.goto(`${base}/#/notes`);
await mp.locator('.m-cards .card', { hasText: 'Property listings' }).first().click();
await mp.waitForTimeout(700);
await mp.screenshot({ path: `${shots}/09-mobile-note.png` });
check('mobile note editor opens', (await mp.locator('.m-note .prose').count()) === 1);

const real = errors.filter(e => !/favicon|ResizeObserver/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
