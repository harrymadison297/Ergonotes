// End-to-end check of the AI features against the real web build. The provider is replaced by a scripted fake at
// the server's streaming endpoint, so the run is deterministic and costs nothing.
// usage: node ai.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise(r => setTimeout(r, 150));
  }
};
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); if (!ok) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { if (localStorage.getItem('ergo.rail') === null) localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// ---- the fake provider: a queue of scripted answers, one per request; each is an array of events
const requests = [];
const script = [];
await page.route('**/api/ai/stream', async route => {
  const req = JSON.parse(route.request().postData() ?? '{}');
  requests.push(req);
  const events = script.shift() ?? [{ type: 'text', delta: '(no script)' }];
  const body = [...events, { type: 'done' }].map(e => JSON.stringify(e)).join('\n') + '\n';
  await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
});
const call = (name, args) => ({ type: 'tool_call', call: { id: `c${Math.random().toString(36).slice(2, 8)}`, name, args } });

// ---- set up
await page.goto(base);
// a fresh server asks for a vault; one that other checks already set up asks for the password
const fresh = await page.getByRole('heading', { name: 'Set up Ergonotes' }).waitFor({ timeout: 6000 }).then(() => true, () => false);
if (fresh) {
  await page.getByLabel('Vault password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
} else {
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 30000 });
const rpc = (method, ...args) => page.evaluate(async ([m, a]) => {
  const r = await fetch(`./api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
  return r.json();
}, [method, args]);

// a note to work on
const note = await rpc('createNote', { title: 'Trip plan', body: '## Packing\n\n- passport\n- charger\n\n## Notes\n\nbook the hotel' });
await page.goto(`${base}/#/notes/${note.id}`);
await page.getByLabel('Title').waitFor();

// ---- no key yet: the panel says so, and nothing is sent
await page.getByRole('button', { name: 'AI assistant' }).click();
await page.getByRole('button', { name: 'Add an API key' }).waitFor();
check('without a key the panel asks for one', true);
check('toc gives its place to the panel', (await page.locator('.toc').count()) === 0);
await page.getByRole('button', { name: 'Add an API key' }).click();
await page.getByLabel('OpenRouter API key').fill('sk-or-test-0000');
await page.getByRole('button', { name: 'Save', exact: true }).first().click();
await until(async () => (await rpc('getAiSettings')).hasKey);
const settings = await rpc('getAiSettings');
check('the key is saved and never returned', settings.hasKey === true && settings.keyHint === '0000' && !JSON.stringify(settings).includes('sk-or-test'));
await page.getByRole('button', { name: 'Test connection' }).waitFor();
script.push([{ type: 'text', delta: 'ok' }]);
await page.getByRole('button', { name: 'Test connection' }).click();
check('test connection reports success', !!(await until(async () => (await page.getByRole('status').filter({ hasText: 'Connected' }).count()) > 0)));
await page.keyboard.press('Escape');
await page.locator('.dialog').waitFor({ state: 'detached' }).catch(() => undefined);

// ---- chat answers a question (no changes)
script.push([{ type: 'text', delta: 'You still need ' }, { type: 'text', delta: 'a charger and a passport.' }, { type: 'usage', input: 120, output: 12 }]);
await page.getByLabel('Message the assistant').fill('What do I need to pack?');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-msg.bot', { hasText: 'a charger and a passport' }).waitFor({ timeout: 8000 });
check('streamed answer is shown', true);
const first = requests.at(-1);
check('the request carries the open note and only the note tools', first.system.includes('book the hotel') && first.system.includes(note.id)
  && first.tools.some(t => t.name === 'replace_text') && !first.tools.some(t => t.name === 'search_notes'));
check('token usage is shown', (await page.locator('.ai-usage').innerText()).includes('120'));

// ---- an edit arrives as a suggestion; accept writes it through the editor
script.push([call('insert_after_heading', { heading: 'Packing', markdown: '- sunscreen' })]);
script.push([{ type: 'text', delta: 'Added sunscreen to your packing list.' }]);
await page.getByLabel('Message the assistant').fill('Add sunscreen to the packing list');
await page.getByLabel('Message the assistant').press('Enter');
const card = page.locator('.ai-proposal.pending');
await card.waitFor({ timeout: 8000 });
check('an edit is shown as a suggestion with a diff', (await card.locator('.ai-diff-row.add', { hasText: 'sunscreen' }).count()) === 1);
check('the note is unchanged until accepted', !(await rpc('getNote', note.id)).body.includes('sunscreen'));
await page.screenshot({ path: `${shots}/ai-01-proposal.png` });
await card.getByRole('button', { name: 'Accept' }).click();
check('accept writes the change', !!(await until(async () => (await rpc('getNote', note.id)).body.includes('- passport\n- charger\n- sunscreen'))));
check('and it shows in the editor', (await page.locator('.prose', { hasText: 'sunscreen' }).count()) === 1);
await page.locator('.ai-proposal.accepted').getByRole('button', { name: 'Undo' }).click();
check('undo restores the note', !!(await until(async () => !(await rpc('getNote', note.id)).body.includes('sunscreen'))));

// ---- reject leaves the note alone
script.push([call('replace_text', { find: 'book the hotel', replace: 'hotel booked' })]);
script.push([{ type: 'text', delta: 'Done.' }]);
await page.getByLabel('Message the assistant').fill('mark the hotel as booked');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-proposal.pending').getByRole('button', { name: 'Reject' }).click();
await page.waitForTimeout(800);
check('reject keeps the note as it was', (await rpc('getNote', note.id)).body.includes('book the hotel'));

// ---- the assistant draws: Mermaid becomes a drawing block
script.push([call('insert_diagram', { mermaid: 'flowchart TD\n  A[Pack] --> B[Fly]\n  B --> C[Hotel]' })]);
script.push([{ type: 'text', delta: 'Drew the trip as a flow.' }]);
await page.getByLabel('Message the assistant').fill('draw the trip as a diagram');
await page.getByLabel('Message the assistant').press('Enter');
const drawCard = page.locator('.ai-proposal.pending').last();
await drawCard.waitFor({ timeout: 30000 });
check('a diagram becomes a suggested drawing', (await drawCard.locator('.ai-diff-row.add', { hasText: 'ergonote-excalidraw' }).count()) >= 1);
await drawCard.getByRole('button', { name: 'Accept' }).click();
check('the drawing block is in the note', !!(await until(async () => (await rpc('getNote', note.id)).body.includes('```ergonote-excalidraw'), 15000)));
await until(async () => (await page.locator('.excalidraw-block img.drawing').count()) > 0, 15000);
check('and it renders as a drawing in the editor', (await page.locator('.excalidraw-block img.drawing').count()) === 1);
await page.screenshot({ path: `${shots}/ai-02-diagram.png` });

// ---- private notes
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Keep private from AI' }).click();
await until(async () => (await rpc('getNote', note.id)).private === true);
check('a note can be made private', !!(await until(async () => (await page.locator('.private-flag').count()) === 1)));
check('the panel stops for a private note', !!(await until(async () => page.getByText('This note is private').isVisible())));
check('and its input is disabled', await page.getByLabel('Message the assistant').isDisabled());
await page.screenshot({ path: `${shots}/ai-03-private.png` });
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Allow AI to see this note' }).click();
await until(async () => (await rpc('getNote', note.id)).private === false);

// ---- ghost text
await page.getByRole('button', { name: 'Hide AI assistant' }).click();
await page.getByRole('button', { name: 'Settings' }).first().click().catch(() => undefined);
await rpc('setSettings', {});
await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}'); p.ghost = true; p.ghostDelay = 200; localStorage.setItem('ergo.prefs', JSON.stringify(p)); });
await page.reload();
await page.getByLabel('Title').waitFor();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
script.length = 0;
script.push([{ type: 'text', delta: ' and a toothbrush' }]);
const before = requests.length;
await page.keyboard.type(' Do not forget to pack the sunscreen, a hat');
const ghost = page.locator('.ghost-text');
await ghost.waitFor({ timeout: 8000 });
check('a grey suggestion appears after a pause', (await ghost.innerText()).includes('toothbrush'));
check('it asks the suggestion model for a short answer', requests.length > before && requests.at(-1).model === 'suggest' && requests.at(-1).maxTokens <= 60);
await page.screenshot({ path: `${shots}/ai-04-ghost.png` });
await page.keyboard.press('Tab');
await until(async () => (await page.locator('.prose').innerText()).includes('a hat and a toothbrush'));
check('Tab accepts it', (await page.locator('.prose').innerText()).includes('a hat and a toothbrush'));
check('and the grey text is gone', (await page.locator('.ghost-text').count()) === 0);
script.push([{ type: 'text', delta: ' again' }]);
await page.keyboard.type(' and then');
await page.locator('.ghost-text').waitFor({ timeout: 8000 });
await page.keyboard.press('Escape');
check('Escape dismisses a suggestion', (await page.locator('.ghost-text').count()) === 0);

// ---- a failure is shown, not swallowed
await page.getByRole('button', { name: 'AI assistant' }).click();
await page.route('**/api/ai/stream', async route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', message: 'No credits left' }) + '\n' }));
await page.getByLabel('Message the assistant').fill('hello?');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-msg.error', { hasText: 'No credits left' }).waitFor({ timeout: 8000 });
check('a provider error is shown in the chat', true);

// ---- mobile: the panel is a full screen overlay with a close button
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(base);
await mp.getByLabel('Password').fill(PASSWORD);
await mp.getByRole('button', { name: 'Sign in' }).click();
await mp.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 20000 });
await mp.goto(`${base}/#/notes/${note.id}`);
await mp.locator('.m-note .prose').waitFor();
await mp.getByRole('button', { name: 'AI assistant' }).click();
await mp.locator('.ai-panel.mobile').waitFor();
const box = await mp.locator('.ai-panel.mobile').boundingBox();
check('on a phone the assistant covers the screen', !!box && box.width >= 380 && box.height >= 800);
check('and has no horizontal overflow', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await mp.screenshot({ path: `${shots}/ai-05-mobile.png` });
await mp.getByRole('button', { name: 'Close assistant' }).click();
check('it closes again', (await mp.locator('.ai-panel').count()) === 0);

const real = errors.filter(e => !/favicon|ResizeObserver|Failed to load resource|Failed to use workers for subsetting/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
