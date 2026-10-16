// Opening a task brings that task into view in its note. usage: node tasks.mjs <baseUrl> <shotsDir>
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

const filler = n => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} of filler text so that the note is long enough to scroll.`).join('\n\n');
const body = ['- [ ] first task near the top', '', filler(40), '', '- [ ] middle task', '', filler(40), '', '- [ ] last task at the very bottom', ''].join('\n');
const note = await rpc('createNote', { title: 'Long list', body });
await until(async () => (await rpc('tasks')).some(t => t.text === 'last task at the very bottom'), 10000);

// ---- the last task of a long note
await page.evaluate(() => {
  window.__flashed = [];
  new MutationObserver(ms => ms.forEach(m => { if (m.target.classList?.contains('task-flash')) window.__flashed.push(m.target.textContent.trim()); })).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
});
await page.evaluate(id => { location.hash = `#/tasks/${id}/2`; }, note.id);
await page.locator('.prose li[data-checked]').first().waitFor({ timeout: 15000 });
const inView = text => page.evaluate(t => {
  const li = [...document.querySelectorAll('.prose li[data-checked]')].find(l => l.textContent.trim() === t);
  const box = document.querySelector('.editor-scroll').getBoundingClientRect();
  if (!li) return null;
  const r = li.getBoundingClientRect();
  return { top: r.top - box.top, bottom: box.bottom - r.bottom, scrolled: document.querySelector('.editor-scroll').scrollTop, flash: li.classList.contains('task-flash') };
}, text);
const seen = await until(async () => { const v = await inView('last task at the very bottom'); return v && v.top >= 0 && v.bottom >= 0 && v.scrolled > 500 ? v : null; }, 8000);
check('opening the third task scrolls the note to it', !!seen, JSON.stringify(await inView('last task at the very bottom')));
check('and the task is lit for a moment so it can be found', !!(await until(async () => (await page.evaluate(() => window.__flashed)).includes('last task at the very bottom'), 3000)), JSON.stringify(await page.evaluate(() => window.__flashed)));
await page.screenshot({ path: `${shots}/task-last.png` });
check('the list marks that task, and not the other tasks of the same note', (await page.locator('.task-row').count()) >= 3);

// ---- another task of the same note: the view moves
await page.goto(`${base}/#/tasks/${note.id}/1`);
const mid = await until(async () => { const v = await inView('middle task'); return v && v.top >= 0 && v.bottom >= 0 ? v : null; }, 8000);
check('another task of the same note brings that one into view', !!mid, JSON.stringify(mid));
await page.goto(`${base}/#/tasks/${note.id}/0`);
const first = await until(async () => { const v = await inView('first task near the top'); return v && v.top >= 0 && v.scrolled < 200 ? v : null; }, 8000);
check('and the first one scrolls back to the top', !!first, JSON.stringify(first));

// ---- from the list of tasks
await page.goto(`${base}/#/tasks`);
await page.locator('.task-row', { hasText: 'last task at the very bottom' }).waitFor({ timeout: 15000 });
await page.locator('.task-row', { hasText: 'last task at the very bottom' }).locator('a.body').click();
check('a task in the list opens at that task (the address carries its place)', !!(await until(async () => page.url().endsWith(`#/tasks/${note.id}/2`), 4000)), page.url());
const again = await until(async () => { const v = await inView('last task at the very bottom'); return v && v.top >= 0 && v.bottom >= 0 && v.scrolled > 500 ? v : null; }, 8000);
check('and the note is scrolled to it', !!again);

// ---- from the search
await page.keyboard.press('Control+k');
await page.getByRole('combobox', { name: 'Search' }).fill('-middle');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
check('a task chosen in the search goes the same way', !!(await until(async () => page.url().endsWith(`#/tasks/${note.id}/1`), 4000)), page.url());
const viaSearch = await until(async () => { const v = await inView('middle task'); return v && v.top >= 0 && v.bottom >= 0 ? v : null; }, 8000);
check('and shows it', !!viaSearch);

check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
