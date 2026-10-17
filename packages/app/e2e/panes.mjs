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

// ---- opening and closing is a movement, not a jump
{
  await page.goto(`${base}/#/notes/${note.id}`);
  await page.locator('.editor-top').waitFor();
  await page.setViewportSize({ width: 1700, height: 900 });
  await settle();
  // click something, then watch one measure every frame for half a second
  const watch = (clickSel, measure) => page.evaluate(async ({ clickSel, measure }) => {
    const get = new Function(`return (${measure})()`);
    const seen = [get()];
    document.querySelector(clickSel).click();
    const t0 = performance.now();
    await new Promise(done => { const tick = () => { seen.push(get()); if (performance.now() - t0 < 500) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
    return seen;
  }, { clickSel, measure });
  const moves = (seen, from, to) => {
    const mid = seen.filter(v => Math.abs(v - from) > 6 && Math.abs(v - to) > 6);
    const dir = Math.sign(to - from);
    const steady = seen.every((v, i) => !i || (v - seen[i - 1]) * dir >= -1);
    return mid.length >= 4 && steady && Math.abs(seen.at(-1) - to) <= 1;
  };
  const w = sel => `() => Math.round(document.querySelector('${sel}')?.getBoundingClientRect().width ?? 0)`;

  let seen = await watch('[aria-label="Collapse sidebar"]', w('.sidebar'));
  check('collapsing the sidebar slides it narrower over several frames', moves(seen, 264, 60), seen.map(Math.round).join(' '));
  seen = await watch('[aria-label="Expand sidebar"]', w('.sidebar'));
  check('and expanding slides it wider', moves(seen, 60, 264), seen.map(Math.round).join(' '));
  await page.evaluate(() => document.querySelector('[aria-label="Collapse sidebar"]').click());
  await page.waitForTimeout(70);
  check('while it changes its content fades in, and that ends with it', await page.evaluate(() => document.querySelector('.sidebar').classList.contains('switching')));
  await page.screenshot({ path: `${shots}/sidebar-collapsing.png`, clip: { x: 0, y: 0, width: 500, height: 500 } });
  await page.waitForTimeout(400);
  check('(it is not left on)', !(await page.evaluate(() => document.querySelector('.sidebar').classList.contains('switching'))));
  await page.evaluate(() => document.querySelector('[aria-label="Expand sidebar"]').click());
  await page.waitForTimeout(70);
  await page.screenshot({ path: `${shots}/sidebar-expanding.png`, clip: { x: 0, y: 0, width: 500, height: 500 } });
  await settle();

  seen = await watch('.list-head [aria-label="Hide the note list"]', w('.pane-list'));
  check('hiding the note list slides it away', moves(seen, 370, 0), seen.map(Math.round).join(' '));
  seen = await watch('.editor-top [aria-label="Show the note list"]', w('.pane-list'));
  check('and showing it slides it back', moves(seen, 0, 370), seen.map(Math.round).join(' '));

  seen = await watch('[aria-label="Close sidebar"]', w('.aside-wrap'));
  check('closing the right sidebar slides it away', moves(seen, 368, 0), seen.map(Math.round).join(' '));
  check('and it is gone from the page afterwards', (await page.locator('.aside-wrap').count()) === 0);
  seen = await watch('[aria-label="Table of contents"], .toc-toggle', w('.pane-body'));
  check('the note makes room for it', seen.length > 4);
  await settle();
  check('opening it again brings it back', (await width('.aside')) > 300);

  seen = await watch('[aria-label="Full screen"]', w('.pane-body'));
  check('full screen widens the note over several frames', moves(seen, seen[0], seen.at(-1)) && seen.at(-1) > 1500, seen.map(Math.round).join(' '));
  await page.keyboard.press('Escape');
  await settle();

  // a folder opens and closes by growing and shrinking
  const F = await rpc('createFolder', { title: 'Branch' });
  for (const t of ['One', 'Two', 'Three']) await rpc('createFolder', { title: t, parent: F.id });
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await settle();
  const branch = page.locator('.nav-item', { hasText: 'Branch' }).first();
  const kidsH = () => page.evaluate(() => { const c = [...document.querySelectorAll('.nav-item')].find(e => e.textContent.includes('Branch'))?.nextElementSibling; return c?.classList.contains('collapse') ? Math.round(c.getBoundingClientRect().height) : 0; });
  check('a folder with folders in it starts closed', (await kidsH()) === 0 && (await page.locator('.nav-item', { hasText: /^One/ }).count()) === 0);
  await branch.locator('.nav-chevron').click();
  const grow = [];
  for (let i = 0; i < 12; i++) { grow.push(await kidsH()); await page.waitForTimeout(25); }
  check('opening a folder grows its branch over several frames', grow[grow.length - 1] >= 90 && grow.filter(h => h > 5 && h < grow[grow.length - 1] - 5).length >= 2, grow.join(' '));
  await branch.locator('.nav-chevron').click();
  const shrink = [];
  for (let i = 0; i < 12; i++) { shrink.push(await kidsH()); await page.waitForTimeout(25); }
  check('closing it shrinks the branch, and it is gone afterwards', shrink[0] > 5 && shrink.at(-1) === 0 && (await page.locator('.nav-item', { hasText: /^One/ }).count()) === 0, shrink.join(' '));
  await branch.locator('.nav-chevron').click();
  await settle();
  check('a branch that is open can be reached with the keyboard, a closed one not', (await page.locator('.nav-item', { hasText: /^One/ }).count()) === 1);
  await branch.locator('.nav-chevron').click();
  await settle();

  // dragging the edge of a pane follows the pointer at once
  const edge = await page.locator('.sidebar .resizer').boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + 200, { steps: 3 });
  const dragged = await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width));
  await page.mouse.up();
  check('dragging a pane edge does not lag behind the pointer', dragged >= 320, dragged);
  check('and letting go ends that', !(await page.evaluate(() => document.documentElement.classList.contains('resizing'))));
  await page.locator('.sidebar .resizer').dblclick();
  await settle();

  // somebody who asked for less motion gets the end state at once
  await page.emulateMedia({ reducedMotion: 'reduce' });
  seen = await watch('[aria-label="Collapse sidebar"]', w('.sidebar'));
  check('with reduced motion the sidebar jumps', seen.filter(v => Math.abs(v - 264) > 6 && Math.abs(v - 60) > 6).length === 0 && Math.abs(seen.at(-1) - 60) <= 1, seen.map(Math.round).join(' '));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('[aria-label="Expand sidebar"]').click();
  await settle();
}

// ---- tags in the editor footer: pills with names while they fit, dots with a panel when they would not
{
  const tagged = await rpc('createNote', { title: 'Tagged', body: 'x', tags: ['projects/alpha-release', 'reading-list', 'meeting-notes', 'ideas', 'later'] });
  await page.goto(`${base}/#/notes/${tagged.id}`);
  await page.locator('.editor-foot .tag-bar').waitFor({ timeout: 15000 });
  const mode = () => page.evaluate(() => document.querySelector('.editor-foot .tag-cluster') ? 'dots' : document.querySelectorAll('.editor-foot .tag-bar > .tag-pill').length ? 'pills' : 'none');
  const foot = () => page.evaluate(() => { const r = document.querySelector('.editor-foot').getBoundingClientRect(); return `${Math.round(r.top)}/${Math.round(r.height)}`; });
  await page.getByRole('button', { name: 'Full screen', exact: true }).click(); // the note alone: the line is as wide as the window
  await page.setViewportSize({ width: 1800, height: 900 });
  await settle();
  check('with room the tags show their names, five pills in one line', (await mode()) === 'pills' && (await page.evaluate(() => { const t = [...document.querySelectorAll('.editor-foot .tag-bar > .tag-pill')].map(e => Math.round(e.getBoundingClientRect().top)); return new Set(t).size === 1 && t.length === 5; })));
  // sweep the width down and up again: the mode changes once each way and never flaps
  const trail = [];
  for (let w = 1800; w >= 800; w -= 20) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(40); trail.push(await mode()); }
  for (let w = 800; w <= 1800; w += 20) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(40); trail.push(await mode()); }
  const flips = trail.filter((m, i) => i && m !== trail[i - 1]).length;
  check('narrowing the window turns the pills into dots once, widening turns them back once', flips === 2 && trail[0] === 'pills' && trail.includes('dots'), `${flips} flips: ${trail.join(',').replace(/(pills,)+/g, 'pills…').replace(/(dots,)+/g, 'dots…')}`);
  check('the footer stays one line tall while it happens', await page.evaluate(() => document.querySelector('.editor-foot').getBoundingClientRect().height < 60));
  await page.setViewportSize({ width: 800, height: 900 });
  await settle();
  check('narrow: only coloured dots are left in the line', (await mode()) === 'dots' && (await page.locator('.editor-foot .tag-cluster .tag-dots .tag-dot').count()) === 5 && (await page.locator('.editor-foot .tag-bar > .tag-pill').count()) === 0);
  check('and the panel is not on screen yet', await page.evaluate(() => getComputedStyle(document.querySelector('.tag-pop')).visibility === 'hidden'));
  const before = { foot: await foot(), cluster: await page.evaluate(() => JSON.stringify(document.querySelector('.tag-cluster').getBoundingClientRect())), input: await page.evaluate(() => JSON.stringify(document.querySelector('.tag-input').getBoundingClientRect())) };
  await page.locator('.tag-cluster').hover();
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => { const p = document.querySelector('.tag-pop-in'); const r = p.getBoundingClientRect(); return { shown: getComputedStyle(document.querySelector('.tag-pop')).visibility === 'visible', names: [...p.querySelectorAll('.tag-pill')].map(e => e.textContent.trim()), above: r.bottom <= document.querySelector('.editor-foot').getBoundingClientRect().top + 1, inside: r.left >= 0 && r.right <= innerWidth }; });
  check('pointing at the dots opens a panel above them with every tag by name', open.shown && open.names.slice().sort().join('|') === 'ideas|later|meeting-notes|projects/alpha-release|reading-list' && open.above && open.inside, JSON.stringify(open));
  const after = { foot: await foot(), cluster: await page.evaluate(() => JSON.stringify(document.querySelector('.tag-cluster').getBoundingClientRect())), input: await page.evaluate(() => JSON.stringify(document.querySelector('.tag-input').getBoundingClientRect())) };
  check('and nothing else moves: footer, dots and field stay exactly where they were', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
  // the pointer can travel from the dots into the panel (it stays open) and remove a tag there
  await page.locator('.tag-pop-in .tag-pill', { hasText: 'later' }).hover();
  await page.waitForTimeout(300);
  check('the panel stays open while the pointer is in it', await page.evaluate(() => getComputedStyle(document.querySelector('.tag-pop')).visibility === 'visible'));
  await page.locator('.tag-pop-in').getByRole('button', { name: 'Remove tag later' }).click();
  check('a tag is removed from the panel', !!(await until(async () => !(await rpc('getNote', tagged.id)).tags.includes('later'))), JSON.stringify((await rpc('getNote', tagged.id)).tags));
  await page.mouse.move(600, 300);
  await page.waitForTimeout(500);
  check('moving away closes it', await page.evaluate(() => getComputedStyle(document.querySelector('.tag-pop')).visibility === 'hidden'));
  // from the keyboard
  await page.locator('.tag-cluster').focus();
  await page.waitForTimeout(400);
  check('the dots can be reached with the keyboard and open the panel too', await page.evaluate(() => getComputedStyle(document.querySelector('.tag-pop')).visibility === 'visible'));
  await page.screenshot({ path: `${shots}/tags-dots.png` });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.keyboard.press('Escape');
  await page.locator('.tag-cluster').blur();
  await page.keyboard.press('Escape');
}

// ---- the collapsed sidebar: one size, one rhythm, no slack
{
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
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
