// The right-click menu of notes, folders and files, in the Explorer, the note list, the sidebar and the Files page.
// usage: node menu.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); localStorage.setItem('ergo.exview', 'icons'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// the app asks its own questions (state/confirm.tsx); answer OK
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Are you sure\?|Please confirm)$/ }), async d => { await d.locator('footer button').last().click(); });
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
const items = async () => rpc('listItems');
const entriesOf = async () => (await page.locator('[role="menu"] [role="menuitem"]').allInnerTexts()).map(t => t.trim());

const A = await rpc('createFolder', { title: 'Alpha' });
const B = await rpc('createFolder', { title: 'Beta', parent: A.id });
const N = await rpc('createNote', { title: 'My Note', body: 'hello', parent: A.id });
await rpc('createNote', { title: 'Inside', body: 'deep', parent: B.id });
await page.goto(`${base}/#/notes?folder=${A.id}`);
await page.locator('.ex-tile[title="My Note"]').waitFor({ timeout: 15000 });

// ---- a note in the Explorer
await page.locator('.ex-tile[title="My Note"]').click({ button: 'right' });
let e = await entriesOf();
check('a note offers open, rename, move, duplicate, copy link, pin and trash', ['Open', 'Rename…', 'Move to…', 'Duplicate', 'Copy link', 'Pin to sidebar', 'Move to trash'].every(x => e.includes(x)), e.join(' | '));
check('there is no “show in folder” in a browser (nothing to show it in)', !e.includes('Show in folder'));
await page.screenshot({ path: `${shots}/menu-note.png` });
await page.getByRole('menuitem', { name: 'Copy link' }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copy link puts a Markdown link to the note on the clipboard', clip === '[My Note](Alpha/My%20Note.md)', clip);
await page.locator('.ex-tile[title="My Note"]').click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Duplicate' }).click();
const dup = await until(async () => (await items()).find(i => i.title === 'My Note copy'));
check('duplicate makes “My Note copy” beside it, with the same text', dup?.parent === A.id && (await rpc('getNote', dup.id)).body === 'hello', JSON.stringify(dup && [dup.title, dup.parent]));
await page.getByText('Duplicated “My Note”').waitFor({ timeout: 5000 });
check('and says so, and the copy shows in the folder', (await page.locator('.ex-tile[title="My Note copy"]').count()) === 1);

// ---- a folder
await page.locator('.ex-tile[title="Beta"]').click({ button: 'right' });
e = await entriesOf();
check('a folder offers new note, new subfolder, duplicate and copy path', ['Open', 'New note here', 'New subfolder', 'Duplicate', 'Copy path', 'Use for new captures'].every(x => e.includes(x)), e.join(' | '));
await page.getByRole('menuitem', { name: 'Duplicate' }).click();
const bc = await until(async () => (await items()).find(i => i.title === 'Beta copy'));
const inner = await until(async () => (await items()).find(i => i.filePath === 'Alpha/Beta copy/Inside.md'));
check('duplicating a folder copies what is in it', !!bc && !!inner, JSON.stringify((await items()).map(i => i.filePath).filter(p => p.includes('Beta'))));

// ---- the note list, the sidebar, a pinned note
await page.goto(`${base}/#/notes/${N.id}?folder=${A.id}`);
await page.locator('.note-row').first().waitFor({ timeout: 15000 });
await page.locator('.note-row', { hasText: 'My Note' }).first().click({ button: 'right' });
e = await entriesOf();
check('a note in the list has the same menu', ['Open', 'Duplicate', 'Copy link', 'Move to trash'].every(x => e.includes(x)), e.join(' | '));
await page.keyboard.press('Escape');
await page.locator('.sidebar .nav-item', { hasText: 'Alpha' }).first().click({ button: 'right' });
e = await entriesOf();
check('a folder in the sidebar has the folder menu', ['New note here', 'Duplicate', 'Copy path', 'Move to trash'].every(x => e.includes(x)), e.join(' | '));
await page.keyboard.press('Escape');
await rpc('setPinned', N.id, true);
await page.reload();
await page.locator('.sidebar a.nav-item', { hasText: 'My Note' }).first().click({ button: 'right' });
e = await entriesOf();
check('a pinned note in the sidebar has the note menu, with Unpin', e.includes('Unpin') && e.includes('Duplicate'), e.join(' | '));
await page.keyboard.press('Escape');

// ---- the Files page
await rpc('addFile', { name: 'photo.png', mime: 'image/png', data: Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64') });
await page.goto(`${base}/#/files`);
await page.locator('.file-card', { hasText: 'photo.png' }).waitFor({ timeout: 15000 });
await page.locator('.file-card', { hasText: 'photo.png' }).click({ button: 'right' });
e = await entriesOf();
check('a file has open, copy link and delete', ['Open', 'Copy link', 'Delete…'].every(x => e.includes(x)), e.join(' | '));
await page.getByRole('menuitem', { name: 'Copy link' }).click();
check('its link is an image link to the file', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('![photo.png](attachments/photo'), await page.evaluate(() => navigator.clipboard.readText()));
await page.locator('.file-card', { hasText: 'photo.png' }).click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Delete…' }).click();
await page.getByRole('dialog', { name: /^(Are you sure\?|Please confirm)$/ }).locator('footer button').last().click({ timeout: 2000 }).catch(() => {}); // the handler above may have answered it already
check('delete removes the file (after the question)', !!(await until(async () => !(await rpc('listFiles')).some(f => f.name === 'photo.png'), 8000)));

check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
