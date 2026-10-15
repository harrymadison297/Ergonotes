// End-to-end check of records (ADR 0011): recordings, meetings with frames, transcripts, the filter, and dictation.
// Chromium supplies a fake microphone and the test a fake shared screen; the transcription server and the models are
// scripted fakes. usage: node audio.mjs <baseUrl> <shotsDir>
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
// a shared screen: a "slide" that changes every 2.5 seconds, with a sound
await ctx.addInitScript(() => {
  window.__display = { calls: 0, audio: true, cancel: false, ended: null };
  navigator.mediaDevices.getDisplayMedia = async () => {
    window.__display.calls++;
    if (window.__display.cancel) throw new DOMException('cancelled', 'NotAllowedError');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const c = canvas.getContext('2d');
    const draw = () => {
      const n = Math.floor(Date.now() / 2500) % 6;
      c.fillStyle = ['#f4f4f4', '#cfe8ff', '#ffe3c7', '#d9f2d0', '#f6d2f0', '#2b2b2b'][n]; c.fillRect(0, 0, 640, 360);
      c.fillStyle = n === 5 ? '#fff' : '#111'; c.font = '64px sans-serif'; c.fillText('Slide ' + n, 40, 120);
      for (let i = 0; i <= n; i++) c.fillRect(40, 160 + i * 28, 120 + i * 60, 14);
    };
    draw(); setInterval(draw, 200);
    const out = canvas.captureStream(10);
    if (window.__display.audio) {
      const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.frequency.value = 440; o.connect(d); o.start();
      d.stream.getAudioTracks().forEach(t => out.addTrack(t));
    }
    window.__display.stream = out;
    return out;
  };
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const transcribed = [];
let transcriptText = 'Buy milk on the way home. Call Anna about the invoice. Book the dentist.';
let sttFails = false;
let noSegments = false;
await page.route('**/api/ai/transcribe', async route => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  transcribed.push({ name: body.name, mime: body.mime, timed: body.timed === true, bytes: Math.floor((body.data?.length ?? 0) * 3 / 4) });
  if (sttFails) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Model not found' }) });
  const payload = body.timed && !noSegments ? { text: transcriptText, segments: [{ start: 0.5, end: 3, text: transcriptText }] } : { text: transcriptText, segments: [] };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
});
const streamed = [];
let cutFrame = 2;
await page.route('**/api/ai/stream', async route => {
  const req = JSON.parse(route.request().postData() ?? '{}');
  streamed.push(req);
  const text = req.model === 'vision' ? JSON.stringify({ cut: [cutFrame] }) : '- Groceries and a call to Anna\n- Dentist to be booked\n- [ ] Call Anna about the invoice';
  const events = [{ type: 'text', delta: text }, { type: 'done' }];
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

const note = await rpc('createNote', { title: 'Lecture', body: 'Start' });
await page.goto(`${base}/#/notes/${note.id}`);
await page.getByLabel('Title').waitFor();

const openInsert = async () => { await page.getByRole('button', { name: /^Insert/ }).click(); return page.getByRole('dialog', { name: 'Insert' }); };
const toEnd = async () => { await page.locator('.prose > p:last-child').click(); await page.waitForTimeout(120); await page.keyboard.press('Control+End'); };
const stopAndWait = async n => {
  await page.getByRole('region', { name: 'Recording' }).getByRole('button', { name: /Stop/ }).click();
  await until(async () => (await page.locator('.rec-bar').count()) === 0, 30000);
  await until(async () => (await rpc('listRecords')).length >= n, 10000);
};
const lastRecord = async () => (await rpc('listRecords'))[0];

// ---- without speech-to-text: a recording
let menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('dictation');
const dictate = menu.getByRole('option', { name: /^Voice dictation/ });
check('voice dictation says what it needs', (await dictate.getAttribute('aria-disabled')) === 'true' && (await dictate.textContent()).includes('Settings → AI'));
await page.keyboard.press('Escape');

await toEnd();
await page.getByRole('button', { name: 'Recording', exact: true }).click();
await page.getByRole('dialog', { name: 'Recording' }).waitFor();
check('a recording asks for nothing about the screen', (await page.getByLabel(/pictures of the shared screen/).count()) === 0);
check('“write it out” is off and says why without speech-to-text', await page.getByLabel(/Write it out as text/).isDisabled());
await page.getByRole('button', { name: /^Start recording/ }).click();
await page.locator('.rec-bar .rec-dot.on').waitFor({ timeout: 8000 });
const linked = await until(async () => { const b = await bodyOf(note.id); return /\]\((?:\.\.\/)?attachments\/record_\d{8}_\d{6} "type_record"\)/.test(b) ? b : null; }, 8000);
check('the link is in the note from the first second', !!linked, linked);
await page.waitForTimeout(2200);
await stopAndWait(1);
const r1 = await lastRecord();
check('the record is a folder with one audio file, a length and no pieces left',
  r1.audio.length === 1 && r1.audio[0].endsWith('/audio.webm') && r1.meta?.state === 'done' && r1.meta.kind === 'recording' && r1.meta.seconds >= 1 && r1.frames.length === 0, JSON.stringify(r1));
check('a recording never asked to share the screen', (await page.evaluate(() => window.__display.calls)) === 0);
await page.locator('.record-card').first().waitFor({ timeout: 10000 });
const dur = await until(async () => page.evaluate(() => { const a = document.querySelector('.record-card audio'); return a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null; }), 10000);
check('the player loads the audio and knows how long it is', !!dur && dur >= 1, dur);
check('nothing was sent for transcription', transcribed.length === 0);
await page.screenshot({ path: `${shots}/record-recording.png` });

// seeking works (the file has a length and a clock)
const seeked = await page.evaluate(async () => {
  const a = document.querySelector('.record-card audio');
  a.currentTime = Math.max(0.5, a.duration / 2);
  await new Promise(r => setTimeout(r, 300));
  return a.currentTime;
});
check('the audio can be sought', seeked > 0.4, seeked);

await page.reload();
await page.locator('.record-card').first().waitFor({ timeout: 15000 });
check('after a reload the player is back', (await page.locator('.record-card').count()) === 1);

// ---- set up speech-to-text
await rpc('setAiSettings', { connection: { id: 'w', type: 'custom', name: 'Whisper', url: 'http://localhost:8000', key: 'k' } });
await rpc('setAiSettings', { speechModel: { connection: 'w', model: '' } });
await until(async () => (await rpc('getAiSettings')).speechReady);
await page.reload();
await page.locator('.prose').waitFor();

// ---- a recording written out as text
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
const opt = page.getByLabel(/Write it out as text/);
check('with speech-to-text the option is on', await opt.isEnabled() && await opt.isChecked());
await page.getByRole('button', { name: /^Start recording/ }).click();
await page.locator('.rec-bar .rec-dot.on').waitFor({ timeout: 8000 });
await page.waitForTimeout(2200);
await stopAndWait(2);
const r2 = await until(async () => { const r = await lastRecord(); return r.transcript ? r : null; }, 20000);
check('the transcript is a file with a mark per minute', !!r2 && r2.transcript === '[0:00]\nBuy milk on the way home. Call Anna about the invoice. Book the dentist.\n', JSON.stringify(r2?.transcript));
check('the audio was sent as timed windows', transcribed.length === 1 && transcribed[0].timed && transcribed[0].bytes > 500, JSON.stringify(transcribed));
await page.getByText('Buy milk on the way home.').first().waitFor({ timeout: 10000 });
check('the player shows the transcript by minute', (await page.locator('.record-line').count()) === 1);

// the person edits the words; the marks stay
await page.locator('.record-transcript').first().scrollIntoViewIfNeeded();
await page.getByRole('button', { name: /Edit the text/ }).first().click();
await page.getByLabel('Transcript text').fill('[0:00]\nBuy oat milk on the way home.\n\n[1:00]\nSecond minute added by hand.\n');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.getByText('Second minute added by hand.').first().waitFor({ timeout: 10000 });
await until(async () => (await lastRecord()).transcript?.includes('[1:00]') && (await page.locator('.record-line').count()) === 2, 8000);
const edited = await lastRecord();
check('an edited transcript is kept, with its marks', (await page.locator('.record-line').count()) === 2 && edited.transcript.includes('[1:00]'), `${await page.locator('.record-line').count()} ${JSON.stringify(edited.transcript)}`);

// ---- dictation
transcriptText = 'dictated words';
await toEnd();
await page.keyboard.press('Enter');
menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('dictation');
await menu.getByRole('option', { name: /^Voice dictation/ }).click();
await page.getByRole('dialog', { name: 'Voice dictation' }).waitFor();
await page.getByRole('button', { name: /Start recording/ }).click();
await page.locator('.recorder.recording').waitFor({ timeout: 8000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Stop and insert/ }).click();
await page.getByText('dictated words').first().waitFor({ timeout: 15000 });
check('dictation writes the words at the cursor and keeps no audio', (await rpc('listRecords')).length === 2);

// ---- a meeting
transcriptText = 'We agreed to ship on Friday. Anna owns the release notes. The dentist call is still open.';
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Meeting', exact: true }).click();
await page.getByRole('dialog', { name: 'Meeting' }).waitFor();
check('a meeting takes pictures of the shared screen by default', await page.getByLabel(/pictures of the shared screen/).isChecked());
await page.getByLabel('Seconds between pictures').selectOption('1');
await page.evaluate(() => { window.__display.cancel = true; });
await page.getByRole('button', { name: /^Start the meeting record/ }).click();
await page.getByText(/Nothing was shared, so nothing is recorded/).waitFor({ timeout: 5000 });
check('without the share nothing is recorded', (await page.locator('.rec-bar').count()) === 0 && (await rpc('listRecords')).length === 2);
await page.evaluate(() => { window.__display.cancel = false; window.__display.audio = false; });
await page.getByRole('button', { name: /^Start the meeting record/ }).click();
await page.getByText(/shared but not its sound/).waitFor({ timeout: 5000 });
check('a share without sound is refused too', (await page.locator('.rec-bar').count()) === 0);
await page.evaluate(() => { window.__display.audio = true; });
await page.getByRole('button', { name: /^Start the meeting record/ }).click();
await page.locator('.rec-bar .rec-dot.on').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Capture' }).click(); // the person takes one
await page.waitForTimeout(6500);
await stopAndWait(3);
const m = await until(async () => { const r = await lastRecord(); return r.meta?.kind === 'meeting' && r.transcript ? r : null; }, 30000);
check('the meeting keeps pictures: changes only, and the one the person took', !!m && m.frames.length >= 2 && m.frames.length <= 6 && Object.values(m.meta.frames).includes('user'), JSON.stringify(m?.meta?.frames));
check('and a transcript, in one folder with the audio', !!m && m.transcript.startsWith('[0:00]') && m.audio.length === 1, JSON.stringify(m?.audio));
check('the screen was asked for once per attempt', (await page.evaluate(() => window.__display.calls)) === 3, await page.evaluate(() => window.__display.calls));
await page.locator('.record-card').nth(2).waitFor({ timeout: 10000 });
const card = page.locator('.record-card').nth(2);
check('the player marks the frames on the timeline', (await card.locator('.record-mark').count()) === m.frames.length);
await card.locator('.record-mark').first().scrollIntoViewIfNeeded();
await card.locator('.record-mark').last().click();
await page.waitForTimeout(500);
const t = await page.evaluate(() => document.querySelectorAll('.record-card')[2].querySelector('audio').currentTime);
check('a frame mark moves the audio to that time', Math.abs(t - m.frames.at(-1).second) < 1.5, `${t} vs ${m.frames.at(-1).second}`);
await card.locator('.record-now img').waitFor({ timeout: 10000 });
check('and shows that frame', (await card.locator('.record-now img').count()) === 1);
await page.screenshot({ path: `${shots}/record-meeting.png` });
const b2 = await bodyOf(note.id);
check('the note holds only links to the records', (b2.match(/"type_record"\)/g) ?? []).length === 3 && !b2.includes('<details>'), b2);

// ---- a summary, written under the player
const sumBefore = streamed.length;
await card.getByRole('button', { name: /Summary/ }).click();
await page.getByText('Groceries and a call to Anna').first().waitFor({ timeout: 15000 });
check('the summary asked the chat model with the transcript, and went into the note', streamed.length === sumBefore + 1 && JSON.stringify(streamed.at(-1)).includes('ship on Friday'));
const b3 = await until(async () => { const b = await bodyOf(note.id); return b.includes('**Summary**') ? b : null; }, 8000) ?? '';
check('as ordinary text in the note', /\*\*Summary\*\*\n\n- Groceries and a call to Anna\n- Dentist to be booked\n\n\* \[ \] +Call Anna about the invoice/.test(b3), b3.slice(-400));

// ---- the filter: only after the person asks, the model only recommends, nothing goes before confirming
const before = (await lastRecord()).frames.length;
cutFrame = 2;
await card.getByRole('button', { name: /Filter/ }).click();
await page.getByRole('dialog', { name: 'Filter frames' }).waitFor();
check('it says what would be sent and to which model before sending', (await page.getByText(/sends up to \d+ frames?/).count()) === 1);
const vs = streamed.length;
await page.getByRole('button', { name: 'Ask the model' }).click();
await page.getByText(/Tick the ones to delete/).waitFor({ timeout: 30000 });
const vision = streamed.slice(vs).filter(r => r.model === 'vision');
check('the model got the pictures, and was only asked keep or cut', vision.length >= 1 && vision[0].messages[0].images?.length >= 1 && vision.every(r => r.messages[0].content.includes('Which frames should be cut?')), JSON.stringify(vision[0]?.messages?.[0]?.content));
const tick = await page.locator('.filter-item.cut').count();
check('its recommendation is ticked, to be confirmed', tick >= 1, tick);
check('nothing was deleted yet', (await lastRecord()).frames.length === before);
await page.screenshot({ path: `${shots}/record-filter.png` });
await page.getByRole('button', { name: /^Delete \d+ frame/ }).click();
await until(async () => (await lastRecord()).frames.length === before - tick, 10000);
check('confirming deletes exactly the ticked frames', (await lastRecord()).frames.length === before - tick, `${before} - ${tick}`);
check('and the record keeps its list in step', Object.keys((await lastRecord()).meta.frames).length === before - tick);

// ---- errors are said, and the record is not lost
sttFails = true;
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
await page.getByRole('button', { name: /^Start recording/ }).click();
await page.locator('.rec-bar .rec-dot.on').waitFor({ timeout: 8000 });
await page.waitForTimeout(1500);
await stopAndWait(4);
check('when transcription fails the record is still saved, and the error is shown', (await rpc('listRecords')).length === 4 && (await page.getByText(/could not be written out: Model not found/).count()) >= 1);
sttFails = false;

// ---- a private note is never sent
await rpc('setPrivate', note.id, true);
await page.reload();
await page.locator('.prose').waitFor();
await page.getByRole('button', { name: 'Recording', exact: true }).click();
check('in a private note the option to write it out is off', await page.getByLabel(/Write it out as text/).isDisabled());
await page.keyboard.press('Escape');
const sentBefore = transcribed.length;
const visionBefore = streamed.filter(r => r.model === 'vision').length;
await page.locator('.record-card').nth(2).scrollIntoViewIfNeeded();
check('its records offer no transcript and no summary', (await page.locator('.record-card').nth(2).getByRole('button', { name: /Redo transcript/ }).isDisabled()) && (await page.getByRole('button', { name: /Summary/ }).count()) === 0);
await page.locator('.record-card').nth(2).getByRole('button', { name: /Filter/ }).click();
await page.getByRole('dialog', { name: 'Filter frames' }).waitFor();
await page.getByText(/Tick the ones to delete/).waitFor({ timeout: 30000 });
check('the filter works on the device only', (await page.getByRole('button', { name: 'Ask the model' }).count()) === 0 && streamed.filter(r => r.model === 'vision').length === visionBefore && transcribed.length === sentBefore);
await page.getByRole('button', { name: 'Keep everything' }).click();
await rpc('setPrivate', note.id, false);

// ---- the Trash takes the records along, and brings them back
const nRec = (await rpc('listRecords')).length;
await rpc('trash', note.id);
check('a note in the Trash takes its records with it', (await rpc('listRecords')).length === 0);
await rpc('restore', note.id);
check('and brings them back', (await rpc('listRecords')).length === nRec);

// ---- settings
await page.getByRole('button', { name: 'Settings' }).first().click();
await page.getByRole('tab', { name: 'AI' }).click();
check('Settings → AI has a speech-to-text server and model', (await page.getByLabel('Speech-to-text server').inputValue()) === 'w' && (await page.getByLabel('Speech-to-text model').inputValue()) === 'whisper-1');
check('and a model that looks at pictures', (await page.getByText('Model that looks at pictures').count()) === 1);

check('no console errors', errors.filter(e => !/Failed to load resource|status of 400/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
