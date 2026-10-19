// Typing Markdown in the note editor: links (typed, from the Link item, edited as text), formulas, dates, the task words in
// the / and @ menus, and a click on a web link. Runs on the web demo (`npm -w @ergonotes/app run build:demo` + a static server, or
// `vite --mode demo`). usage: node editor-markdown.mjs <baseUrl>
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
let fails = 0;
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + String(x).slice(0, 300) : ''}`); if (!ok) fails++; };
await p.goto(process.argv[2] ?? 'http://127.0.0.1:5199/');
await p.getByRole('button', { name: /New note/ }).first().click();
const ed = p.locator('.ProseMirror').first();
await ed.waitFor();
const html = () => ed.evaluate(e => e.innerHTML);
/** type "/word" and take the first item once the menu is up (it is filled in a moment after the key) */
const slash = async word => { await p.keyboard.type('/' + word, { delay: 30 }); await p.locator('.menu .menu-item').first().waitFor({ timeout: 3000 }); await p.keyboard.press('Enter'); };
const fresh = async () => { await ed.click(); await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); };
const links = () => ed.evaluate(e => [...e.querySelectorAll('a[href]')].map(a => `${a.textContent}→${a.getAttribute('href')}`));

// 1 typed Markdown link
await ed.click();
await p.keyboard.type('see [Anthropic](https://anthropic.com) now', { delay: 15 });
let l = await links();
check('typed [text](url) becomes a link', l.join('|') === 'Anthropic→https://anthropic.com', l + ' / ' + (await ed.innerText()));
check('text after the link is not linked', (await ed.innerText()).includes('see Anthropic now'), await ed.innerText());

// 2 title
await fresh();
await p.keyboard.type('[x](https://a.b "hi") ', { delay: 10 });
check('link with a title', (await ed.evaluate(e => e.querySelector('a')?.getAttribute('title'))) === 'hi', await html());

// 3 slash Link
await fresh();
await p.keyboard.type('/link', { delay: 30 });
await p.locator('.menu .menu-item').first().waitFor({ timeout: 3000 });
check('slash menu lists Link first', (await p.locator('.menu .menu-item').first().innerText()).startsWith('Link') && !(await p.locator('.menu .menu-item').first().innerText()).includes('to note'));
await p.keyboard.press('Enter');
check('slash Link writes [text]()', (await ed.innerText()).trim() === '[text]()', await ed.innerText());
await p.keyboard.type('Home', { delay: 10 });
await p.keyboard.press('Tab');
await p.keyboard.type('https://example.org', { delay: 10 });
await p.keyboard.press('Enter');
l = await links();
check('filled-in template becomes the link', l.join('|') === 'Home→https://example.org', l + ' / ' + await ed.innerText());
await p.keyboard.type(' after', { delay: 10 });
check('typing after it is not part of the link', (await links()).join('|') === 'Home→https://example.org');

// 4 abandoned (caret leaves)
await fresh();
await slash('link');
await p.keyboard.type('Docs', { delay: 10 }); await p.keyboard.press('Tab');
await p.keyboard.type('https://docs.dev', { delay: 10 });
await p.keyboard.press('Home');
l = await links();
check('moving away converts the link', l.join('|') === 'Docs→https://docs.dev', l + ' / ' + await ed.innerText());

// 5 empty address stays text
await fresh();
await slash('link');
await p.keyboard.type('Nothing', { delay: 10 }); await p.keyboard.press('End');
check('no address: stays plain text', (await links()).length === 0 && (await ed.innerText()).includes('[Nothing]()'), await ed.innerText());

// 6 typing [x]( auto-closes
await fresh();
await p.keyboard.type('[Site](', { delay: 15 });
check('( after [text] adds the closing )', (await ed.innerText()).trim() === '[Site]()', await ed.innerText());
await p.keyboard.type('www.example.com)', { delay: 10 });
l = await links();
check('typing ) finishes it (www gets https)', l.join('|') === 'Site→https://www.example.com', l + ' / ' + await ed.innerText());

// 7 link on a link shows markdown
await fresh();
await p.keyboard.type('[Back](https://back.io) ', { delay: 10 });
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
await p.getByRole('button', { name: /^Link/ }).click();
check('Link on a link shows its Markdown', (await ed.innerText()).includes('[Back](https://back.io)') && (await links()).length === 0, await ed.innerText());
await p.keyboard.type('https://new.io', { delay: 10 }); await p.keyboard.press('Enter');
l = await links();
check('edited address is applied', l.join('|') === 'Back→https://new.io', l + '');

// 8 math + date
await fresh();
await p.keyboard.type('E is $x^2$ and $5 and $6 ok', { delay: 10 });
check('$x^2$ becomes a formula', (await ed.locator('.math-inline').count()) === 1, await html());
check('"$5 and $6" stays prose', (await ed.innerText()).includes('$5 and $6'), await ed.innerText());
await fresh();
await p.keyboard.type('@date(2026-10-20)', { delay: 10 });
check('@date(...) becomes a chip', (await ed.locator('.date-chip').count()) === 1, await html());


// 8b table and formula block, typed
await fresh();
await p.keyboard.type('| Name | Qty |\n|---|---|\n', { delay: 10 });
check('header + |---| and Enter make a table', (await ed.locator('table').count()) === 1 && (await ed.locator('table th').allInnerTexts()).join(',') === 'Name,Qty', await html());
await p.keyboard.type('Tea', { delay: 10 }); await p.keyboard.press('Tab'); await p.keyboard.type('3', { delay: 10 });
check('the caret is in the first body cell', (await ed.locator('table td').allInnerTexts()).join(',') === 'Tea,3', await ed.locator('table td').allInnerTexts());
await fresh();
await p.keyboard.type('$$\n', { delay: 10 });
check('$$ and Enter make a formula block', (await ed.locator('.math-block').count()) === 1, await html());
await fresh();
await p.keyboard.type('a | b\nplain line\n', { delay: 10 });
check('a line with a pipe is still just text', (await ed.locator('table').count()) === 0);

// 9 slash due / remind / flag
await fresh();
await p.keyboard.type('/due', { delay: 30 });
await p.waitForTimeout(200);
check('/due offers Due date', (await p.locator('.menu .menu-item').allInnerTexts()).some(t => t.includes('Due date')));
await p.keyboard.press('Enter');
await p.getByRole('dialog', { name: 'Due date' }).waitFor({ timeout: 3000 }).catch(() => {});
check('Due date opens its dialog', (await p.getByRole('dialog', { name: 'Due date' }).count()) === 1);
await p.getByRole('textbox', { name: 'Date' }).fill('2026-10-25');
await p.getByRole('button', { name: 'Set', exact: true }).click();
check('line became a task with @due', (await ed.locator('li[data-checked]').count()) === 1 && (await ed.innerText()).includes('@due(2026-10-25)'), await ed.innerText());
await fresh();
await p.keyboard.type('@du', { delay: 40 });
await p.waitForTimeout(200);
check('@du offers @due', (await p.locator('.menu .menu-item').allInnerTexts()).some(t => t.includes('@due')), await p.locator('.menu').allInnerTexts());
await p.keyboard.press('Escape');

// 10 plain slash shows no empty box
await fresh();
await p.keyboard.type('a /zzzz', { delay: 30 });
await p.waitForTimeout(200);
const visible = await p.locator('.menu').evaluateAll(els => els.filter(e => getComputedStyle(e).display !== 'none').length);
check('"/zzzz" shows no empty menu', visible === 0, visible);

// 11 click opens the viewer
await fresh();
await p.keyboard.type('[Anthropic](https://example.com/doc.pdf) ', { delay: 10 });
await ed.locator('a').first().click();
await p.getByRole('dialog').waitFor({ timeout: 3000 }).catch(() => {});
check('click on a web link opens the viewer', (await p.locator('.webview-frame iframe').count()) === 1 && (await p.locator('.webview-frame iframe').getAttribute('src')) === 'https://example.com/doc.pdf');


await p.keyboard.press('Escape'); // the viewer
// 12 what was typed is saved even when the note is left before the save timer ran
await fresh();
await p.keyboard.type('keep this line [kept](https://kept.io)', { delay: 8 });
await p.locator('.note-row, .note-card, [data-note-id]').filter({ hasText: 'Welcome to the' }).first().click();
await p.waitForTimeout(500);
await p.locator('.note-row, .note-card, [data-note-id]').filter({ hasText: 'keep this line' }).first().click();
await p.waitForTimeout(500);
check('a note left right after typing keeps its text', (await p.locator('.ProseMirror').first().innerText()).includes('keep this line kept'), await p.locator('.ProseMirror').first().innerText());
check('and its link', (await p.locator('.ProseMirror a[href="https://kept.io"]').count()) === 1);
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exitCode = fails ? 1 : 0;
await b.close();
