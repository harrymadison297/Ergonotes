// Dragging and dropping: notes onto folders inside the app, and files and folders dropped from the computer.
// The drop from the computer is simulated with a DataTransfer-shaped object, folders included (File System Entry API).
// usage: node dnd.mjs <baseUrl> <shotsDir>
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
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); localStorage.setItem('ergo.exview', 'tiles'); } catch { /* ignore */ } });
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
const items = async () => rpc('listItems');

// a folder A with a folder B inside it, and a note in A
const A = await rpc('createFolder', { title: 'Alpha' });
const B = await rpc('createFolder', { title: 'Beta', parent: A.id });
const note = await rpc('createNote', { title: 'Dragged', body: 'x', parent: A.id });
await page.goto(`${base}/#/notes?folder=${A.id}`);
await page.locator('.ex-tile[title="Beta"]').waitFor({ timeout: 15000 });

// ---- a note dragged onto a folder inside the app
await page.locator('.ex-tile[title="Dragged"]').dragTo(page.locator('.ex-tile[title="Beta"]'));
check('a note dragged onto a folder moves into it', !!(await until(async () => (await items()).find(i => i.id === note.id)?.parent === B.id)), JSON.stringify((await items()).find(i => i.id === note.id)?.parent));

// ---- files dropped from the computer onto a folder
// spec: { name, text } | { name, b64 } | { name, dir: [spec…] }
const drop = (selector, specs) => page.evaluate(({ sel, specs }) => {
  const file = s => new File([s.text !== undefined ? s.text : Uint8Array.from(atob(s.b64), c => c.charCodeAt(0))], s.name);
  const entry = s => s.dir
    ? { isFile: false, isDirectory: true, name: s.name, createReader: () => { let at = 0; return { readEntries: ok => { const b = s.dir.slice(at, at + 2); at += 2; ok(b.map(entry)); } }; } }
    : { isFile: true, isDirectory: false, name: s.name, file: ok => ok(file(s)) };
  const dt = { types: ['Files'], dropEffect: 'none', effectAllowed: 'all', items: specs.map(s => ({ kind: 'file', webkitGetAsEntry: () => entry(s) })), files: [] };
  const el = document.querySelector(sel);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    el.dispatchEvent(ev);
  }
}, { sel: selector, specs });
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]).toString('base64');
await drop('.ex-tile[title="Beta"]', [{ name: 'Hello.md', text: '# Hello\nfrom outside' }, { name: 'pic.png', b64: PNG }]);
await page.getByText(/Imported 1 note, 1 file/).waitFor({ timeout: 10000 });
// a file written a moment ago is taken in when the folder is looked at again (it may still be being written)
const hello = await until(async () => (await items()).find(i => i.title === 'Hello'), 8000);
check('a Markdown file dropped on a folder becomes a note in it', hello?.parent === B.id, JSON.stringify(hello?.filePath));
const pic = await until(async () => (await rpc('listFiles')).find(f => f.name === 'pic.png'), 8000);
check('and a picture dropped with it is kept as a file in that folder', pic?.path === 'Alpha/Beta/pic.png', JSON.stringify(pic?.path));

// ---- a folder dropped from the computer onto the folder that is open
await page.locator('.ex-body').waitFor();
await drop('.ex-body', [{ name: 'Trip', dir: [
  { name: 'Plan.md', text: 'see ![map](map.png)' },
  { name: 'map.png', b64: PNG },
  { name: 'deep', dir: [{ name: 'Notes.md', text: 'deeper' }, { name: 'run.exe', b64: 'AAAA' }] },
  { name: 'Packages.json', text: '{}' },
] }]);
await page.getByText(/Imported 2 notes, 1 file, 2 new folders \(2 skipped\)/).waitFor({ timeout: 10000 });
const plan = await until(async () => (await items()).find(i => i.title === 'Plan'), 8000);
await until(async () => (await items()).some(i => i.filePath === 'Alpha/Trip/deep/Notes.md'), 8000);
check('a dropped folder keeps its folders and notes', plan?.filePath === 'Alpha/Trip/Plan.md' && (await items()).some(i => i.filePath === 'Alpha/Trip/deep/Notes.md'), JSON.stringify(plan?.filePath));
check('and the picture its note links to is beside it', (await rpc('getFileByPath', 'Alpha/Trip/map.png'))?.name === 'map.png');
check('what a note cannot hold is left out and counted', !(await rpc('listFiles')).some(f => f.name === 'run.exe' || f.name === 'Packages.json'));
await page.screenshot({ path: `${shots}/dnd.png` });

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
