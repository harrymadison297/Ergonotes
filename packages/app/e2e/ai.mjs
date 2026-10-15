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
const scripted = async route => {
  const req = JSON.parse(route.request().postData() ?? '{}');
  requests.push(req);
  const events = script.shift() ?? [{ type: 'text', delta: '(no script)' }];
  const body = [...events, { type: 'done' }].map(e => JSON.stringify(e)).join('\n') + '\n';
  await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body });
};
await page.route('**/api/ai/stream', scripted);
const OPENROUTER_LIST = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', context: 200000, free: false, tools: true, thinking: true },
  { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context: 262144, free: true, tools: true, thinking: false },
  { id: 'tiny/no-tools:free', name: 'Tiny no tools', context: 8000, free: true, tools: false, thinking: false },
];
await page.route('**/api/ai/models', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: OPENROUTER_LIST }) }));
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
await page.getByRole('button', { name: 'AI assistant', exact: true }).first().click();
await page.getByRole('button', { name: 'Set up AI' }).waitFor();
check('without a key the panel asks for one', true);
check('the assistant is a tab of the right sidebar, beside the contents', (await page.getByRole('tab', { name: 'Contents' }).count()) === 1 && (await page.locator('.aside').count()) === 1);
check('and the contents are not shown while it is open', (await page.locator('.toc').count()) === 0);
await page.getByRole('tab', { name: 'Contents' }).click();
check('the contents tab lists the headings', (await page.locator('.toc .toc-item', { hasText: 'Packing' }).count()) === 1);
await page.getByRole('tab', { name: 'Assistant' }).click();
await page.getByRole('button', { name: 'Set up AI' }).click();
check('no connection yet', (await page.getByText('No connections yet.').count()) === 1);
await page.getByRole('button', { name: 'Add a connection' }).click();
await page.getByLabel('Name', { exact: true }).fill('Personal OpenRouter');
await page.getByLabel('API key', { exact: true }).fill('sk-or-test-0000');
await page.getByRole('button', { name: 'Add connection' }).click();
await until(async () => (await rpc('getAiSettings')).chatReady);
const settings = await rpc('getAiSettings');
check('a connection is saved and its key never returned', settings.chatReady === true && settings.connections[0].keyHint === '0000' && settings.connections[0].name === 'Personal OpenRouter' && !JSON.stringify(settings).includes('sk-or-test'));
check('the first connection serves both the chat and the suggestions', settings.chatModel.connection === settings.connections[0].id && settings.suggestModel.connection === settings.connections[0].id);
const firstId = settings.connections[0].id;
await page.getByRole('button', { name: 'Test the chat model' }).waitFor();
script.push([{ type: 'text', delta: 'ok' }]);
await page.getByRole('button', { name: 'Test the chat model' }).click();
check('test reports success', !!(await until(async () => (await page.getByRole('status').filter({ hasText: 'Connected' }).count()) > 0)));
await page.getByRole('button', { name: 'Check', exact: true }).click();
check('a connection can be checked on its own', !!(await until(async () => (await page.getByText('Works: 3 models available.').count()) === 1)));

// a second key of the same kind, and a server of your own (Ollama)
await page.getByRole('button', { name: 'Add a connection' }).click();
await page.getByLabel('Name', { exact: true }).fill('Work OpenRouter');
await page.getByLabel('API key', { exact: true }).fill('sk-or-work-1111');
await page.getByRole('button', { name: 'Add connection' }).click();
await until(async () => (await rpc('getAiSettings')).connections.length === 2);
await page.getByRole('button', { name: 'Add a connection' }).click();
await page.getByLabel('Kind').selectOption('custom');
await page.getByLabel('Name', { exact: true }).fill('Home Ollama');
await page.getByLabel('Server address').fill('localhost:11434');
await page.getByRole('button', { name: 'Add connection' }).click();
await page.getByText(/must start with http/).waitFor({ timeout: 8000 });
check('an address without http:// is refused with a reason', true);
await page.getByLabel('Server address').fill('http://localhost:11434');
await page.getByRole('button', { name: 'Add connection' }).click();
const three = await until(async () => { const a = await rpc('getAiSettings'); return a.connections.length === 3 ? a : null; });
check('several connections of several kinds are kept', !!three && three.connections.map(c => c.name).join() === 'Personal OpenRouter,Work OpenRouter,Home Ollama');
check('adding connections does not move the models', three.chatModel.connection === firstId);
const ollamaId = three.connections[2].id;
const workId = three.connections[1].id;
check('a server without a key is ready once it has an address', three.connections[2].ready === true && three.connections[2].keyHint === null);

// the lists differ per connection
await page.unroute('**/api/ai/models');
await page.route('**/api/ai/models', async route => {
  const want = JSON.parse(route.request().postData() ?? '{}').connection;
  const models = want === ollamaId ? [{ id: 'llama3.2:3b' }, { id: 'qwen2.5:7b' }] : OPENROUTER_LIST;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models }) });
});

// the model is chosen from the list of a connection
await page.locator('#ai-chat').click();
await page.getByRole('option', { name: /Claude Sonnet 4.5/ }).waitFor({ timeout: 8000 });
check('the models of the connection are listed, with their name', (await page.locator('.model-panel [role=option]').count()) >= 3);
check('a model without tools is flagged for the assistant', (await page.locator('.model-panel [role=option]', { hasText: 'no tools' }).count()) === 1);
await page.getByLabel('Search models').fill('claude');
check('the list can be searched', (await page.locator('.model-panel [role=option]', { hasText: 'Sonnet' }).count()) === 1 && (await page.locator('.model-panel [role=option]', { hasText: 'Gemma' }).count()) === 0);
await page.getByRole('option', { name: /Claude Sonnet 4.5/ }).click();
check('choosing one saves it', !!(await until(async () => { const a = await rpc('getAiSettings'); return a.chatModel.model === 'anthropic/claude-sonnet-4.5' && a.chatModel.connection === firstId; })));

// the suggestion model: another connection than the chat
await page.locator('#ai-suggest').click();
await page.locator('.model-panel select').selectOption(ollamaId);
await page.locator('.model-panel [role=option]', { hasText: 'qwen2.5:7b' }).waitFor({ timeout: 8000 });
check('another connection lists its own models', (await page.locator('.model-panel [role=option]').count()) === 2);
await page.locator('.model-panel [role=option]', { hasText: 'qwen2.5:7b' }).click();
check('the suggestion model can be on another connection than the chat', !!(await until(async () => { const a = await rpc('getAiSettings'); return a.suggestModel.connection === ollamaId && a.suggestModel.model === 'qwen2.5:7b' && a.chatModel.connection === firstId; })));
await page.locator('#ai-suggest').click();
await page.locator('.model-panel select').selectOption(firstId);
await page.getByLabel('Free models only').check();
check('free models can be filtered', (await page.locator('.model-panel [role=option]').count()) === 2);
await page.getByLabel('Search models').fill('my-own/model:1b');
await page.getByLabel('Search models').press('Enter');
check('a name that is not in the list can be used', !!(await until(async () => (await rpc('getAiSettings')).suggestModel.model === 'my-own/model:1b')));
await rpc('setAiSettings', { chatModel: { connection: firstId, model: 'google/gemma-4-31b-it:free' }, suggestModel: { connection: firstId, model: 'google/gemma-4-31b-it:free' } });

// thinking is set per job, on the same model
await page.locator('#ai-chat-think').selectOption('high');
await until(async () => (await rpc('getAiSettings')).chatThinking === 'high');
check('the chat has its own thinking level', (await rpc('getAiSettings')).chatThinking === 'high');
check('suggestions keep theirs (off by default)', (await rpc('getAiSettings')).suggestThinking === 'off');
await page.locator('#ai-suggest-think').selectOption('low');
check('and it can be changed separately', !!(await until(async () => (await rpc('getAiSettings')).suggestThinking === 'low')));
await rpc('setAiSettings', { chatThinking: 'auto', suggestThinking: 'off' });

// editing and removing a connection
await page.locator('.conn').nth(1).getByRole('button', { name: 'Edit', exact: true }).click();
await page.getByLabel('Name', { exact: true }).fill('Work (new key)');
await page.getByLabel('API key', { exact: true }).fill('sk-or-work-2222');
await page.locator('.conn-form').getByRole('button', { name: 'Save', exact: true }).click();
check('a connection can be renamed and given a new key', !!(await until(async () => { const c = (await rpc('getAiSettings')).connections[1]; return c.name === 'Work (new key)' && c.keyHint === '2222'; })));
page.once('dialog', d => void d.accept());
await page.getByRole('button', { name: 'Remove Home Ollama' }).click();
check('a connection can be removed', !!(await until(async () => (await rpc('getAiSettings')).connections.length === 2)));
check('and the jobs that used it move to another', (await rpc('getAiSettings')).suggestModel.connection !== ollamaId);
await rpc('setAiSettings', { chatModel: { connection: firstId, model: 'google/gemma-4-31b-it:free' } });
await page.keyboard.press('Escape');
await page.locator('.dialog').waitFor({ state: 'detached' }).catch(() => undefined);

// the model is chosen in the chat itself
await page.getByRole('button', { name: /^Chat model:/ }).click();
await page.locator('.model-panel select').selectOption(workId);
await page.locator('.model-panel [role=option]', { hasText: 'Claude Sonnet 4.5' }).click();
check('the chat model is chosen from the chat, on any connection', !!(await until(async () => { const a = await rpc('getAiSettings'); return a.chatModel.connection === workId && a.chatModel.model === 'anthropic/claude-sonnet-4.5'; })));
await rpc('setAiSettings', { chatModel: { connection: firstId, model: 'google/gemma-4-31b-it:free' } });

// ---- chat answers a question (no changes)
script.push([{ type: 'text', delta: 'You still need ' }, { type: 'text', delta: 'a charger and a passport.' }, { type: 'usage', input: 120, output: 12 }]);
await page.getByLabel('Message the assistant').fill('What do I need to pack?');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md', { hasText: 'a charger and a passport' }).waitFor({ timeout: 8000 });
check('streamed answer is shown', true);
const first = requests.at(-1);
check('the request carries the open note and only the note tools', first.system.includes('book the hotel') && first.system.includes(note.id)
  && first.tools.some(t => t.name === 'replace_text') && !first.tools.some(t => t.name === 'search_notes'));
check('token usage is shown', (await page.locator('.ai-usage').innerText()).includes('120'));

// ---- the model's thinking is shown, and the level is one click away
script.push([{ type: 'thinking', delta: 'The user wants a short list. ' }, { type: 'thinking', delta: 'Two items.' }, { type: 'text', delta: 'Two things.' }]);
await page.getByLabel('Message the assistant').fill('think about it');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md', { hasText: 'Two things.' }).waitFor({ timeout: 8000 });
check('the thinking is shown, collapsed once the answer is there', (await page.locator('.ai-think summary', { hasText: 'Thought process' }).count()) === 1 && !(await page.locator('.ai-think').first().evaluate(d => d.open)));
await page.locator('.ai-think summary').first().click();
check('and can be opened', (await page.locator('.ai-think-text', { hasText: 'Two items.' }).first().isVisible()));
const modeBtn = page.getByRole('button', { name: /^Mode:/ });
check('the mode is an icon, not a word', ((await modeBtn.textContent()) ?? '').trim() === '' && (await modeBtn.locator('svg').count()) === 1);
const pill = page.getByRole('button', { name: /^Chat model:/ });
check('the model shows a short name and its effort in one pill', /^Gemma 4 31B\s*Auto$/.test(((await pill.textContent()) ?? '').trim()), await pill.textContent());
{ const tops = await page.evaluate(() => { const b = document.querySelector('.ai-composer-bar'); return [...b.children].filter(c => !c.classList.contains('model-panel') && !c.classList.contains('grow')).map(c => c.className + '@' + Math.round(c.getBoundingClientRect().top)); });
  check('the composer bar stays on one line', Math.max(...tops.map(t => Number(t.split('@')[1]))) - Math.min(...tops.map(t => Number(t.split('@')[1]))) < 12, tops.join(', ')); }
await pill.click();
await page.getByRole('group', { name: 'Effort' }).getByRole('button', { name: 'High' }).click();
await page.screenshot({ path: `${shots}/model-effort.png` });
check('the level is chosen in the same panel as the model', !!(await until(async () => (await rpc('getAiSettings')).chatThinking === 'high')));
check('and shown on the pill', !!(await until(async () => /High$/.test(((await pill.textContent()) ?? '').trim()))));
await page.keyboard.press('Escape');
script.push([{ type: 'text', delta: 'noted' }]);
await page.getByLabel('Message the assistant').fill('again');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md', { hasText: 'noted' }).waitFor({ timeout: 8000 });
await rpc('setAiSettings', { chatThinking: 'auto' });

// ---- answers are rendered as Markdown
script.push([{ type: 'text', delta: 'You need **two** things:\n\n- a passport\n- a charger\n\n<script>alert(1)</script>' }]);
await page.getByLabel('Message the assistant').fill('list it');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md strong', { hasText: 'two' }).waitFor({ timeout: 8000 });
check('Markdown in an answer is rendered', (await page.locator('.ai-md li').count()) === 2);
check('and raw HTML in it is not run', (await page.locator('.ai-md script').count()) === 0);

// ---- history: the conversation is kept and can be reopened
const chats = await until(async () => { const l = await rpc('listChats'); return l.length === 1 ? l : null; });
check('the conversation is saved to the vault', !!chats && chats[0].title === 'What do I need to pack?');
await page.getByRole('button', { name: 'New chat' }).click();
check('new chat clears the panel', (await page.locator('.ai-bubble').count()) === 0);
await page.getByRole('button', { name: 'Chat history' }).click();
await page.locator('.ai-history-open', { hasText: 'What do I need to pack' }).click();
check('history reopens an earlier conversation', !!(await until(async () => (await page.locator('.ai-md', { hasText: 'a charger and a passport' }).count()) === 1)));

// ---- @ mention: another note is attached to the message
const budget = await rpc('createNote', { title: 'Budget 2026', body: 'The reserve is FORTY-TWO-ZEBRAS euro.' });
const secret = await rpc('createNote', { title: 'Budget secrets', body: 'private stuff' });
await rpc('setPrivate', secret.id, true);
await page.waitForTimeout(600);
await page.getByLabel('Message the assistant').fill('what is in @Budg');
await page.getByRole('option', { name: /Budget 2026/ }).waitFor({ timeout: 8000 });
check('typing @ lists matching notes, never private ones', (await page.getByRole('option', { name: /Budget secrets/ }).count()) === 0);
await page.getByLabel('Message the assistant').press('Enter');
check('choosing one attaches it as a chip', (await page.locator('.ai-composer .ai-chip', { hasText: 'Budget 2026' }).count()) === 1);
script.push([{ type: 'text', delta: 'The reserve is 42 zebras.' }]);
await page.getByLabel('Message the assistant').fill('what is in the budget?');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md', { hasText: '42 zebras' }).waitFor({ timeout: 8000 });
const withMention = requests.at(-1);
check('the attached note reaches the model with the message', JSON.stringify(withMention.messages).includes('FORTY-TWO-ZEBRAS'));
check('the private note does not', !JSON.stringify(requests).includes('private stuff'));

// ---- Ask mode cannot change anything
await page.getByRole('button', { name: /Mode:/ }).click();
await page.getByRole('menuitem', { name: /Ask: answers only/ }).click();
script.push([{ type: 'text', delta: 'Only reading.' }]);
await page.getByLabel('Message the assistant').fill('fix it');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-md', { hasText: 'Only reading.' }).waitFor({ timeout: 8000 });
check('in Ask mode no tool can write', !requests.at(-1).tools.some(t => /replace_text|append_to_note|update_note|create_note|insert_diagram/.test(t.name)) && requests.at(-1).system.includes('Ask mode'));
await page.getByRole('button', { name: /Mode:/ }).click();
await page.getByRole('menuitem', { name: /Edit: may change notes/ }).click();

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
check('the panel stops for a private note', !!(await until(async () => (await page.locator('.ai-context', { hasText: 'Private note' }).count()) === 1)));
check('and its input is disabled', await page.getByLabel('Message the assistant').isDisabled());
await page.screenshot({ path: `${shots}/ai-03-private.png` });
await page.getByRole('button', { name: 'More actions' }).click();
await page.getByRole('menuitem', { name: 'Allow AI to see this note' }).click();
await until(async () => (await rpc('getNote', note.id)).private === false);

// ---- ghost text
await page.getByRole('button', { name: 'Hide AI assistant' }).click();
await page.getByRole('button', { name: 'Settings' }).first().click().catch(() => undefined);
await rpc('setSettings', {});
check('suggestions start switched off', (await rpc('getAiSettings')).suggest === false);
await page.reload();
await page.getByLabel('Title').waitFor();
check('the note footer shows the switch, off', (await page.getByRole('button', { name: /Suggestions off/ }).count()) === 1);
await page.getByRole('button', { name: /Suggestions off/ }).click();
check('and turning it on is kept in the vault', !!(await until(async () => (await rpc('getAiSettings')).suggest === true)));
await rpc('setAiSettings', { suggestDelay: 200 });
await page.reload();
await page.getByLabel('Title').waitFor();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
script.length = 0;
script.push([{ type: 'text', delta: '" and a toothbrush"' }]);
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

// a failing suggestion says so in the note's footer
await page.unroute('**/api/ai/stream');
await page.route('**/api/ai/stream', async route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', message: 'Rate limited: upstream is busy' }) + '\n' }));
await page.keyboard.type(' plus snacks');
await page.locator('.ghost-status.err', { hasText: 'Rate limited' }).waitFor({ timeout: 8000 });
check('a failed suggestion is reported in the footer', true);

// ---- the sidebar is available on every page, not only beside a note
await page.goto(`${base}/#/tasks`);
await page.getByRole('button', { name: 'AI assistant', exact: true }).first().click();
await page.locator('.aside').waitFor();
check('the assistant opens on a page without a note', (await page.locator('.ai-context', { hasText: 'No note open' }).count()) === 1);
await page.getByRole('button', { name: 'Close sidebar' }).click();
await page.goto(`${base}/#/notes/${note.id}`);
await page.getByLabel('Title').waitFor();

// ---- a note the assistant creates is linked from the chat
await page.unroute('**/api/ai/stream');
await page.route('**/api/ai/stream', scripted);
await page.getByRole('button', { name: 'AI assistant', exact: true }).first().click();
script.length = 0;
script.push([call('create_note', { title: 'Boolean table', body: '| a | b | a && b |\n|---|---|---|\n| 1 | 0 | 0 |' })]);
script.push([{ type: 'text', delta: 'Created it.' }]);
await page.getByLabel('Message the assistant').fill('make a new note with a boolean table');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-tool-link', { hasText: 'Open' }).waitFor({ timeout: 8000 });
check('a created note is linked from the chat', true);

// ---- a failure is shown, not swallowed
await page.route('**/api/ai/stream', async route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', message: 'No credits left' }) + '\n' }));
await page.getByLabel('Message the assistant').fill('hello?');
await page.getByLabel('Message the assistant').press('Enter');
await page.locator('.ai-error', { hasText: 'No credits left' }).waitFor({ timeout: 8000 });
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
await mp.getByRole('button', { name: 'AI assistant', exact: true }).first().click();
await mp.locator('.aside-wrap.mobile').waitFor();
const box = await mp.locator('.aside-wrap.mobile').boundingBox();
check('on a phone the assistant covers the screen', !!box && box.width >= 380 && box.height >= 800);
check('and has no horizontal overflow', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await mp.screenshot({ path: `${shots}/ai-05-mobile.png` });
await mp.getByRole('button', { name: 'Close sidebar' }).click();
check('it closes again', (await mp.locator('.aside-wrap').count()) === 0);

const real = errors.filter(e => !/favicon|ResizeObserver|Failed to load resource|Failed to use workers for subsetting|Failed to fetch font family/.test(e));
check('no console errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
