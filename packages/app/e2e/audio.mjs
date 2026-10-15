// End-to-end check of voice notes, meeting recordings, dictation and transcribing a file. Chromium supplies a fake
// microphone; the transcription server and the chat model are scripted fakes. usage: node audio.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 600) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 150)); }
};

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const transcribed = [];
let transcriptText = 'Buy milk on the way home. Call Anna about the invoice. Book the dentist.';
let sttFails = false;
await page.route('**/api/ai/transcribe', async route => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  transcribed.push({ name: body.name, mime: body.mime, bytes: Math.floor((body.data?.length ?? 0) * 3 / 4) });
  if (sttFails) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Model not found' }) });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: transcriptText }) });
});
const streamed = [];
await page.route('**/api/ai/stream', async route => {
  streamed.push(JSON.parse(route.request().postData() ?? '{}'));
  const events = [{ type: 'text', delta: '- Groceries and a call to Anna\n- Dentist to be booked\n- [ ] Call Anna about the invoice' }, { type: 'done' }];
  await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: events.map(e => JSON.stringify(e)).join('\n') + '\n' });
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
const bodyOf = async id => (await rpc('getNote', id)).body;

const note = await rpc('createNote', { title: 'Voice', body: 'Start' });
await page.goto(`${base}/#/notes/${note.id}`);
await page.getByLabel('Title').waitFor();

const openInsert = async () => { await page.getByRole('button', { name: /^Insert/ }).click(); return page.getByRole('dialog', { name: 'Insert' }); };
const toEnd = async () => { await page.locator('.prose > p:last-child').click(); await page.waitForTimeout(120); await page.keyboard.press('Control+End'); };
const record = async (ms = 1600) => {
  await page.getByRole('button', { name: /Start recording/ }).click();
  await page.locator('.recorder.recording').waitFor({ timeout: 8000 });
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: /Stop and insert/ }).click();
};

// ---- without speech-to-text
let menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('dictation');
const dictate = menu.getByRole('option', { name: /^Voice dictation/ });
check('voice dictation says what it needs', (await dictate.getAttribute('aria-disabled')) === 'true' && (await dictate.textContent()).includes('Settings → AI'));
await page.keyboard.press('Escape');

await toEnd();
await page.getByRole('button', { name: 'Voice note', exact: true }).click();
await page.getByRole('dialog', { name: 'Voice note' }).waitFor();
check('the “write it out” option is off and explains why without speech-to-text', await page.getByLabel(/Also write it out as text/).isDisabled());
await record();
await page.locator('.audio-clip').first().waitFor({ timeout: 15000 });
check('a voice note becomes an audio clip in the note', (await page.locator('.audio-clip').count()) === 1);
const b1 = await until(async () => { const b = await bodyOf(note.id); return b.includes('"audio")') ? b : null; }, 8000) ?? '';
check('it is stored as a link with the audio title', /\[Voice note \d\d:\d\d · \d+:\d\d\]\(ergo-file:[0-9a-f-]{36} "audio"\)/.test(b1), b1);
const files = await rpc('listFiles');
check('and the audio is kept as a file of the vault', files.some(f => f.mime.startsWith('audio/')) && transcribed.length === 0);
await page.screenshot({ path: `${shots}/audio-voice-note.png` });

// after a reload the clip is still there and playable
await page.reload();
await page.locator('.audio-clip').first().waitFor({ timeout: 15000 });
check('after a reload the clip is back and loads its audio', !!(await until(async () => (await page.locator('.audio-clip audio').count()) === 1)));

// ---- set up speech-to-text and a chat model
await rpc('setAiSettings', { connection: { id: 'w', type: 'custom', name: 'Whisper', url: 'http://localhost:8000', key: 'k' } });
await rpc('setAiSettings', { speechModel: { connection: 'w', model: '' } });
await until(async () => (await rpc('getAiSettings')).speechReady);
await page.reload();
await page.locator('.prose').waitFor();

// ---- a voice note written out as text
await toEnd();
await page.getByRole('button', { name: 'Voice note', exact: true }).click();
const opt = page.getByLabel(/Also write it out as text/);
check('with speech-to-text the option is available', await opt.isEnabled());
await opt.check();
await record();
await page.getByText('Buy milk on the way home.').first().waitFor({ timeout: 15000 });
check('the transcript is written below the clip', (await page.locator('.audio-clip').count()) === 2 && (await page.getByText('Call Anna about the invoice').count()) >= 1);
check('the recording was sent to the transcription server', transcribed.length === 1 && transcribed[0].bytes > 1000 && transcribed[0].mime.startsWith('audio/'), JSON.stringify(transcribed));

// ---- dictation
transcriptText = 'dictated words';
await toEnd();
await page.keyboard.press('Enter');
menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('dictation');
await menu.getByRole('option', { name: /^Voice dictation/ }).click();
await page.getByRole('dialog', { name: 'Voice dictation' }).waitFor();
await record();
await page.getByText('dictated words').first().waitFor({ timeout: 15000 });
check('dictation writes the words at the cursor and keeps no audio', (await page.locator('.audio-clip').count()) === 2);

// ---- a meeting: clip, summary, transcript in a toggle
transcriptText = 'We agreed to ship on Friday. Anna owns the release notes. The dentist call is still open.';
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Meeting recording', exact: true }).click();
await page.getByRole('dialog', { name: 'Meeting recording' }).waitFor();
await record();
await page.getByText('Summary', { exact: true }).first().waitFor({ timeout: 20000 });
check('a meeting gets a heading, the clip, a summary and the transcript in a toggle',
  (await page.getByRole('heading', { name: /^Meeting \d{4}-\d\d-\d\d/ }).count()) === 1 && (await page.locator('.audio-clip').count()) === 3
  && (await page.getByText('Groceries and a call to Anna').count()) === 1 && (await page.locator('.toggle-title').last().inputValue()) === 'Transcript');
check('the summary asked the chat model, with the transcript', streamed.length === 1 && JSON.stringify(streamed[0]).includes('ship on Friday'));
await page.screenshot({ path: `${shots}/audio-meeting.png` });
const b2 = await until(async () => { const b = await bodyOf(note.id); return b.includes(':::toggle Transcript') ? b : null; }, 8000) ?? '';
check('the summary keeps its bullets and its task as separate lists', /\*\*Summary\*\*\n\n- Groceries and a call to Anna\n- Dentist to be booked\n\n\* \[ \] +Call Anna about the invoice/.test(b2), JSON.stringify(b2.slice(b2.indexOf('**Summary**'))));
check('the meeting is plain Markdown', /## Meeting [\d-]+ \d\d:\d\d\n\n\[Meeting recording[^\]]*\]\(ergo-file:[0-9a-f-]{36} "audio"\)\n\n\*\*Summary\*\*/.test(b2) && b2.includes(':::toggle Transcript\nWe agreed to ship on Friday.'), b2.slice(-600));

// ---- transcribe a file
transcriptText = 'Words from the file.';
await toEnd();
await page.keyboard.press('Enter');
menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('transcribe');
await menu.getByRole('option', { name: /^Transcribe media/ }).click();
await page.getByRole('dialog', { name: 'Transcribe media' }).waitFor();
await page.locator('.dialog input[type=file]').setInputFiles({ name: 'interview.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(4096, 1) });
await page.getByText('Words from the file.').first().waitFor({ timeout: 15000 });
check('an audio file is attached and written out', (await page.locator('.audio-clip').count()) === 4 && transcribed.at(-1).name === 'interview.mp3');

// ---- errors are said, and the recording is not lost
sttFails = true;
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Voice note', exact: true }).click();
await page.getByLabel(/Also write it out as text/).check();
await record();
await page.locator('.audio-clip').nth(4).waitFor({ timeout: 15000 });
check('when transcription fails the recording is still saved, and the error is shown', (await page.locator('.audio-clip').count()) === 5 && (await page.getByText(/could not be written out: Model not found/).count()) >= 1);
sttFails = false;

// ---- a private note is never sent
await rpc('setPrivate', note.id, true);
await page.reload();
await page.locator('.prose').waitFor();
await page.getByRole('button', { name: 'Voice note', exact: true }).click();
check('in a private note the option to write it out is off', await page.getByLabel(/Also write it out as text/).isDisabled());
await page.keyboard.press('Escape');
const before = transcribed.length;
menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('dictation');
await menu.getByRole('option', { name: /^Voice dictation/ }).click();
await page.waitForTimeout(300);
check('and dictation refuses', (await page.getByText(/This note is private/).count()) === 1 && transcribed.length === before, `${await page.getByText(/This note is private/).count()} ${transcribed.length} ${before} dialogs=${await page.locator('.dialog').count()}`);
await page.keyboard.press('Escape');

// ---- settings
await page.getByRole('button', { name: 'Settings' }).first().click();
await page.getByRole('tab', { name: 'AI' }).click();
check('Settings → AI has a speech-to-text server and model', (await page.getByLabel('Speech-to-text server').inputValue()) === 'w' && (await page.getByLabel('Speech-to-text model').inputValue()) === 'whisper-1');

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
