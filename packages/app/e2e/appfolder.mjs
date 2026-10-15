// Drive an installed app (Android emulator or Windows VM) through its WebView DevTools port, one step per call.
// usage: node appfolder.mjs <cdpHttpUrl> <step> [shotsDir]
//   create  fill the first-run form and create the vault (what is in the folder is taken as the notes)
//   notes   list the titles shown in the note list
//   edit    open the note titled Plan and type at the end of its heading
//   shot    screenshot only
import { writeFileSync } from 'node:fs';
const [cdp, step, shots = './shots', arg] = process.argv.slice(2);
const PASSWORD = 'correct horse battery staple';
const t = (await (await fetch(`${cdp}/json`)).json()).find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (expr, timeout = 30000) => { const t0 = Date.now(); for (;;) { try { if (await ev(`!!(${expr})`)) return true; } catch { /* navigating */ } if (Date.now() - t0 > timeout) return false; await sleep(250); } };
const FIND = `(t) => [...document.querySelectorAll('button, a, [role=button]')].find(e => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ').includes(t))`;
const click = async text => { if (!(await waitFor(`(${FIND})(${JSON.stringify(text)})`, 20000))) throw new Error(`no button ${text}`); await ev(`(${FIND})(${JSON.stringify(text)}).click()`); };
const fillById = async (idv, value) => ev(`(() => { const el = document.getElementById(${JSON.stringify(idv)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const shot = async name => writeFileSync(`${shots}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

if (step === 'gate') {
  await waitFor(`document.body.innerText.includes('Vault folder')`);
  console.log(await ev(`document.querySelector('.vault-folder code')?.textContent`));
  await shot('gate');
} else if (step === 'create') {
  await waitFor(`document.getElementById('pw')`);
  await fillById('pw', PASSWORD); await fillById('pw2', PASSWORD);
  await click('Create vault');
  console.log('vault', await waitFor(`document.querySelector('nav[aria-label=Main]')`, 120000));
  await ev(`location.hash = '#/notes'`);
  await sleep(2500);
  console.log('NOTES', JSON.stringify(await ev(`[...document.querySelectorAll('.note-row')].map(r => r.innerText.split('\\n')[0])`)));
  await shot('notes');
} else if (step === 'notes') {
  await ev(`location.hash = '#/notes'`);
  await sleep(arg ? Number(arg) : 500);
  console.log('NOTES', await ev(`document.body.innerText.split('\\n').slice(0, 14).join(' | ')`));
  await shot('notes');
} else if (step === 'edit') {
  await ev(`location.hash = '#/notes'`);
  await sleep(600);
  await ev(`[...document.querySelectorAll('.note-row, .m-note, a, [role=button], button')].find(r => r.innerText.trim().startsWith('Plan'))?.click()`);
  console.log('open', await waitFor(`document.querySelector('.prose h1')`, 15000));
  await ev(`(() => { const h = document.querySelector('.prose h1'); h.focus(); const r = document.createRange(); r.selectNodeContents(h); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  await send('Input.insertText', { text: ' (edited on the device)' });
  await sleep(2500);
  console.log('saved', await ev(`document.body.innerText.includes('All changes saved')`));
  await shot('edit');
} else if (step === 'shot') {
  await shot(arg ?? 'now');
  console.log((await ev(`document.body.innerText`)).slice(0, 500));
} else if (step === 'eval') {
  console.log(await ev(arg));
}
ws.close();
