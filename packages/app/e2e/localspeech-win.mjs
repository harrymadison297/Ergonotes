// The Windows app (WebView2, a VM without the Visual C++ runtime installed): Settings → AI → Speech-to-text → On this computer: download a model, test it, write out real speech.
// usage: node localspeech-win.mjs <cdpUrl> <shotsDir> <speech.wav>   (see docs/testbed.md for the VM and the DevTools tunnel; the sample is whisper.cpp's samples/jfk.wav)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const [cdp, shots, wav] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 500) : ''}`); if (!ok) failures++; };
const b = await chromium.connectOverCDP(cdp);
const page = b.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.getByRole('button', { name: 'Settings' }).first().click();
await page.getByRole('tab', { name: 'AI' }).click();
await page.waitForTimeout(800);
const local = page.getByRole('button', { name: 'On this computer' });
check('the desktop offers "On this computer"', await local.isVisible());
await local.click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/02-local-list.png` });
const tiny = page.locator('[role=radio]', { hasText: 'Tiny' });
check('the model list is there', (await page.locator('[role=radio]').count()) === 5, await page.locator('[role=radio]').allInnerTexts());
await tiny.getByRole('button', { name: 'Download' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/03-downloading.png` });
const t0 = Date.now();
let seen = '';
for (;;) {
  const txt = await tiny.innerText();
  if (txt !== seen) { seen = txt; console.log('  tiny:', txt.replace(/\n/g, ' | ')); }
  if (/In use/.test(txt)) break;
  if (Date.now() - t0 > 240000) break;
  await page.waitForTimeout(1000);
}
check('Tiny downloaded and in use', /In use/.test(await tiny.innerText()), `${Math.round((Date.now() - t0) / 1000)} s`);
await page.screenshot({ path: `${shots}/04-in-use.png` });
const test = page.getByRole('button', { name: 'Test speech-to-text' });
check('Test is enabled with a local model', await test.isEnabled());
await test.click();
const st = page.locator('[role=status]').last();
await page.waitForTimeout(500);
for (let i = 0; i < 120 && !/Connected|could not|failed|not /i.test(await st.innerText().catch(() => '')); i++) await page.waitForTimeout(1000);
const msg = await st.innerText().catch(() => '');
check('Test speech-to-text answers', /Connected/.test(msg), msg);
await page.screenshot({ path: `${shots}/05-test.png` });
// real speech through the shell command, decoded by the web view like the app does
const b64 = readFileSync(wav).toString('base64');
const out = await page.evaluate(async b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(bytes.buffer);
  const samples = buf.getChannelData(0).slice();
  const t = performance.now();
  const r = await window.__TAURI_INTERNALS__.invoke('whisper_transcribe', new Uint8Array(samples.buffer), { headers: { 'x-model': 'tiny', 'x-language': '' } });
  return { ...r, ms: Math.round(performance.now() - t), n: samples.length };
}, b64);
console.log('  speech:', JSON.stringify(out));
check('real speech is written out', /ask not what your country/i.test(out.text), out.text);
check('with the times of the phrases', out.segments?.length > 0 && out.segments[0].end > out.segments[0].start, JSON.stringify(out.segments));
console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
await b.close();
process.exit(failures ? 1 : 0);
