// Keyboard shortcuts and the size of the text in notes. usage: node keys.mjs <baseUrl> <shotsDir>
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
const note = await rpc('createNote', { title: 'Zoom me', body: '# Heading\n\nSome body text to read.\n\n- one\n- two' });

// ---- the shortcuts that were always there still work
await page.goto(`${base}/#/`);
await page.keyboard.press('Control+k');
await page.getByRole('dialog', { name: 'Search' }).waitFor({ timeout: 5000 });
check('Ctrl+K opens the search', true);
await page.keyboard.press('Escape');
await page.keyboard.press('g');
await page.keyboard.press('t');
check('g then t goes to Tasks', !!(await until(async () => page.url().includes('#/tasks'), 3000)), page.url());
await page.keyboard.press('Shift+/');
await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 });
check('? opens the shortcuts, in Settings', (await page.getByRole('tab', { name: 'Keyboard' }).getAttribute('aria-selected')) === 'true');
await page.keyboard.press('Escape');
await page.keyboard.press('Alt+n');
check('Alt+N makes a note', !!(await until(async () => /#\/notes\/[0-9a-f-]{36}/.test(page.url()), 5000)), page.url());

// ---- the size of the text
await page.goto(`${base}/#/notes/${note.id}`);
await page.locator('.prose').waitFor({ timeout: 15000 });
const size = () => page.evaluate(() => ({ body: parseFloat(getComputedStyle(document.querySelector('.prose')).fontSize), h1: parseFloat(getComputedStyle(document.querySelector('.prose h1')).fontSize), title: parseFloat(getComputedStyle(document.querySelector('.title-input')).fontSize) }));
const s100 = await size();
await page.locator('.prose p').first().click();
await page.keyboard.press('Control+=');
const s110 = await until(async () => { const s = await size(); return s.body > s100.body ? s : null; });
check('Ctrl+= makes the text larger, while typing in the note', !!s110 && Math.abs(s110.body / s100.body - 1.1) < 0.01 && Math.abs(s110.h1 / s100.h1 - 1.1) < 0.01, JSON.stringify([s100, s110]));
check('the headings grow with it, and the title field and the rest of the app do not', !!s110 && s110.title === s100.title);
await page.keyboard.press('Control+=');
await page.keyboard.press('Control+-');
await page.keyboard.press('Control+-');
await page.keyboard.press('Control+-');
const s90 = await until(async () => { const s = await size(); return s.body < s100.body ? s : null; });
check('Ctrl+- makes it smaller', !!s90 && Math.abs(s90.body / s100.body - 0.9) < 0.01, JSON.stringify(s90));
await page.keyboard.press('Control+0');
check('Ctrl+0 goes back to normal', !!(await until(async () => Math.abs((await size()).body - s100.body) < 0.01)));
await page.getByRole('button', { name: 'Larger text' }).click();
await page.getByRole('button', { name: 'Larger text' }).click();
check('the buttons in the toolbar do the same, and show the size', !!(await until(async () => (await page.locator('.zoom-pct').innerText()) === '120%')) && Math.abs((await size()).body / s100.body - 1.2) < 0.01);
// (a wheel turned with Ctrl held: the browser's own pinch-zoom would take it, so the page must claim the event)
const claimed = await page.evaluate(() => {
  const ev = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
  document.querySelector('.editor-scroll').dispatchEvent(ev);
  return ev.defaultPrevented;
});
check('the page claims a Ctrl + wheel event (so the browser does not zoom the whole page)', claimed);
check('Ctrl + wheel over the note changes it too', !!(await until(async () => (await page.locator('.zoom-pct').innerText()) === '130%')), await page.locator('.zoom-pct').innerText());
await page.screenshot({ path: `${shots}/zoom-130.png` });
await page.reload();
await page.locator('.prose').waitFor();
check('the size is remembered on this device', (await page.locator('.zoom-pct').innerText()) === '130%' && Math.abs((await size()).body / s100.body - 1.3) < 0.01);
await page.getByRole('button', { name: /Text size 130%, reset/ }).click();
check('clicking the size resets it', (await page.locator('.zoom-pct').innerText()) === '100%');
for (let i = 0; i < 6; i++) await page.keyboard.press('Control+-');
await page.waitForTimeout(300);
check('it stops at 70%', (await page.locator('.zoom-pct').innerText()) === '70%' && (await page.getByRole('button', { name: 'Smaller text' }).isDisabled()));
await page.keyboard.press('Control+0');

check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
