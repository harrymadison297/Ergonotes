// Copy, Cut and Paste of notes and folders, and picking several of them. usage: node clipboard.mjs <baseUrl> <shotsDir>
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); localStorage.setItem('ergo.exview', 'icons'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => void d.accept());
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
const where = async title => (await items()).find(i => i.title === title && !i.inTrash)?.filePath;

const Src = await rpc('createFolder', { title: 'Source' });
const Dst = await rpc('createFolder', { title: 'Dest' });
await rpc('createNote', { title: 'One', body: '1', parent: Src.id });
await rpc('createNote', { title: 'Two', body: '2', parent: Src.id });
await rpc('createNote', { title: 'Three', body: '3', parent: Src.id });
const Sub = await rpc('createFolder', { title: 'Sub', parent: Src.id });
await rpc('createNote', { title: 'Deep', body: 'd', parent: Sub.id });
await page.goto(`${base}/#/notes?folder=${Src.id}`);
const tile = t => page.locator(`.ex-tile[title="${t}"]`);
await tile('One').waitFor({ timeout: 15000 });

// ---- picking several
await tile('One').click();
await tile('Three').click({ modifiers: ['Shift'] });
const nSel = async () => page.locator('.ex-tile.sel').count();
check('shift+click picks the run between two items', (await nSel()) >= 3, await nSel());
await tile('Two').click({ modifiers: ['Control'] });
check('ctrl+click takes one out of the pick', !(await tile('Two').getAttribute('class')).includes('sel'));
await page.keyboard.press('Control+a');
check('ctrl+A picks everything in the folder', (await nSel()) === 4, await nSel());
await page.screenshot({ path: `${shots}/clipboard-pick.png` });

// ---- copy and paste into another folder: duplicates, the originals stay
await tile('One').click();
await tile('Two').click({ modifiers: ['Control'] });
await page.keyboard.press('Control+c');
await page.getByText('Copied 2 items').waitFor({ timeout: 5000 });
await page.goto(`${base}/#/notes?folder=${Dst.id}`);
await page.locator('.ex-empty').waitFor({ timeout: 15000 });
await page.locator('.explorer').click({ position: { x: 300, y: 300 } });
await page.keyboard.press('Control+v');
await page.getByText('Pasted 2 items').waitFor({ timeout: 10000 });
const one = await until(async () => (await where('One copy')) === 'Dest/One copy.md' && (await where('Two copy')) === 'Dest/Two copy.md');
check('ctrl+V after a copy puts duplicates in the open folder', !!one, `${await where('One copy')} ${await where('Two copy')}`);
check('and the originals are still where they were', (await where('One')) === 'Source/One.md' && (await where('Two')) === 'Source/Two.md');

// ---- cut and paste into a folder that is picked: a move
await page.goto(`${base}/#/notes?folder=${Src.id}`);
await tile('Three').waitFor({ timeout: 15000 });
await tile('Three').click();
await page.keyboard.press('Control+x');
await page.getByText('Cut 1 item').waitFor({ timeout: 5000 });
check('a cut item is shown dimmed', (await tile('Three').getAttribute('class')).includes('cut'));
await tile('Sub').click();
await page.keyboard.press('Control+v');
await page.getByText('Moved 1 item').waitFor({ timeout: 10000 });
check('ctrl+V with a folder picked moves the cut item into it', !!(await until(async () => (await where('Three')) === 'Source/Sub/Three.md')), await where('Three'));
check('a cut is used up by pasting it', (await page.locator('.ex-tile.cut').count()) === 0);

// ---- a folder, and the menu
await page.goto(`${base}/#/notes`);
await page.locator('.ex-tile[title="Source"]').waitFor({ timeout: 15000 });
await page.locator('.ex-tile[title="Source"]').click();
await page.keyboard.press('Control+c');
await page.locator('.ex-tile[title="Dest"]').click({ button: 'right' });
await page.getByRole('menuitem', { name: 'Paste here' }).click();
await page.getByText('Pasted 1 item').waitFor({ timeout: 15000 });
check('a copied folder pasted with the menu arrives with what it holds', !!(await until(async () => (await where('Deep')) && (await items()).some(i => i.filePath === 'Dest/Source copy/Sub/Deep.md')), 15000), JSON.stringify((await items()).map(i => i.filePath).filter(p => p.startsWith('Dest'))));
await page.locator('.ex-tile[title="Dest"]').click({ button: 'right' });
const menuText = await page.locator('[role="menu"]').innerText();
check('the menu lists copy, cut and paste with their keys', ['Copy', 'Cut', 'Paste here'].every(x => menuText.includes(x)) && (await page.locator('[role="menu"] .kbd').allInnerTexts()).some(t => /\+C$/.test(t)), menuText.replace(/\n/g, ' | '));
await page.keyboard.press('Escape');

// ---- delete key, with several picked
await page.goto(`${base}/#/notes?folder=${Dst.id}`);
await tile('One copy').waitFor({ timeout: 15000 });
await tile('One copy').click();
await tile('Two copy').click({ modifiers: ['Control'] });
await page.keyboard.press('Delete');
check('delete moves the picked items to the Trash', !!(await until(async () => !(await where('One copy')) && !(await where('Two copy')))));
check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
