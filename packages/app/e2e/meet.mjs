// A meeting record of a REAL shared tab: a video plays in one window, Ergonotes records it from another. Checks that
// what is captured is not blank: pictures that differ from each other and are not black, and sound that is not silence.
// Needs a head (run under xvfb-run) and internet. usage: node meet.mjs <baseUrl> <shotsDir> [videoUrl] [seconds]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
const video = process.argv[4] || 'https://www.youtube.com/watch?v=aircAruvnKk';
const seconds = Number(process.argv[5] || 45);
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 500) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 200)); }
};

const browser = await chromium.launch({
  headless: false,
  args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    '--auto-select-tab-capture-source-by-title=YouTube', '--enable-usermedia-screen-capturing', '--window-size=1280,800',
  ],
});

// ---- the video, in its own window
const vctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, locale: 'en-US' });
const vpage = await vctx.newPage();
await vpage.goto(video, { waitUntil: 'domcontentloaded' });
await vpage.waitForTimeout(2500);
for (const label of [/Reject all/i, /Accept all/i, /No thanks/i]) {
  const b = vpage.getByRole('button', { name: label }).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); break; }
}
await vpage.locator('video').first().waitFor({ timeout: 20000 });
await vpage.evaluate(() => { const v = document.querySelector('video'); v.muted = false; v.currentTime = 30; return v.play(); }).catch(() => {});
const playing = await until(async () => vpage.evaluate(() => { const v = document.querySelector('video'); return v && !v.paused && v.readyState >= 3 && v.currentTime > 30.5; }), 25000);
check('the video plays in its own window', !!playing, await vpage.title());
await vpage.screenshot({ path: `${shots}/meet-youtube.png` });

// ---- Ergonotes, in another window
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const transcribed = [];
await page.route('**/api/ai/transcribe', async route => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  transcribed.push({ timed: body.timed === true, bytes: Math.floor((body.data?.length ?? 0) * 3 / 4) });
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'scripted words', segments: [{ start: 1, end: 4, text: 'scripted words' }] }) });
});

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
await rpc('setAiSettings', { connection: { id: 'w', type: 'custom', name: 'Whisper', url: 'http://localhost:8000', key: 'k' } });
await rpc('setAiSettings', { speechModel: { connection: 'w', model: '' } });
await until(async () => (await rpc('getAiSettings')).speechReady);
const note = await rpc('createNote', { title: 'Real meeting', body: 'Start' });
await page.goto(`${base}/#/notes/${note.id}`);
await page.getByLabel('Title').waitFor();
await page.reload();
await page.locator('.prose > p:last-child').click();
await page.keyboard.press('Control+End');

await page.getByRole('button', { name: 'Meeting', exact: true }).click();
await page.getByRole('dialog', { name: 'Meeting' }).waitFor();
await page.getByLabel('Seconds between pictures').selectOption('2');
await page.getByRole('button', { name: /^Start the meeting record/ }).click();
const started = await page.locator('.rec-bar .rec-dot.on').waitFor({ timeout: 20000 }).then(() => true, () => false);
check('the meeting record starts on the real shared tab', started, errors.slice(0, 2).join(' | '));
if (!started) { await page.screenshot({ path: `${shots}/meet-start-failed.png` }); await browser.close(); process.exit(1); }
const midway = Math.floor(seconds / 2);
await page.waitForTimeout(midway * 1000);
await page.getByRole('button', { name: 'Capture' }).click();
await page.screenshot({ path: `${shots}/meet-recording.png` });
await page.waitForTimeout((seconds - midway) * 1000);
await page.getByRole('region', { name: 'Recording' }).getByRole('button', { name: /Stop/ }).click();
await until(async () => (await page.locator('.rec-bar').count()) === 0, 60000);
const rec = await until(async () => { const r = (await rpc('listRecords'))[0]; return r?.meta?.state === 'done' && r.transcript ? r : null; }, 60000);
check('the record is saved and written out', !!rec, JSON.stringify(rec?.meta));
if (!rec) { await browser.close(); process.exit(1); }
check('it is as long as it was recorded', rec.meta.seconds >= seconds - 3 && rec.meta.seconds <= seconds + 8, rec.meta.seconds);
check('it has one audio file', rec.audio.length === 1 && rec.audio[0].endsWith('/audio.webm'), JSON.stringify(rec.audio));

// ---- are the pictures real? decode them and look at the pixels
const look = await page.evaluate(async ([paths]) => {
  const out = [];
  for (const p of paths) {
    const f = await (await fetch('./api/rpc/getFileByPath', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([p]) })).json();
    const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, 64, 36);
    const d = x.getImageData(0, 0, 64, 36).data;
    let sum = 0, sq = 0;
    for (let i = 0; i < d.length; i += 4) { const g = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += g; sq += g * g; }
    const n = d.length / 4;
    out.push({ w: bmp.width, h: bmp.height, mean: sum / n, sd: Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)), kb: Math.round(bytes.length / 1024) });
  }
  return out;
}, [rec.frames.map(f => f.path)]);
console.log('frames:', JSON.stringify(rec.frames.map((f, i) => ({ s: f.second, ...look[i] }))));
check('it kept pictures (a moving video changes all the time, so none need be dropped)', rec.frames.length >= 3 && rec.frames.length <= Math.ceil(seconds / 2) + 2, rec.frames.length);
check('the pictures are not blank', look.length > 0 && look.every(l => l.mean > 8 && l.sd > 5), JSON.stringify(look.map(l => [Math.round(l.mean), Math.round(l.sd)])));
check('and are sized for reading', look.every(l => Math.max(l.w, l.h) <= 1280 && Math.max(l.w, l.h) >= 640), JSON.stringify(look.map(l => [l.w, l.h])));
check('the one the person took is marked', Object.values(rec.meta.frames).includes('user'));

// ---- is there sound? decode the audio and measure it
const loud = await page.evaluate(async path => {
  const f = await (await fetch('./api/rpc/getFileByPath', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([path]) })).json();
  const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
  const ac = new AudioContext();
  const buf = await ac.decodeAudioData(bytes.buffer.slice(0));
  const d = buf.getChannelData(0);
  const win = Math.floor(buf.sampleRate); // one second
  const rms = [];
  for (let s = 0; s + win <= d.length; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += d[i] * d[i]; rms.push(Math.sqrt(e / win)); }
  return { seconds: buf.duration, rms };
}, rec.audio[0]);
const audible = loud.rms.filter(r => r > 0.005).length;
console.log('audio seconds:', loud.seconds.toFixed(1), 'audible seconds:', audible, 'of', loud.rms.length);
check('the audio decodes and has the right length', Math.abs(loud.seconds - rec.meta.seconds) < 3, `${loud.seconds} vs ${rec.meta.seconds}`);
check('it is not silence', audible >= Math.min(10, loud.rms.length / 3), `${audible}/${loud.rms.length} seconds above the floor`);

// ---- the player, and the filter on real pictures
const card = page.locator('.record-card').first();
await card.waitFor({ timeout: 15000 });
await card.locator('.record-mark').nth(1).click();
await card.locator('.record-now img').waitFor({ timeout: 10000 });
await page.screenshot({ path: `${shots}/meet-player.png` });
check('the player shows the pictures and marks them', (await card.locator('.record-mark').count()) === rec.frames.length);
await card.getByRole('button', { name: /Filter/ }).click();
await page.getByRole('dialog', { name: 'Filter frames' }).waitFor();
await page.getByRole('button', { name: 'Compare on this device only' }).click().catch(() => {});
await page.getByText(/Tick the ones to delete|Nothing to cut/).first().waitFor({ timeout: 60000 });
await page.screenshot({ path: `${shots}/meet-filter.png` });
const proposed = await page.locator('.filter-item.cut').count();
console.log('frames proposed to cut on the device:', proposed, 'of', rec.frames.length);
await page.getByRole('button', { name: 'Keep everything' }).click();
check('the filter keeps the frames it was told to keep', (await rpc('listRecords'))[0].frames.length === rec.frames.length);

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
