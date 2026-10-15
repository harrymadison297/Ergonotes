// Visual QA: every element of a note, and the menus and dialogs around it, at phone / tablet / desktop widths, light and dark.
// It fails when anything is wider than its screen or the note is squeezed to nothing; the screenshots are for the eyes.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
// usage: node layout.mjs <baseUrl> <shotsDir>   (ONLY=phone,tablet THEMES=light narrow the run)
const base = process.argv[2] ?? 'http://127.0.0.1:8080', PW = 'correct horse battery staple', OUT = process.argv[3] ?? './shots';
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + String(x).slice(0, 300) : ''}`); if (!ok) fails++; };
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

const BODY = [
  '# A very long title for a heading that goes on and on to see whether it wraps on a narrow phone screen without breaking',
  'Intro with a date @date(2026-10-20), a box ☐ and a done box ☑, an inline formula $\\int_0^1 x^2\\,dx = \\frac13$ and #tag text.',
  '[TOC]',
  ':::toggle A toggle with a fairly long title that should wrap or truncate nicely',
  'Inside the toggle there is **bold** text and a list:\n\n- one\n- two\n\n:::toggle Nested toggle\ndeep\n:::\n\n:::',
  '\\newpage',
  'Team sync with an extraordinarily long event title @event(2026-10-20T09:00-10:30)',
  '$$\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} = 1 + \\frac14 + \\frac19 + \\frac1{16} + \\frac1{25} + \\frac1{36} + \\frac1{49} + \\frac1{64} + \\frac1{81} + \\frac1{100}\n$$',
  '```mermaid\nflowchart LR\n  A[Start of a long flow] --> B{Decision number one} --> C[Another step here] --> D[And one more step] --> E[Finish line reached] --> F[Celebrate]\n```',
  '[Meeting recording 14:30 · 12:03](ergo-file:FILEID "audio")',
  '```js\nconst aVeryLongLineOfCodeThatShouldScrollInsideItsBlockAndNotWidenThePageOrBreakTheLayout = someFunction(argumentOne, argumentTwo, argumentThree);\n```',
  '| a | b | c | d |\n|---|---|---|---|\n| one | two | three | four |\n| a long cell with many words in it | x | y | z |',
  '- [ ] a task @due(2026-10-21)\n- [x] done task',
].join('\n\n');

async function login(page) {
  await page.goto(base);
  await page.waitForTimeout(700);
  if (await page.locator('#pw2').count()) {
    await page.locator('#pw').fill(PW); await page.locator('#pw2').fill(PW);
    await page.getByRole('button', { name: 'Create vault' }).click();
  } else {
    await page.locator('#pw').fill(PW);
    await page.locator('button.btn.primary').click();
  }
  await page.locator('.sidebar, .bottom-nav').first().waitFor({ timeout: 30000 });
}
const rpc = (page, method, ...args) => page.evaluate(async ([m, a]) => (await (await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json()), [method, args]);

// seed once, from a desktop page
const seedCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const sp = await seedCtx.newPage();
await login(sp);
const f = await rpc(sp, 'addFile', { name: 'Meeting.webm', mime: 'audio/webm', data: Buffer.from('not really audio but a file').toString('base64') });
const note = await rpc(sp, 'createNote', { title: 'Everything', body: BODY.replace('FILEID', f.id) });
await rpc(sp, 'setAiSettings', { connection: { id: 'w', type: 'custom', name: 'Whisper', url: 'http://localhost:8000', key: 'k' } });
await rpc(sp, 'setAiSettings', { speechModel: { connection: 'w', model: '' } });
await seedCtx.close();

const viewports = [
  { n: 'phone-s', w: 360, h: 640, mobile: true }, { n: 'phone', w: 390, h: 844, mobile: true },
  { n: 'tablet', w: 820, h: 1180, mobile: false }, { n: 'laptop', w: 1280, h: 720, mobile: false }, { n: 'desktop', w: 1920, h: 1080, mobile: false },
];
const overflows = page => page.evaluate(() => {
  const vw = innerWidth, bad = [];
  if (document.documentElement.scrollWidth > vw + 1) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  const sel = '.dialog, .menu, .insert-menu, .editor-page, .toolbar, .bottom-nav, .m-note, .aside, .audio-clip, .toggle-block, .toc-block, .math-block, .diagram-out, .page-head, .cal-grid, .recorder';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) bad.push(`${el.className.toString().slice(0, 40)} spills out [${Math.round(r.left)}..${Math.round(r.right)}] of ${vw}`);
  }
  return bad;
});

for (const theme of (process.env.THEMES ?? "light,dark").split(",")) {
  for (const v of viewports.filter(x => !process.env.ONLY || process.env.ONLY.split(',').includes(x.n))) {
    const tag = `${theme}-${v.n}`;
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.mobile ? 2 : 1, isMobile: v.mobile, hasTouch: v.mobile, colorScheme: theme, permissions: ['microphone'] });
    await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); localStorage.setItem('ergo.prefs', JSON.stringify({ aside: true, asideTab: 'toc' })); } catch { /* */ } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await login(page);
    await page.goto(`${base}/#/notes/${note.id}`);
    await page.locator('.editor').waitFor({ state: 'attached', timeout: 15000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${tag}-first.png` });
    await page.locator('.toggle-block').first().waitFor({ state: 'attached', timeout: 15000 });
    const pageW = await page.evaluate(() => Math.round(document.querySelector('.editor-page')?.getBoundingClientRect().width ?? 0));
    check(`${tag}: the note has room to be read (${pageW}px)`, pageW >= Math.min(300, v.w - 40), pageW);
    await page.locator('.diagram-out svg').first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.locator('.math .katex').first().waitFor({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${tag}-note-top.png` });
    let bad = await overflows(page);
    check(`${tag}: the note fits`, bad.length === 0, bad.join('; '));
    // scroll the note through and shoot it again lower down
    await page.evaluate(() => { const s = document.querySelector('.editor-scroll'); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${tag}-note-bottom.png` });

    // Insert menu
    await page.getByRole('button', { name: /^Insert/ }).click();
    await page.getByRole('dialog', { name: 'Insert' }).waitFor();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${tag}-insert-menu.png` });
    bad = await overflows(page);
    check(`${tag}: the Insert menu fits`, bad.length === 0, bad.join('; '));
    const box = await page.locator('.insert-menu').boundingBox();
    check(`${tag}: the Insert menu is inside the screen`, box && box.y >= 0 && box.y + box.height <= v.h + 1, JSON.stringify(box));
    await page.keyboard.press('Escape');

    // Recorder: voice note and meeting
    for (const [btn, title] of [['Voice note', 'Voice note'], ['Meeting recording', 'Meeting recording']]) {
      await page.getByRole('button', { name: btn, exact: true }).click();
      await page.getByRole('dialog', { name: title }).waitFor();
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${OUT}/${tag}-recorder-${btn.split(' ')[0].toLowerCase()}.png` });
      bad = await overflows(page);
      check(`${tag}: the ${title} dialog fits`, bad.length === 0, bad.join('; '));
      if (btn === 'Voice note') {
        await page.getByRole('button', { name: /Start recording/ }).click();
        await page.locator('.recorder.recording').waitFor({ timeout: 8000 });
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/${tag}-recorder-recording.png` });
        await page.getByRole('button', { name: /Stop and insert/ }).click();
        await page.locator('.audio-clip').nth(1).waitFor({ timeout: 10000 }).catch(() => {});
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(250);
    }

    // note actions menu with the width switch
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${tag}-more-menu.png` });
    bad = await overflows(page);
    check(`${tag}: the note menu fits`, bad.length === 0, bad.join('; '));
    await page.getByRole('menuitem', { name: 'Full width' }).click();
    await page.waitForTimeout(500);
    bad = await overflows(page);
    check(`${tag}: full width fits`, bad.length === 0, bad.join('; '));
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Readable line length' }).click();

    // Calendar with the event, and the settings page
    await page.goto(`${base}/#/calendar?day=2026-10-20`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${tag}-calendar.png` });
    bad = await overflows(page);
    check(`${tag}: the calendar fits`, bad.length === 0, bad.join('; '));
    await page.goto(`${base}/#/notes/${note.id}`);
    await page.getByRole('button', { name: 'Settings' }).first().click().catch(async () => { await page.locator('.m-top .icon-btn').click(); });
    await page.getByRole('tab', { name: 'AI' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${tag}-settings-ai.png` });
    await page.locator('.dialog .content').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${tag}-settings-ai-bottom.png` });
    bad = await overflows(page);
    check(`${tag}: the AI settings fit`, bad.length === 0, bad.join('; '));
    check(`${tag}: no script errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
