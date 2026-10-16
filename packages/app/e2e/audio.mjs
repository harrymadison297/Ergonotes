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
  const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () => (window.__noMic ? [] : enumerate());
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.__mics = [];
  navigator.mediaDevices.getUserMedia = async c => { const st = await gum(c); window.__mics.push(st); return st; };
  navigator.mediaDevices.getDisplayMedia = async () => {
    window.__display.calls++;
    if (window.__display.delay) await new Promise(r => setTimeout(r, window.__display.delay)); // the picker is open
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
  await until(async () => (await page.locator('.rec-panel, .rec-mini').count()) === 0, 30000);
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
await page.getByRole('dialog', { name: 'Record audio' }).waitFor();
check('a recording asks for nothing about the screen', (await page.getByLabel(/pictures of the shared screen/).count()) === 0);
check('“write it out” is off and says why without speech-to-text', await page.getByLabel(/Write it out as text/).isDisabled());
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 8000 });
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
const channels = await page.evaluate(async () => {
  const a = document.querySelector('.record-card audio');
  const d = await new AudioContext().decodeAudioData(await (await fetch(a.src)).arrayBuffer());
  return d.numberOfChannels;
});
check('the audio is mono (ADR 0011)', channels === 1, channels);
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
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 8000 });
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
await page.getByRole('dialog', { name: 'Record a meeting' }).waitFor();
check('a meeting takes pictures of the shared screen by default', await page.getByLabel(/pictures of the shared screen/).isChecked());
await page.screenshot({ path: `${shots}/record-setup.png` });
await page.getByRole('button', { name: '1 s', exact: true }).click();
await page.evaluate(() => { window.__display.cancel = true; });
await page.getByRole('button', { name: /^Start$/ }).click();
await page.getByText(/Nothing was shared, so nothing is recorded/).waitFor({ timeout: 5000 });
check('without the share nothing is recorded', (await page.locator('.rec-panel').count()) === 0 && (await rpc('listRecords')).length === 2);
// while the share picker is open the dialog waits: it does not claim that another recording is running
await page.evaluate(() => { window.__display.delay = 1500; });
await page.getByRole('button', { name: /^Start$/ }).click();
await page.waitForTimeout(500);
check('while the picker is open the dialog says it is starting, not that another recording is running',
  (await page.getByRole('button', { name: /Starting…/ }).count()) === 1 && (await page.getByText(/Another recording is running/).count()) === 0);
await page.getByText(/Nothing was shared, so nothing is recorded/).waitFor({ timeout: 5000 });
await page.evaluate(() => { window.__display.delay = 0; });
await page.evaluate(() => { window.__display.cancel = false; window.__display.audio = false; });
await page.getByRole('button', { name: /^Start$/ }).click();
await page.getByText(/shared but not its sound/).waitFor({ timeout: 5000 });
check('a share without sound is refused too', (await page.locator('.rec-panel').count()) === 0);
await page.evaluate(() => { window.__display.audio = true; });
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
check('the panel takes the place of the note list while recording', (await page.locator('.rec-pane').count()) === 1 && (await page.locator('.rec-panel .rec-clock').count()) === 1);
await page.getByRole('button', { name: 'Take frame' }).click(); // the person takes one
await page.waitForTimeout(1500);
check('the panel shows the pictures as they are kept', (await page.locator('.rec-thumbs img').count()) >= 1);
await page.screenshot({ path: `${shots}/record-panel.png` });
// another note is opened: the record goes on
const other = await rpc('createNote', { title: 'Another note', body: 'Other' });
await page.evaluate(id => { location.hash = '#/notes/' + id; }, other.id);
await page.getByLabel('Title').waitFor();
await page.waitForFunction(() => document.querySelector('.rec-clock') !== null);
const t1 = await page.locator('.rec-clock').innerText();
await page.waitForTimeout(2500);
const t2 = await page.locator('.rec-clock').innerText();
const secs = t => t.split(':').reduce((a, v) => a * 60 + Number(v), 0);
check('opening another note does not stop it', secs(t2) > secs(t1) && (await page.locator('.rec-panel .rec-dot.on').count()) === 1, `${t1} -> ${t2}`);
await page.getByRole('button', { name: 'Show notes' }).click();
check('the note list can be brought back, with a thin bar to control the record', (await page.locator('.rec-mini').count()) === 1 && (await page.locator('.rec-pane').count()) === 0);
await page.locator('.rec-mini').getByRole('button', { name: 'Recorder' }).click();
check('and the panel again', (await page.locator('.rec-pane').count()) === 1);
await page.waitForTimeout(6000); // long enough for the slide to change several times
await stopAndWait(3);
const m = await until(async () => { const r = await lastRecord(); return r.meta?.kind === 'meeting' && r.transcript ? r : null; }, 30000);
check('the meeting keeps pictures: changes only, and the one the person took', !!m && m.frames.length >= 2 && m.frames.length <= 6 && Object.values(m.meta.frames).includes('user'), JSON.stringify(m?.meta?.frames));
check('and a transcript, in one folder with the audio', !!m && m.transcript.startsWith('[0:00]') && m.audio.length === 1, JSON.stringify(m?.audio));
check('the screen was asked for once per attempt', (await page.evaluate(() => window.__display.calls)) === 4, await page.evaluate(() => window.__display.calls));
await page.evaluate(id => { location.hash = '#/notes/' + id; }, note.id); // back to the note it was recorded in
await page.locator('.record-card').nth(2).waitFor({ timeout: 15000 });
const card = page.locator('.record-card').nth(2);
check('the player marks the frames on the timeline', !!(await until(async () => (await card.locator('.record-mark').count()) === m.frames.length, 10000)), `${await card.locator('.record-mark').count()} vs ${m.frames.length}`);
await card.locator('.record-mark').first().scrollIntoViewIfNeeded();
await card.locator('.record-mark').last().click();
await page.waitForTimeout(500);
const t = await page.evaluate(() => document.querySelectorAll('.record-card')[2].querySelector('audio').currentTime);
check('a frame mark moves the audio to that time', Math.abs(t - m.frames.at(-1).second) < 1.5, `${t} vs ${m.frames.at(-1).second}`);
await card.locator('.record-now img').waitFor({ timeout: 10000 });
check('and shows that frame', (await card.locator('.record-now img').count()) === 1);
// the big frame follows the playback: once one is shown, the next one that is sought to replaces it
const bigSrc = () => card.locator('.record-now img').getAttribute('src');
await card.locator('.record-thumb').first().click();
const firstSrc = await until(async () => { const v = await bigSrc(); return v; }, 5000);
await page.waitForTimeout(500);
const firstShown = await bigSrc();
await card.locator('.record-thumb').last().click();
const lastShown = await until(async () => { const v = await bigSrc(); return v && v !== firstShown ? v : null; }, 5000);
check('the big frame is replaced by the frame of the time that was sought to', !!firstSrc && !!lastShown && lastShown !== firstShown, `${firstShown?.slice(-30)} -> ${lastShown?.slice(-30)}`);
await card.locator('.record-thumb').first().click();
check('and by the first again', !!(await until(async () => (await bigSrc()) === firstShown, 5000)));
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
const ownSec = Object.entries(m.meta.frames).find(([, v]) => v === 'user')?.[0];
const ownClock = `${Math.floor(Number(ownSec) / 60)}:${String(Number(ownSec) % 60).padStart(2, '0')}`;
check('the frame the person took is never sent to the model', ownSec !== undefined && !vision.some(r => new RegExp(`Frame \\d+: at ${ownClock}(\\n|$)`).test(r.messages[0].content)), ownClock);
const tick = await page.locator('.filter-item.cut').count();
check('its recommendation is ticked, to be confirmed', tick >= 1, tick);
check('nothing was deleted yet', (await lastRecord()).frames.length === before);
// the record is reloaded behind the dialog (frames arriving, a sync): what the person ticked is not lost, nothing restarts
const cutIdx = await page.locator('.filter-item').evaluateAll(els => els.findIndex(e => e.classList.contains('cut')));
await page.locator('.filter-item').nth(cutIdx).locator('input').uncheck();
await page.evaluate(dir => { for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('ergo-record', { detail: dir })); }, m.path);
await page.waitForTimeout(1200);
check('a reload of the record behind the dialog does not undo a choice or restart it',
  (await page.getByText(/Tick the ones to delete/).count()) === 1 && (await page.locator('.filter-item.cut').count()) === tick - 1 && (await page.getByText(/Comparing frames|Asking the model/).count()) === 0,
  `${await page.locator('.filter-item.cut').count()} ticked, wanted ${tick - 1}`);
await page.locator('.filter-item').nth(cutIdx).locator('input').check();
check('the choice can be changed back', (await page.locator('.filter-item.cut').count()) === tick, await page.locator('.filter-item.cut').count());
await page.screenshot({ path: `${shots}/record-filter.png` });
await page.getByRole('button', { name: /^Delete \d+ frame/ }).click();
await until(async () => (await lastRecord()).frames.length === before - tick, 10000);
check('confirming deletes exactly the ticked frames', (await lastRecord()).frames.length === before - tick, `${before} - ${tick}`);
await until(async () => Object.keys((await lastRecord()).meta.frames).length === before - tick, 8000); // the list is written just after the files are removed
const afterDel = await lastRecord();
check('and the record keeps its list in step', Object.keys(afterDel.meta.frames).length === before - tick, `${JSON.stringify(afterDel.meta.frames)} files ${JSON.stringify(afterDel.frames.map(f => f.second))} before ${before} tick ${tick}`);

// ---- errors are said, and the record is not lost
sttFails = true;
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 8000 });
await page.waitForTimeout(1500);
await stopAndWait(4);
check('when transcription fails the record is still saved, and the error is shown', (await rpc('listRecords')).length === 4 && (await page.getByText(/could not be written out: Model not found/).count()) >= 1);
sttFails = false;

// ---- no microphone: a recording says so once; a meeting goes on with the shared sound
await page.evaluate(() => { window.__noMic = true; });
await page.evaluate(id => { location.hash = '#/notes/' + id; }, note.id);
await page.locator('.prose').waitFor();
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
await page.getByRole('button', { name: /^Start$/ }).click();
await page.getByText('No microphone was found.').first().waitFor({ timeout: 8000 });
check('a recording without a microphone says so, once, and does not start', (await page.getByText('No microphone was found.').count()) === 1 && (await page.locator('.rec-panel').count()) === 0);
await page.keyboard.press('Escape');
await page.getByRole('button', { name: 'Meeting', exact: true }).click();
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 10000 });
check('a meeting without a microphone goes on with the shared sound, and says so', (await page.getByText(/No microphone was found, so only the shared sound is recorded/).count()) === 1 && (await page.getByText('Recording the shared sound only').count()) === 1);
await page.waitForTimeout(2500);
await stopAndWait(5);
const nm = await lastRecord();
check('and the record has its audio', nm.audio.length === 1 && nm.meta.seconds >= 1, JSON.stringify(nm.meta));
await page.evaluate(() => { window.__noMic = false; });

// ---- the microphone stops (turned off, unplugged) while a meeting has shared sound: the meeting goes on
await page.evaluate(() => { window.__mics.length = 0; });
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Meeting', exact: true }).click();
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 10000 });
check('with a microphone and a share, both are recorded', (await page.getByText('Recording the microphone and the shared sound').count()) === 1, await page.locator('.rec-state').innerText());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__mics.at(-1).getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); }));
await page.getByText(/The microphone stopped, so only the shared sound is recorded/).first().waitFor({ timeout: 5000 });
const c1 = await page.locator('.rec-clock').innerText();
await page.waitForTimeout(2200);
const c2 = await page.locator('.rec-clock').innerText();
check('the meeting goes on after the microphone stopped, and says it hears the shared sound only',
  secs(c2) > secs(c1) && (await page.locator('.rec-panel .rec-dot.on').count()) === 1 && (await page.getByText('Recording the shared sound only').count()) === 1, `${c1} -> ${c2}`);
await stopAndWait(6);
const mm = await lastRecord();
check('and it is saved whole, with its audio', mm.meta.kind === 'meeting' && mm.audio.length === 1 && mm.meta.seconds >= 3 && mm.meta.state === 'done', JSON.stringify(mm.meta));

// a recording has nothing but its microphone: it stops, and keeps what it has
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 8000 });
await page.waitForTimeout(1800);
await page.evaluate(() => window.__mics.at(-1).getTracks().forEach(t => { t.stop(); t.dispatchEvent(new Event('ended')); }));
await until(async () => (await page.locator('.rec-panel, .rec-mini').count()) === 0, 30000);
await until(async () => (await rpc('listRecords')).length >= 7, 10000);
const cut1 = await lastRecord();
check('a recording whose microphone stopped stops, and keeps its audio', cut1.meta.kind === 'recording' && cut1.audio.length === 1 && cut1.meta.state === 'done', JSON.stringify(cut1.meta));

// the note becomes private while it is being recorded: what is said is not sent for writing out
await toEnd();
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'Recording', exact: true }).click();
check('the option to write it out is on to begin with', await page.getByLabel(/Write it out as text/).isChecked());
await page.getByRole('button', { name: /^Start$/ }).click();
await page.locator('.rec-panel .rec-dot.on').waitFor({ timeout: 8000 });
await page.waitForTimeout(1500);
await rpc('setPrivate', note.id, true);
const sentMid = transcribed.length;
await stopAndWait(8);
await page.waitForTimeout(1500);
check('made private while recording: nothing is sent and no transcript is written', transcribed.length === sentMid && !(await lastRecord()).transcript, `${transcribed.length} vs ${sentMid}`);
await rpc('setPrivate', note.id, false);

// a folder still marked "recording" that nobody is recording: it was cut short
await rpc('addFile', { name: 'record.json', mime: 'application/json', dir: 'attachments/record_20250101_101010', data: Buffer.from(JSON.stringify({ version: 1, kind: 'recording', startedAt: '2025-01-01T10:10:10.000Z', seconds: 0, mime: 'audio/webm', frames: {}, state: 'recording' })).toString('base64') });
const cutNote = await rpc('createNote', { title: 'Cut short', body: '[Recording 2025-01-01 10:10](attachments/record_20250101_101010 "type_record")\n' });
await page.evaluate(id => { location.hash = '#/notes/' + id; }, cutNote.id);
await page.locator('.record-card').first().waitFor({ timeout: 15000 });
check('a folder left as "recording" is shown as incomplete, not as being recorded', !!(await until(async () => (await page.locator('.record-card .hint').first().innerText()).includes('incomplete'), 8000)) && (await page.locator('.record-card.live').count()) === 0);
await rpc('trash', cutNote.id); // it was only here to be looked at: the Trash check below counts the records of the note under test

// where the screen cannot be shared there is no Meeting to choose
await page.evaluate(id => { window.__gdm = navigator.mediaDevices.getDisplayMedia; navigator.mediaDevices.getDisplayMedia = undefined; location.hash = '#/notes/' + id; }, other.id);
await page.getByLabel('Title').waitFor();
await page.locator('.prose').waitFor();
menu = await openInsert();
await menu.getByPlaceholder('Search insert options…').fill('meeting');
check('the Insert menu has no Meeting there, and the toolbar neither', (await menu.getByRole('option', { name: /^Meeting/ }).count()) === 0 && (await page.getByRole('button', { name: 'Meeting', exact: true }).count()) === 0);
check('but a Recording is still offered', await (async () => { await menu.getByPlaceholder('Search insert options…').fill('recording'); return (await menu.getByRole('option', { name: /^Recording/ }).count()) === 1; })());
await page.keyboard.press('Escape');
await page.evaluate(id => { navigator.mediaDevices.getDisplayMedia = window.__gdm; location.hash = '#/notes/' + id; }, note.id);
await page.locator('.prose').waitFor();

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
// without a model the comparison starts by itself when the dialog opens: a reload of the record behind it must not start it again
await page.locator('.filter-item:not(.cut) input').first().check();
const ticked = await page.locator('.filter-item.cut').count();
await page.evaluate(dir => { for (let i = 0; i < 3; i++) window.dispatchEvent(new CustomEvent('ergo-record', { detail: dir })); }, (await rpc('listRecords')).find(r => r.meta?.kind === 'meeting' && r.frames.length > 1).path);
await page.waitForTimeout(1500);
check('on the device alone a reload of the record behind the dialog keeps what was ticked',
  ticked >= 1 && (await page.locator('.filter-item.cut').count()) === ticked && (await page.getByText(/Tick the ones to delete/).count()) === 1, `${await page.locator('.filter-item.cut').count()} vs ${ticked}`);
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
