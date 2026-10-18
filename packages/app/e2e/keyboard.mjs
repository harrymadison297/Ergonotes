// Settings → Keyboard: changing the keys of a Command, conflicts, reset, and that the new keys work. usage: node keyboard.mjs <baseUrl> <shotsDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 500) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 150)); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { if (!localStorage.getItem('ergo.rail')) localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// the app asks its own questions (state/confirm.tsx); answer OK
await page.addLocatorHandler(page.getByRole('dialog', { name: /^(Are you sure\?|Please confirm)$/ }), async d => { await d.locator('footer button').last().click(); });
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
await page.goto(`${base}/#/`);

const rail = () => page.evaluate(() => localStorage.getItem('ergo.rail'));
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}').keys ?? {});
const row = id => page.locator(`.kbd-row[data-command="${id}"]`);
const openKeyboard = async () => {
  await page.keyboard.press('Shift+/');
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 5000 });
};
const addKey = async (id, ...presses) => {
  await row(id).getByRole('button', { name: /^Add a key to/ }).click();
  await row(id).getByRole('status').waitFor({ timeout: 3000 });
  for (const p of presses) await page.keyboard.press(p);
};

await openKeyboard();
check('every command is listed with the keys it has', (await page.locator('.kbd-row').count()) >= 20 && (await row('search.open').innerText()).includes('Ctrl+K') && (await row('go.tasks').innerText()).includes('G then T'), (await row('go.tasks').innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: `${shots}/keyboard-list.png` });
await page.getByLabel('Find a command or a key').fill('sidebar');
check('the list can be searched by what a command does', (await page.locator('.kbd-row').count()) === 2, await page.locator('.kbd-row').count());
await page.getByLabel('Find a command or a key').fill('Ctrl+K');
check('and by a key', (await row('search.open').count()) === 1);
await page.getByLabel('Find a command or a key').fill('');

// ---- a new key for a command, in addition to its own
const r0 = await rail();
await addKey('view.sidebar', 'Control+Shift+b');
await row('view.sidebar').locator('.kbd-chip', { hasText: 'Ctrl+Shift+B' }).waitFor({ timeout: 3000 });
check('a key pressed for a command is added to it', (await row('view.sidebar').innerText()).includes('Ctrl+Shift+B') && (await row('view.sidebar').innerText()).includes('Ctrl+\\'));
check('and kept on this device', JSON.stringify((await stored())['view.sidebar']) === JSON.stringify(['Mod+\\', 'Mod+Shift+b']), JSON.stringify(await stored()));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+Shift+b');
check('the new key does the command', !!(await until(async () => (await rail()) !== r0, 3000)), `${r0} -> ${await rail()}`);
await page.keyboard.press('Control+\\');
check('and the old one still does', !!(await until(async () => (await rail()) === r0, 3000)));

// ---- taking a key off
await openKeyboard();
await row('view.sidebar').getByRole('button', { name: /^Remove Ctrl\+\\ from/ }).click();
await page.keyboard.press('Escape');
await page.keyboard.press('Control+\\');
await page.waitForTimeout(400);
check('a key that was taken off does nothing', (await rail()) === r0, `${r0} -> ${await rail()}`);

// ---- a key that is someone else's
await openKeyboard();
await addKey('view.focus', 'Control+k');
await page.getByRole('alertdialog', { name: 'Keys already in use' }).waitFor({ timeout: 3000 });
check('a key that another command has is not taken silently', (await page.getByRole('alertdialog').innerText()).includes('Search'), await page.getByRole('alertdialog').innerText());
await page.getByRole('button', { name: 'Cancel' }).click();
check('cancelling changes nothing', (await row('search.open').innerText()).includes('Ctrl+K') && !(await row('view.focus').innerText()).includes('Ctrl+K'));
await addKey('view.focus', 'Control+k');
await page.getByRole('button', { name: 'Use it here instead' }).click();
check('using it here takes it from the other command', (await row('view.focus').innerText()).includes('Ctrl+K') && !(await row('search.open').innerText()).includes('Ctrl+K'), (await row('search.open').innerText()).replace(/\n/g, ' '));
await page.screenshot({ path: `${shots}/keyboard-changed.png` });

// ---- two plain keys one after the other, and what is not allowed
await addKey('go.files', 'x', 'y');
await row('go.files').locator('.kbd-chip', { hasText: 'X then Y' }).waitFor({ timeout: 3000 });
check('two plain keys in turn make a shortcut', true);
await addKey('go.trash', 'q');
await page.getByRole('alert').waitFor({ timeout: 4000 });
check('a single plain letter is refused, with the reason', (await page.getByRole('alert').innerText()).includes('Ctrl or Alt'), await page.getByRole('alert').innerText());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.reload();
await page.locator('.sidebar').waitFor();
await page.keyboard.press('x');
await page.keyboard.press('y');
check('the two-key shortcut works', !!(await until(async () => page.url().endsWith('#/files'), 3000)), page.url());
const focusOn = () => page.evaluate(() => JSON.parse(localStorage.getItem('ergo.prefs') ?? '{}').focus === true);
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
check('Ctrl+K no longer opens the search (it was given away)', (await page.getByRole('dialog', { name: 'Search' }).count()) === 0);
check('it does Focus mode now', await focusOn());
await page.keyboard.press('Control+Shift+f');
await page.waitForTimeout(300);
check('Ctrl+Shift+F, the old key of Focus mode, still does it too', !(await focusOn()));

// ---- the palette shows the new keys
await page.keyboard.press('Shift+/');
await page.getByRole('dialog', { name: 'Settings' }).waitFor();
await page.getByRole('button', { name: /^Put the keys of Search back$/ }).click().catch(() => undefined);
await page.getByLabel('Find a command or a key').fill('');
await page.getByRole('button', { name: /^Put the keys of Focus on the note back$/ }).click();
await page.getByRole('button', { name: /^Put the keys of Go to Files back$/ }).click();
check('reset puts a command’s own keys back', (await row('view.focus').innerText()).includes('Ctrl+Shift+F') && !(await row('view.focus').innerText()).includes('Ctrl+K'));
await page.getByRole('button', { name: 'Reset all' }).click();
await page.getByRole('dialog', { name: /^(Are you sure\?|Please confirm)$/ }).locator('footer button').last().click({ timeout: 2000 }).catch(() => {}); // the handler above may have answered it already
check('reset all puts them all back', (await stored()) && Object.keys(await stored()).length === 0, JSON.stringify(await stored()));
check('the original keys are shown again', (await row('search.open').innerText()).includes('Ctrl+K') && (await row('view.sidebar').innerText()).includes('Ctrl+\\') && !(await row('view.sidebar').innerText()).includes('Shift+B'));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
check('and they work again', !!(await page.getByRole('dialog', { name: 'Search' }).waitFor({ timeout: 3000 }).then(() => true, () => false)));

check('no console errors', errors.filter(x => !/Failed to load resource|status of 400/.test(x)).length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
