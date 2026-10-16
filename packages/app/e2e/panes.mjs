// Panes: the sidebar, the note list, the right sidebar and the note on its own (full screen), and what they do when opened and closed.
// usage: node panes.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 500) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 100)); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); localStorage.setItem('ergo.prefs', JSON.stringify({ aside: true, asideTab: 'toc' })); } catch { /* ignore */ } });
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
const prefs = () => page.evaluate(() => JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}'));
const width = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return -1; const r = el.getBoundingClientRect(); return getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden' ? 0 : Math.round(r.width); }, sel);
const settle = () => page.waitForTimeout(450);

const note = await rpc('createNote', { title: 'Panes', body: '# One\n\ntext\n\n## Two\n\nmore', tags: [] });
await page.goto(`${base}/#/notes/${note.id}`);
await page.locator('.editor-top').waitFor({ timeout: 15000 });
await settle();

// ---- full screen
const before = { sidebar: await width('.sidebar'), list: await width('.pane-list'), aside: await width('.aside') };
check('to begin with the sidebar, the list and the right sidebar are all there', before.sidebar > 150 && before.list > 200 && before.aside > 200, JSON.stringify(before));
await page.getByRole('button', { name: 'Full screen', exact: true }).click();
await settle();
const full = { sidebar: await width('.sidebar'), list: await width('.pane-list'), aside: await width('.aside-wrap') };
check('full screen leaves only the note: no sidebar, no list, no right sidebar', full.sidebar === 0 && full.list === 0 && full.aside === 0, JSON.stringify(full));
check('and the note takes the whole width', (await width('.pane-body')) > 1500, await width('.pane-body'));
check('it does not touch the stored list setting', (await prefs()).listHidden !== true, JSON.stringify(await prefs()));
await page.keyboard.press('Escape');
await settle();
check('Esc leaves full screen and everything is back', (await prefs()).focus === false && (await width('.sidebar')) === before.sidebar && (await width('.pane-list')) === before.list && (await width('.aside')) === before.aside,
  JSON.stringify({ sidebar: await width('.sidebar'), list: await width('.pane-list'), aside: await width('.aside') }));

// Esc belongs to a menu that is open
await page.getByRole('button', { name: 'Full screen', exact: true }).click();
await settle();
await page.getByRole('button', { name: 'Export' }).click();
await page.locator('.menu').waitFor();
await page.keyboard.press('Escape');
await settle();
check('Esc closes an open menu first and stays in full screen', (await prefs()).focus === true && (await page.locator('.menu').count()) === 0);
await page.keyboard.press('Escape');
await settle();
check('and the next Esc leaves full screen', (await prefs()).focus === false);

// ---- the note list: a button in its own header hides it, the one in the editor shows it again
check('the list header has a Hide button beside an open note', (await page.locator('.list-head').getByRole('button', { name: 'Hide the note list' }).count()) === 1);
await page.locator('.list-head').getByRole('button', { name: 'Hide the note list' }).click();
await settle();
check('it hides the list and the note takes the room', (await width('.pane-list')) === 0 && (await prefs()).listHidden === true);
await page.getByRole('button', { name: 'Show the note list' }).click();
await settle();
check('the editor button brings it back', (await width('.pane-list')) === before.list && (await prefs()).listHidden === false);
await page.getByRole('button', { name: 'Hide the note list' }).first().click();
await settle();
await page.goto(`${base}/#/notes`);
await settle();
check('with no note open the list stays, so the folder view is never alone with a hidden list', (await width('.pane-list')) > 200);
await page.goto(`${base}/#/notes/${note.id}`);
await settle();
check('and it is still hidden when a note is opened again', (await width('.pane-list')) === 0);
await page.keyboard.press('Control+k');
await page.keyboard.type('>note list');
await page.keyboard.press('Enter');
await settle();
check('the command "Show or hide the note list" shows it again', (await width('.pane-list')) === before.list && (await prefs()).listHidden === false, JSON.stringify(await prefs()));

// ---- the collapsed sidebar: one size, one rhythm, no slack
{
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 780 } });
  await c2.addInitScript(() => { try { localStorage.setItem('ergo.rail', '1'); } catch { /* ignore */ } });
  const p2 = await c2.newPage();
  await p2.goto(base);
  await p2.getByLabel('Password').fill(PASSWORD);
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await p2.locator('.sidebar.rail').waitFor({ timeout: 30000 });
  await p2.waitForTimeout(500);
  const m = await p2.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const sr = sb.getBoundingClientRect();
    const els = [...sb.querySelectorAll('.quick > *, .nav > .nav-item, .sidebar-foot .icon-btn')].filter(e => e.offsetParent);
    const boxes = els.map(e => e.getBoundingClientRect());
    // the room between the navigation and the foot is whatever the window leaves: it is not part of the rhythm
    const footTop = Math.min(...[...sb.querySelectorAll('.sidebar-foot .icon-btn')].map(e => e.getBoundingClientRect().top));
    return { railW: Math.round(sr.width), n: boxes.length,
      sizes: [...new Set(boxes.map(r => `${Math.round(r.width)}x${Math.round(r.height)}`))],
      off: Math.max(...boxes.map(r => Math.abs(Math.round(r.left + r.width / 2 - sr.width / 2)))),
      // the quick buttons are ordered search, new, more by CSS; sort by position before taking the gaps
      gaps: boxes.sort((a, b) => a.top - b.top).slice(1).map((r, i, all) => r.top === footTop ? 0 : Math.round(r.top - (i === 0 ? boxes[0].bottom : all[i - 1].bottom))),
      overflowX: sb.scrollWidth > sb.clientWidth, navScroll: document.querySelector('.sidebar .nav').scrollHeight > document.querySelector('.sidebar .nav').clientHeight + 1 };
  });
  check('the collapsed sidebar is no wider than its icons need', m.railW <= 64, m.railW);
  check('every control is the same size and sits in the middle', m.sizes.length === 1 && m.sizes[0] === '36x36' && m.off <= 1, JSON.stringify({ sizes: m.sizes, off: m.off }));
  check('the controls are 4 px apart, and the groups 20 px apart (no other gap)', m.gaps.filter(g => g > 0).every(g => g === 4 || g === 20) && m.gaps.filter(g => g === 20).length >= 4, JSON.stringify(m.gaps));
  check('nothing scrolls or spills', !m.overflowX && !m.navScroll, JSON.stringify(m));
  await p2.screenshot({ path: `${shots}/rail.png`, clip: { x: 0, y: 0, width: 260, height: 780 } });
  await c2.close();
}

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
