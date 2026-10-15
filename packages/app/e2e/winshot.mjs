// Look at a Tauri app through its WebView DevTools port: screenshot + a few facts. usage: node winshot.mjs <cdpUrl> <out.png>
import { chromium } from 'playwright';
const b = await chromium.connectOverCDP(process.argv[2]);
const page = b.contexts()[0].pages()[0];
await page.waitForTimeout(500);
console.log(await page.title(), await page.evaluate(() => location.href));
console.log((await page.locator('body').innerText()).slice(0, 600));
await page.screenshot({ path: process.argv[3] });
await b.close();
