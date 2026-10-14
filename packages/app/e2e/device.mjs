// Drives a real Tauri app (Android APK in an emulator, or the Windows build in a VM) through its WebView's
// DevTools socket. Speaks CDP directly because Android WebView rejects Playwright's connectOverCDP.
// usage: node device.mjs <cdpHttpUrl> <serverUrl> <s3EndpointForDevice> <shotsDir> <uaRegex> <deviceName> <noteTitle>
import { mkdirSync, writeFileSync } from 'node:fs';

const [cdp, serverUrl, s3Endpoint, shots = './shots', uaRegex = 'Android', deviceName = 'Device', noteTitle = 'From the device'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cookie = '';
async function rpc(method, ...args) {
  const r = await fetch(`${serverUrl}/api/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(args) });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const body = await r.json();
  if (!r.ok) throw new Error(`${method}: ${body.error}`);
  return body;
}

const targets = await (await fetch(`${cdp}/json`)).json();
const target = targets.find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.result.value;
};
const waitFor = async (expr, timeout = 30000, label = expr) => {
  const t0 = Date.now();
  for (;;) {
    try { if (await ev(`!!(${expr})`)) return; } catch { /* page navigating */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(250);
  }
};
const FIND = `(t) => [...document.querySelectorAll('button, a, [role=button], [role=tab], [role=menuitem], [role=checkbox], summary')].find(e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ').includes(t))`;
const click = async text => { await waitFor(`(${FIND})(${JSON.stringify(text)})`, 20000, `button "${text}"`); await ev(`(${FIND})(${JSON.stringify(text)}).click()`); };
const fill = async (labelText, value, exact = false) => {
  const sel = `(() => { const l = [...document.querySelectorAll('label')].find(l => ${exact ? 'l.textContent.trim() === ' : 'l.textContent.includes('}${JSON.stringify(labelText)}${exact ? '' : ')'}); const byLabel = l && l.htmlFor ? document.getElementById(l.htmlFor) : null; return byLabel || document.querySelector('[aria-label=' + JSON.stringify(${JSON.stringify(labelText)}) + ']'); })()`;
  await waitFor(sel, 20000, `field ${labelText}`);
  await ev(`(() => { const el = ${sel}; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
};
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${shots}/${name}.png`, Buffer.from(r.result.data, 'base64'));
};

check('running inside the Tauri webview', await ev(`'__TAURI_INTERNALS__' in window`), target.url);
check(`user agent matches ${uaRegex}`, new RegExp(uaRegex).test(await ev('navigator.userAgent')), await ev('navigator.userAgent'));
const mobile = (await ev('window.innerWidth')) < 768;

await waitFor(`document.body.innerText.includes('Welcome to Ergonotes')`, 30000);
await click('Join existing');
await fill('Endpoint URL', s3Endpoint);
await fill('Bucket', 'ergonotes-e2e');
await fill('Access key ID', 'spike');
await fill('Secret access key', 'spikepass12345');
await fill('Password', PASSWORD, true);
await fill("This device's name", deviceName);
await shot('android-01-join');
await click('Join vault');
await waitFor(`document.querySelector('nav[aria-label=Main]')`, 180000, 'main navigation after join');
check('app joined the vault through the Store', true);
await ev(`location.hash = '#/notes'`);
await waitFor(`document.body.innerText.includes('Shared plan')`, 60000, 'the server note');
check('notes written on the server arrived on this device', true);
await shot('02-notes');

// write on this device (on-device first), then sync
if (mobile) await click('New note');
else { await click('New'); await click('New note'); }
await waitFor(`document.querySelector('input[aria-label=Title]')`);
await fill('Title', noteTitle);
await ev(`document.querySelector('.prose').focus()`);
await send('Input.insertText', { text: `Written on ${deviceName}, synced through MinIO.` });
await sleep(1800);
check('autosave on the device', await ev(`document.body.innerText.includes('All changes saved')`));
await shot('03-note');
if (mobile) {
  await click('Back');
  await sleep(500);
  await ev(`location.hash = '#/more'`);
  await click('Sync now');
} else {
  await ev(`location.hash = '#/notes'`);
  await sleep(500);
  await click('Local only').catch(() => {});
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'S', code: 'KeyS', modifiers: 10, windowsVirtualKeyCode: 83 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'S', code: 'KeyS', modifiers: 10, windowsVirtualKeyCode: 83 });
  await click('Synced').catch(() => {});
}
await sleep(6000);
await shot('04-after-sync');

await rpc('unlock', PASSWORD);
await rpc('sync');
const items = await rpc('listItems');
const got = items.find(i => i.title === noteTitle);
check('server received the note written on this device', !!got, got ? got.id : '');
if (got) check('content intact on the server', (await rpc('getNote', got.id)).body.includes(`Written on ${deviceName}`));
ws.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
