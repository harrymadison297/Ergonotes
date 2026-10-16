// Does the installed app (Tauri/WebView2 on Windows) offer screen sharing for a meeting record? Drives the app through
// its DevTools port and reports what getDisplayMedia did. usage: node winmeet.mjs <cdpHttpUrl> <serverUrl> <shotsDir>
import { mkdirSync, writeFileSync } from 'node:fs';
const [cdp, serverUrl, shots = './shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASSWORD = 'correct horse battery staple';
let cookie = '';
const rpc = async (m, ...a) => {
  const r = await fetch(`${serverUrl}/api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(a) });
  const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
  return r.json();
};
const target = (await (await fetch(`${cdp}/json`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = m => {
  const d = JSON.parse(m.data); pending.get(d.id)?.(d);
  if (d.method === 'Runtime.consoleAPICalled') console.log('  [console.' + d.params.type + ']', d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (d.method === 'Runtime.exceptionThrown') console.log('  [exception]', (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 400));
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result.result.value; };
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
const clickByText = (t, sel = 'button') => ev(`(() => { const b = [...document.querySelectorAll('${sel}')].find(e => (e.getAttribute('aria-label') || e.textContent).trim().startsWith(${JSON.stringify(t)})); if (!b) return false; b.click(); return true; })()`);

await send('Runtime.enable');
await send('Page.reload');
await sleep(9000);
console.log('app:', await ev('navigator.userAgent'));
console.log('getDisplayMedia present:', await ev('typeof navigator.mediaDevices?.getDisplayMedia'));
console.log('secure context:', await ev('window.isSecureContext'), '| mic API:', await ev('typeof navigator.mediaDevices?.getUserMedia'));

// open a note of the app's own vault by clicking its card
console.log('note card:', await ev(`(() => { const a = [...document.querySelectorAll('a')].find(e => e.textContent.trim().startsWith('From Windows')); if (!a) return false; a.click(); return true; })()`));
await sleep(2500);
await ev(`(() => { window.__gdm = []; if (window.__gdmWrapped) return true; window.__gdmWrapped = true;
  const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async (c) => { const t = Date.now(); window.__gdm.push({ called: true, constraints: JSON.stringify(c) }); try { const s = await orig(c); window.__gdm.push({ ok: true, ms: Date.now() - t, video: s.getVideoTracks().length, audio: s.getAudioTracks().length }); return s; } catch (e) { window.__gdm.push({ ok: false, ms: Date.now() - t, name: e.name, msg: e.message }); throw e; } };
  return true; })()`);
await ev(`(() => { window.__rej = []; if (!window.__rejOn) { window.__rejOn = true; addEventListener('unhandledrejection', e => window.__rej.push('rej: ' + String(e.reason && e.reason.stack || e.reason))); addEventListener('error', e => window.__rej.push('err: ' + e.message)); } return true; })()`);
console.log('dialogs open before:', await ev(`document.querySelectorAll('.dialog').length`));
await shot('winmeet-note');
console.log('Meeting button:', await clickByText('Meeting'));
await sleep(700);
console.log('Start button:', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Start'); return b ? { disabled: b.disabled } : null; })()`));
const box = JSON.parse(await ev(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Start'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); })()`));
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
console.log('Start: real mouse click at', JSON.stringify(box));
await sleep(1500);
console.log('errors in page:', await ev('JSON.stringify(window.__rej)'));
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  const st = await ev(`JSON.stringify({ gdm: window.__gdm, bar: !!document.querySelector('.rec-panel .rec-dot.on'), err: [...document.querySelectorAll('.dialog .error-text')].map(e => e.textContent) })`);
  if (JSON.parse(st).gdm.length || i === 19) { console.log('after', i + 1, 's:', st); break; }
}
await shot('winmeet-after');
const st = JSON.parse(await ev(`JSON.stringify({ gdm: window.__gdm, bar: !!document.querySelector('.rec-panel .rec-dot.on'), err: [...document.querySelectorAll('.dialog .error-text')].map(e => e.textContent) })`));
if (st.bar) { await sleep(5000); await clickByText('Stop'); await sleep(4000); console.log('records:', JSON.stringify((await rpc('listRecords')).length)); }
ws.close();
process.exit(0);
