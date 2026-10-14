// Two-device test: the Server peer (RPC) and an offline-first device (static build, on-device vault in IndexedDB)
// sync through an S3 Store. Covers join, push/pull, auto-merge, and a conflicted revision resolved in the UI.
// usage: node sync.mjs <serverUrl> <deviceUrl> <s3EndpointForServer> <s3EndpointForDevice> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [serverUrl, deviceUrl, s3Server, s3Device, shots = './shots'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!ok) failures++; };

let cookie = '';
async function rpc(method, ...args) {
  const r = await fetch(`${serverUrl}/api/rpc/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(args) });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const body = await r.json();
  if (!r.ok) throw new Error(`${method}: ${body.error}`);
  return body;
}
const s3 = { type: 's3', region: 'us-east-1', bucket: 'ergonotes-e2e', accessKeyId: 'spike', secretAccessKey: 'spikepass12345' };

// --- server peer: sign in, create a note, attach the Store
await rpc('unlock', PASSWORD);
const seed = await rpc('createNote', { title: 'Shared plan', body: 'line one\n\nline two\n\nline three\n\nline four' });
await rpc('setStore', { ...s3, endpoint: s3Server });
check('server connected to the Store', (await rpc('status')).store?.type === 's3');

// --- device: static build => on-device vault
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(deviceUrl);
await page.getByRole('heading', { name: 'Welcome to Ergonotes' }).waitFor({ timeout: 20000 });
await page.getByRole('button', { name: /Join existing/ }).click();
await page.getByLabel('Endpoint URL').fill(s3Device);
await page.getByLabel('Bucket').fill(s3.bucket);
await page.getByLabel('Access key ID').fill(s3.accessKeyId);
await page.getByLabel('Secret access key').fill(s3.secretAccessKey);
await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
await page.getByLabel("This device's name").fill('Laptop');
await page.getByRole('button', { name: 'Join vault' }).click();
await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 60000 });
check('device joined the vault', true);
await page.goto(`${deviceUrl}#/notes`);
await page.getByText('Shared plan').first().waitFor({ timeout: 20000 });
check('note from the server arrived on the device', true);
await page.screenshot({ path: `${shots}/sync-01-device.png` });

// --- device writes while the server also edits: non-overlapping lines merge automatically
await page.getByText('Shared plan').first().click();
const prose = page.locator('.prose');
await prose.waitFor();
await prose.click();
await page.keyboard.press('Control+Home');
await page.keyboard.type('DEVICE: ');          // edits the first paragraph
await page.waitForTimeout(1500);
await rpc('saveNote', seed.id, { body: 'line one\n\nline two\n\nline three\n\nSERVER line four' });   // edits the last paragraph
await rpc('flush');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.getByRole('button', { name: /Local only|Synced|waiting|Sync/ }).first().click().catch(() => {});
await page.waitForTimeout(1500);
await page.keyboard.press('Control+Shift+S');
await page.waitForTimeout(2500);
await rpc('sync');
await page.keyboard.press('Control+Shift+S');
await page.waitForTimeout(2500);
const merged = (await rpc('getNote', seed.id)).body;
check('server received the device edit and kept its own (auto merge)', merged.includes('DEVICE: line one') && merged.includes('SERVER line four'), JSON.stringify(merged));

// --- true conflict: both edit the same line
await page.goto(`${deviceUrl}#/notes/${seed.id}`);
await page.locator('.prose').waitFor();
await page.locator('.prose').click();
await page.keyboard.press('Control+End');
await page.keyboard.type(' (device ending)');
await page.waitForTimeout(1500);
await rpc('saveNote', seed.id, { body: merged.replace('SERVER line four', 'SERVER line four (server ending)') });
await rpc('flush');
await page.keyboard.press('Control+Shift+S');
await page.waitForTimeout(2500);
await rpc('sync');
await page.keyboard.press('Control+Shift+S');
await page.waitForTimeout(3000);
await page.goto(`${deviceUrl}#/conflicts`);
await page.getByText('Shared plan').first().waitFor({ timeout: 15000 });
check('conflicted revision is listed on the device', true);
await page.getByRole('button', { name: 'Compare' }).first().click();
await page.getByRole('dialog', { name: /Conflicted revision/ }).waitFor();
await page.screenshot({ path: `${shots}/sync-02-conflict.png` });
check('diff shows both versions', (await page.locator('.diff-line.add').count()) > 0 && (await page.locator('.diff-line.del').count()) > 0);
await page.getByRole('button', { name: 'Keep both' }).click();
await page.waitForTimeout(1500);
await page.keyboard.press('Control+Shift+S');
await page.waitForTimeout(2500);
await rpc('sync');
const after = (await rpc('getNote', seed.id)).body;
check('after resolving, the server converges with both endings', after.includes('(device ending)') && after.includes('(server ending)'), JSON.stringify(after));
check('server has no conflict left', (await rpc('conflicts')).length === 0);
check('no page errors on the device', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
