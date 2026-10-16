// The search popup (Ctrl+K): notes, folders, tasks, tags, pages and commands. usage: node palette.mjs <baseUrl> <shotsDir>
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
const groceries = await rpc('createNote', { title: 'Groceries', body: '- [ ] buy milk\n- [x] call anna about the invoice', tags: ['home'] });
const plan = await rpc('createNote', { title: 'Work plan', body: 'quarterly goals', tags: ['work', 'home'] });
await rpc('createNote', { title: 'Taxes', body: '- [ ] file the return', tags: ['work'] });
await page.goto(`${base}/#/`);
await page.locator('.sidebar').waitFor();
await until(async () => (await page.evaluate(() => document.body.innerText)).includes('Groceries'), 15000);

const open = async () => { await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: 'Search' }).waitFor({ timeout: 5000 }); };
const groups = () => page.locator('.palette-group').allInnerTexts();
const titles = () => page.locator('.palette-item .ttl').allInnerTexts();
const type = async t => { await page.getByRole('combobox', { name: 'Search' }).fill(t); await page.waitForTimeout(450); };

// ---- nothing typed
await open();
check('with nothing typed it shows the notes touched last, and says how to reach the rest', (await groups()).includes('Recent notes') && (await page.locator('.palette-foot').innerText()).includes('commands'));
await page.screenshot({ path: `${shots}/palette-empty.png` });

// ---- a task
await type('milk');
check('a task shows up in the search, with its note', (await groups()).includes('Tasks') && (await titles()).includes('buy milk') && (await page.locator('.palette-item', { has: page.locator('.ttl', { hasText: /^buy milk$/ }) }).innerText()).includes('Groceries'));
await page.screenshot({ path: `${shots}/palette-task.png` });
await page.locator('.palette-item', { has: page.locator('.ttl', { hasText: /^buy milk$/ }) }).click();
check('opening it goes to that task of that note', !!(await until(async () => page.url().endsWith(`#/tasks/${groceries.id}/0`), 4000)), page.url());

// ---- a tag, and notes with the same word
await open();
await type('work');
check('a tag is found beside the notes that match', (await groups()).includes('Tags') && (await groups()).includes('Notes') && (await titles()).includes('work'));
await page.locator('.palette-item', { has: page.locator('.ttl', { hasText: /^work$/ }) }).click();
check('opening a tag lists its notes', !!(await until(async () => page.url().includes('tag=work'), 4000)), page.url());

// ---- commands
await open();
await type('sidebar');
const cmd = page.locator('.palette-item', { hasText: 'Show or hide the sidebar' });
check('a command is found by what it does, and shows its keys', (await groups()).includes('Commands') && (await cmd.innerText()).includes('Ctrl+\\'), await cmd.innerText().catch(() => ''));
await page.keyboard.press('Escape');
await open();
await type('>focus');
check('“>” shows commands only', (await groups()).every(g => g === 'Commands' || g === 'Pages') && (await titles()).includes('Focus on the note'), (await groups()).join('|'));
await page.keyboard.press('Enter');
check('Enter runs the command', !!(await until(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}').focus)) === true, 4000)));
await open();
await type('>focus');
await page.keyboard.press('Enter');
check('and again undoes it', !!(await until(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}').focus)) === false, 4000)));
await open();
await type('>');
check('“>” alone lists every command', (await titles()).length >= 15, (await titles()).length);
await page.keyboard.press('Escape');

// ---- pages
await open();
await type('>go to files');
check('pages are commands too, grouped as Pages', (await groups()).includes('Pages'));
await page.keyboard.press('Enter');
check('and take you there', !!(await until(async () => page.url().endsWith('#/files'), 4000)), page.url());

// ---- tags and tasks only
await open();
await type('#');
const tagTitles = await titles();
check('“#” lists the tags with their counts', (await groups()).join() === 'Tags' && tagTitles.includes('home') && tagTitles.includes('work'), tagTitles.join(','));
await type('#wo');
check('and filters them', (await titles()).join() === 'work');
await type('-');
const taskTitles = await titles();
check('“-” lists the tasks, open ones first', (await groups()).join() === 'Tasks' && taskTitles.length >= 3 && taskTitles.includes('buy milk') && taskTitles.at(-1) === 'call anna about the invoice', taskTitles.join(' | '));
await type('-return');
check('and filters them', (await titles()).join() === 'file the return');
await page.keyboard.press('Enter');
check('Enter on a task opens it', !!(await until(async () => /#\/tasks\/[0-9a-f-]{36}\/0$/.test(page.url()), 4000)), page.url());

// ---- keyboard: arrows move, Enter opens the one chosen
await open();
await type('plan');
await page.keyboard.press('ArrowDown');
check('the arrows move through the groups', (await page.locator('.palette-item[aria-selected="true"] .ttl').count()) === 1);
await page.keyboard.press('Escape');
check('Esc closes it', (await page.getByRole('dialog', { name: 'Search' }).count()) === 0);

check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
