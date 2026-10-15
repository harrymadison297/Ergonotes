// Drive the installed Windows app through its WebView DevTools port: create the vault over files that are already
// in the folder, then edit a note. usage: node winfolder.mjs <cdpUrl> <step> <shotsDir>
import { chromium } from 'playwright';
const [cdp, step, shots = './shots'] = process.argv.slice(2);
const PASSWORD = 'correct horse battery staple';
const b = await chromium.connectOverCDP(cdp);
const page = b.contexts()[0].pages()[0];
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 250)); } };
if (step === 'create') {
  await page.getByLabel('Vault password').fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create vault' }).click();
  await page.locator('.sidebar').waitFor({ timeout: 60000 });
  await page.goto('http://tauri.localhost/#/notes');
  const titles = await until(async () => { const t = await page.locator('.note-row .note-title, .note-row').allInnerTexts(); return t.length >= 2 ? t : null; });
  console.log('NOTES', JSON.stringify(titles));
  await page.screenshot({ path: `${shots}/win-notes.png` });
} else if (step === 'edit') {
  await page.goto('http://tauri.localhost/#/notes');
  await page.locator('.note-row', { hasText: 'Plan' }).first().click();
  await page.locator('.prose h1', { hasText: 'Quarterly plan' }).waitFor({ timeout: 15000 });
  console.log('RAW', await page.locator('.prose .raw-inline').count(), await page.locator('.prose .raw-block').count(), await page.locator('.prose .wikilink').count());
  await page.locator('.prose h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' (edited on Windows)');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${shots}/win-edit.png` });
} else if (step === 'shot') {
  await page.screenshot({ path: `${shots}/win-${process.argv[5] ?? 'now'}.png` });
  console.log((await page.locator('body').innerText()).slice(0, 400));
}
await b.close();
