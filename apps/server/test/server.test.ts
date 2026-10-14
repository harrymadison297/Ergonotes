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

describe('MCP endpoint', () => {
  let dir2: string;
  let srv2: RunningServer;
  let url: string;
  let sess = '';
  let token = '';

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) sess = set.split(';')[0];
    return { status: r.status, body: r.status === 202 ? null : await r.json() };
  };
  const mcp = (method: string, params?: unknown, auth = token) =>
    post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, auth ? { authorization: `Bearer ${auth}` } : {});
  const tool = async (name: string, args: unknown = {}) => {
    const r = await mcp('tools/call', { name, arguments: args });
    return { error: r.body.result.isError === true, text: r.body.result.content[0].text as string };
  };

  beforeAll(async () => {
    dir2 = await mkdtemp(join(tmpdir(), 'ergonotes-mcp-'));
    srv2 = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir2, kdf: { m: 256, t: 1, p: 1 }, mirrorDir: null });
    url = `http://127.0.0.1:${srv2.port}`;
    await post('/api/rpc/createVault', [PASSWORD]);
    const t = await post('/api/tokens', { name: 'Claude' }, { cookie: sess });
    token = t.body.token;
  });
  afterAll(async () => { await srv2.close(); await rm(dir2, { recursive: true, force: true }); });

  it('rejects calls without a valid API token', async () => {
    expect((await mcp('tools/list', {}, '')).status).toBe(401);
    expect((await mcp('tools/list', {}, 'ergo_wrong')).status).toBe(401);
    expect(token).toMatch(/^ergo_/);
  });

  it('initialises and lists the tools', async () => {
    const init = await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(init.body.result.serverInfo.name).toBe('ergonotes');
    const list = await mcp('tools/list');
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_notes', 'read_note', 'create_note', 'append_to_note', 'list_tasks']));
    expect((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization: `Bearer ${token}` })).status).toBe(202);
  });

  it('lets an agent write, find, read, extend and complete tasks', async () => {
    const created = JSON.parse((await tool('create_note', { title: 'Agent note', body: '- [ ] Review the plan', tags: ['ai'] })).text);
    expect((await tool('search_notes', { query: 'agent' })).text).toContain(created.id);
    await tool('append_to_note', { id: created.id, text: 'Appended by an agent' });
    const read = JSON.parse((await tool('read_note', { id: created.id })).text);
    expect(read.body).toContain('Review the plan');
    expect(read.body).toContain('Appended by an agent');
    expect(read.tags).toEqual(['ai']);
    const tasks = JSON.parse((await tool('list_tasks')).text);
    const t = tasks.find((x: { noteId: string }) => x.noteId === created.id);
    expect(t.text).toBe('Review the plan');
    await tool('complete_task', { noteId: created.id, index: t.index });
    expect(JSON.parse((await tool('list_tasks')).text).some((x: { noteId: string }) => x.noteId === created.id)).toBe(false);
    expect((await tool('read_note', { id: 'missing' })).error).toBe(true);
  });

  it('revoking a token stops it working', async () => {
    const t2 = await post('/api/tokens', { name: 'Temp' }, { cookie: sess });
    expect((await mcp('ping', {}, t2.body.token)).status).toBe(200);
    const list = await (await fetch(`${url}/api/tokens`, { headers: { cookie: sess } })).json();
    const rec = list.find((x: { name: string }) => x.name === 'Temp');
    await post('/api/tokens', { revoke: rec.id }, { cookie: sess });
    expect((await mcp('ping', {}, t2.body.token)).status).toBe(401);
  });
});

describe('first-run protection', () => {
  it('requires the setup token when configured and hides details before sign-in', async () => {
    const d = await mkdtemp(join(tmpdir(), 'ergonotes-setup-'));
    const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: d, kdf: { m: 256, t: 1, p: 1 }, mirrorDir: null, setupToken: 'let-me-in' });
    const u = `http://127.0.0.1:${s.port}`;
    const post = (args: unknown[]) => fetch(`${u}/api/rpc/createVault`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    expect((await post([PASSWORD])).status).toBe(403);
    expect((await post([PASSWORD, { setupToken: 'wrong' }])).status).toBe(403);
    const ok = await post([PASSWORD, { setupToken: 'let-me-in' }]);
    expect(ok.status).toBe(200);
    const cookieHeader = ok.headers.get('set-cookie')!.split(';')[0];
    await fetch(`${u}/api/rpc/setStore`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieHeader }, body: JSON.stringify([{ type: 'folder', path: join(d, 'store') }]) });
    const anon = await (await fetch(`${u}/api/status`)).json();
    expect(anon.authenticated).toBe(false);
    expect(anon.store).toBeNull();
    expect(anon.lastSyncError).toBeNull();
    const authed = await (await fetch(`${u}/api/status`, { headers: { cookie: cookieHeader } })).json();
    expect(authed.store?.type).toBe('folder');
    await s.close();
    await rm(d, { recursive: true, force: true });
  });
});
