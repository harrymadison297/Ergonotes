import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/server.ts';

const PASSWORD = 'correct horse battery staple';
let dir: string;
let srv: RunningServer;
let base: string;
let cookie = '';

async function rpc(method: string, ...args: unknown[]) {
  const r = await fetch(`${base}/api/rpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(args),
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: r.status, body: await r.json() };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ergonotes-server-'));
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, kdf: { m: 256, t: 1, p: 1 }, mirrorDir: join(dir, 'md') });
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

describe('server peer', () => {
  it('requires a session for everything except status and first-run setup', async () => {
    expect((await rpc('listItems')).status).toBe(401);
    const st = await (await fetch(`${base}/api/status`)).json();
    expect(st).toMatchObject({ state: 'no-vault', remote: true, authenticated: false });
  });

  it('creates the vault, serves the API with a session cookie, and rejects unknown methods', async () => {
    const created = await rpc('createVault', PASSWORD);
    expect(created.status).toBe(200);
    expect(cookie).toMatch(/^ergo_session=/);
    const items = await rpc('listItems');
    expect(items.status).toBe(200);
    expect(items.body.map((i: { title: string }) => i.title)).toContain('Inbox');
    expect((await rpc('nope')).status).toBe(404);
    const note = await rpc('createNote', { title: 'From the web', body: 'hello **world**' });
    expect(note.body.title).toBe('From the web');
    const found = await rpc('search', 'world');
    expect(found.body.map((i: { id: string }) => i.id)).toContain(note.body.id);
  });

  it('signs in again with the password, refuses a wrong one, and ends the session on lock', async () => {
    cookie = '';
    expect((await rpc('unlock', 'definitely not it!!')).status).toBe(401);
    expect((await rpc('unlock', PASSWORD)).status).toBe(200);
    expect((await rpc('listItems')).status).toBe(200);
    expect((await rpc('lock')).status).toBe(200);
    cookie = '';
    expect((await rpc('listItems')).status).toBe(401);
  });

  it('refuses cross-origin POSTs and non-JSON bodies', async () => {
    await rpc('unlock', PASSWORD);
    const bad = await fetch(`${base}/api/rpc/listItems`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie }, body: '[]' });
    expect(bad.status).toBe(403);
    const text = await fetch(`${base}/api/rpc/listItems`, { method: 'POST', headers: { 'content-type': 'text/plain', cookie }, body: '[]' });
    expect(text.status).toBe(415);
  });

  it('rate limits password guessing', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await rpc('unlock', `wrong password number ${i}`)).status;
    expect(last).toBe(429);
  });

  it('mirrors notes to plain markdown files', async () => {
    cookie = '';
    // the limiter is per address; use a fresh server window by waiting is slow, so write directly through the mirror
    const { Mirror } = await import('../src/mirror.ts');
    const m = new Mirror(srv.vault, join(dir, 'md-direct'));
    await m.write();
    const files = await readdir(join(dir, 'md-direct'), { recursive: true });
    const note = files.find(f => f.endsWith('From the web.md'));
    expect(note).toBeTruthy();
    expect(await readFile(join(dir, 'md-direct', note!), 'utf8')).toContain('hello **world**');
  });
});
