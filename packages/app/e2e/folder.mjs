// The vault is a folder of Markdown files (ADR 0010): files put there become notes, an edit in the app changes
// only what was edited, and edits made by another program show up. usage: node folder.mjs <baseUrl> <shotsDir> <vaultDir>
// <vaultDir> is the server's vault folder as this script sees it (the e2e runner mounts it). When the server runs in
// a VM, set VAULT_SSH to a JSON array with the ssh command (and user@host) and <vaultDir> to the path inside the VM.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:8080';
const shots = process.argv[3] ?? './shots';
const vault = process.argv[4];
if (!vault) { console.error('usage: node folder.mjs <baseUrl> <shotsDir> <vaultDir>'); process.exit(2); }
mkdirSync(shots, { recursive: true });
const PASSWORD = 'correct horse battery staple';
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + String(extra).slice(0, 900) : ''}`); if (!ok) failures++; };
const until = async (fn, ms = 25000) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) return null; await new Promise(r => setTimeout(r, 200)); }
};
const SSH = process.env.VAULT_SSH ? JSON.parse(process.env.VAULT_SSH) : null;
const q = x => `'${String(x).replace(/'/g, `'\\''`)}'`;
const remote = (cmd, input) => execFileSync(SSH[0], [...SSH.slice(1), cmd], { encoding: input instanceof Buffer ? 'buffer' : 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] });
const abs = p => `${vault}/${p}`;
const read = p => {
  if (SSH) { try { return remote(`cat ${q(abs(p))}`); } catch { return null; } }
  return existsSync(join(vault, p)) ? readFileSync(join(vault, p), 'utf8') : null;
};
const readBytes = p => (SSH ? remote(`cat ${q(abs(p))}`, Buffer.alloc(0)) : readFileSync(join(vault, p)));
const put = (p, data) => {
  if (SSH) { remote(`mkdir -p ${q(dirname(abs(p)))} && cat > ${q(abs(p))}`, typeof data === 'string' ? data : Buffer.from(data)); return; }
  mkdirSync(join(vault, p, '..'), { recursive: true });
  writeFileSync(join(vault, p), data);
};
const rm = p => { if (SSH) remote(`rm -rf ${q(abs(p))}`); else rmSync(join(vault, p)); };
const ls = p => (SSH ? remote(`ls -1A ${q(abs(p))}`).split('\n').filter(Boolean) : readdirSync(join(vault, p)));
const files = p => (SSH ? remote(`cd ${q(abs(p))} && find . -type f`).split('\n').filter(Boolean).map(f => f.replace(/^\.\//, '')) : (function walk(d) { return readdirSync(join(vault, p, d), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])); })(''));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('ergo.rail', '0'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// a folder somebody already filled, before the app has ever seen it
const NOTE = [
  '---', '# kept by whoever wrote it', 'title: Hand written', 'tags:', '- project', '- work/acme', 'aliases: [Plan B]', 'cssclass: wide', '---',
  '# Quarterly plan', '', '* odd bullet marker', '* second item', '', '![[diagram.png]]', '', '%%private comment%%', '',
  'A paragraph that is hard', 'wrapped across two lines, with a [[Other note]] link.', '', '> [!note] Callout title', '> inside the callout', '',
  '```dataview', 'TABLE file.name FROM "Projects"', '```', '', '<div class="custom">raw html stays</div>', '', 'Reference to a footnote[^1] and a block id ^abc123', '',
  '[^1]: The footnote text.', '',
].join('\n');
put('Projects/Plan.md', NOTE);
put('Other note.md', 'Plain note without any frontmatter.\n');
put('attachments/diagram.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
put('.obsidian/app.json', '{}');

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
const rpc = (method, ...args) => page.evaluate(async ([m, a]) => (await (await fetch(`/api/rpc/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json()), [method, args]);

// ---- the files became notes
const planItem = await until(async () => (await rpc('listItems')).find(i => i.title === 'Plan' && i.type === 'note'));
check('a file put in the folder is a note, titled by its file name', !!planItem && planItem.filePath === 'Projects/Plan.md');
check('its tags come from the frontmatter', !!planItem && planItem.tags.join(',') === 'project,work/acme');
check('the folders are there too', (await rpc('listItems')).some(i => i.type === 'folder' && i.filePath === 'Projects'));
check('a folder with files in it gets no default folders added', !(await rpc('listItems')).some(i => i.title === 'Areas'));
check('opening the folder did not change any file', read('Projects/Plan.md') === NOTE && read('Other note.md') === 'Plain note without any frontmatter.\n');

// ---- open it: what the editor does not know is shown as it is
await page.goto(`${base}/#/notes/${planItem.id}`);
await page.locator('.prose').waitFor();
await page.locator('.prose h1', { hasText: 'Quarterly plan' }).waitFor();
check('the heading and the lists render', (await page.locator('.prose ul li').count()) === 2);
check('![[embed]], %%comment%%, [^1] and ^id are shown as they are', (await page.locator('.prose .raw-inline').count()) >= 4);
check('the HTML and the dataview fence are kept as blocks', (await page.locator('.prose .raw-block').count()) >= 1 && (await page.locator('.prose pre code').count()) >= 1);
check('an ![[image]] embed shows the picture from the vault', !!(await until(() => page.locator('.prose .raw-embed img').count().then(n => n > 0))));
check('a [[wiki link]] is a link to the other note', (await page.locator('.prose .wikilink').count()) === 1);
await page.screenshot({ path: `${shots}/folder-open.png` });

// ---- edit one block; everything else must stay byte for byte
await page.locator('.prose h1').click();
await page.keyboard.press('End');
await page.keyboard.type(' (revised)');
await until(async () => read('Projects/Plan.md')?.includes('(revised)'));
const after = read('Projects/Plan.md') ?? '';
check('the edit reached the file', after.includes('# Quarterly plan (revised)'));
check('the file got an id, and its other properties are untouched', after.includes(`id: ${planItem.id}`) && after.includes('# kept by whoever wrote it') && after.includes('aliases: [Plan B]') && after.includes('cssclass: wide') && after.includes('title: Hand written'));
const rest = NOTE.slice(NOTE.indexOf('* odd bullet marker'));
check('every block that was not edited is exactly as it was', after.endsWith(rest), JSON.stringify(after.slice(after.indexOf('(revised)'))));

// ---- another program edits the file while the app has it open
put('Projects/Plan.md', after.replace('(revised)', '(edited elsewhere)'));
const seen = await until(async () => (await page.locator('.prose h1').textContent())?.includes('edited elsewhere'), 15000);
check('an edit made by another program shows up in the open note', !!seen);

// ---- rename: the file and the links to it follow
await page.getByLabel('Title').fill('Quarterly plan Q4');
await until(async () => read('Projects/Quarterly plan Q4.md') !== null && read('Projects/Plan.md') === null);
check('renaming the note renames the file', read('Projects/Quarterly plan Q4.md') !== null && read('Projects/Plan.md') === null);
put('Links to it.md', 'See [the plan](Projects/Quarterly%20plan%20Q4.md) and [[Quarterly plan Q4]].\n');
await until(async () => (await rpc('listItems')).some(i => i.title === 'Links to it'));
const linker = (await rpc('listItems')).find(i => i.title === 'Links to it');
check('the other note sees it as a link', (await rpc('getNote', planItem.id)).backlinks.some(b => b.id === linker.id));
await rpc('rename', planItem.id, 'Plan final');
await until(async () => read('Projects/Plan final.md') !== null);
const linkerText = read('Links to it.md') ?? '';
check('links in other files are rewritten, nothing else in them (not even an id is added)', linkerText === 'See [the plan](Projects/Plan%20final.md) and [[Plan final]].\n', JSON.stringify(linkerText));

// ---- a new note made in the app is a file in the folder
await page.goto(`${base}/#/notes`);
await page.getByRole('button', { name: 'New note' }).first().click();
await page.getByLabel('Title').fill('Made in the app');
await page.locator('.prose').click();
await page.keyboard.type('hello from the app');
await until(async () => read('Inbox/Made in the app.md')?.includes('hello from the app') ? true : null);
const made = read('Inbox/Made in the app.md') ?? '';
check('a note made in the app is a Markdown file named after its title', made.includes('hello from the app') && /^---\nid: [0-9a-f-]{36}\n---\n/.test(made), JSON.stringify(made));

// ---- moved in the app, moved on disk
const madeItem = (await rpc('listItems')).find(i => i.title === 'Made in the app');
const projects = (await rpc('listItems')).find(i => i.type === 'folder' && i.filePath === 'Projects');
await rpc('move', madeItem.id, projects.id);
await until(async () => read('Projects/Made in the app.md') !== null);
check('moving a note in the app moves the file', read('Projects/Made in the app.md') !== null && read('Inbox/Made in the app.md') === null);

// ---- deleted in the file manager, it is in the Trash and can come back
rm('Other note.md');
await until(async () => (await rpc('listItems')).find(i => i.title === 'Other note')?.inTrash);
check('a file deleted outside is in the Trash', !!(await rpc('listItems')).find(i => i.title === 'Other note')?.inTrash);
const other = (await rpc('listItems')).find(i => i.title === 'Other note');
await rpc('restore', other.id);
check('and it comes back as a file', read('Other note.md') === 'Plain note without any frontmatter.\n');

// ---- the database is not in the way of other tools, and not readable
const ergonotes = ls('.ergonotes');
check('the app keeps its history in .ergonotes, and nothing about this device', ergonotes.includes('vault.json') && ergonotes.includes('commits') && !ergonotes.includes('meta.json'));
const sealed = files('.ergonotes/commits');
check('what it stores there is sealed with the vault key', sealed.length > 0 && sealed.every(f => f.endsWith('.bin') && !readBytes(`.ergonotes/commits/${f}`).includes('Quarterly')));

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
