import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
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
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, kdf: { m: 256, t: 1, p: 1 } });
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

// One scenario, run in order: create the vault, sign in, sign out, mirror. Each later test relies on the state the
// earlier ones left (the vault, the cookie). Everything that needs its own state has its own server below.
describe.sequential('server peer', () => {
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

  it('keeps every note as a Markdown file in the vault folder, and reads files put there', async () => {
    const files = await readdir(join(dir, 'vault'), { recursive: true });
    const note = files.find(f => f.endsWith('From the web.md'));
    expect(note).toBeTruthy();
    expect(await readFile(join(dir, 'vault', note!), 'utf8')).toContain('hello **world**');
    // a file somebody drops into the folder becomes a note
    await writeFile(join(dir, 'vault', 'Dropped in.md'), '# Dropped\n\nfrom the file manager\n');
    await srv.vault.unlock(PASSWORD);
    await new Promise(r => setTimeout(r, 800)); // a file written this moment is read on a later scan
    await srv.vault.rescan();
    expect((await srv.vault.listItems()).some(i => i.title === 'Dropped in' && i.type === 'note')).toBe(true);
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
    srv2 = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir2, kdf: { m: 256, t: 1, p: 1 } });
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

  it('refuses a request that comes from a web page of another origin', async () => {
    const r = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${token}`, origin: 'https://evil.example' });
    expect(r.status).toBe(403);
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

  it('hides private notes from agents and refuses to change them', async () => {
    const made = JSON.parse((await tool('create_note', { title: 'Diary', body: 'secret thoughts about zebra' })).text);
    expect((await tool('search_notes', { query: 'zebra' })).text).toContain(made.id);
    await post('/api/rpc/setPrivate', [made.id, true], { cookie: sess });
    expect((await tool('search_notes', { query: 'zebra' })).text).not.toContain(made.id);
    expect((await tool('list_recent')).text).not.toContain(made.id);
    expect((await tool('read_note', { id: made.id })).error).toBe(true);
    expect((await tool('append_to_note', { id: made.id, text: 'x' })).error).toBe(true);
    expect((await tool('replace_text', { id: made.id, find: 'zebra', replace: 'cat' })).error).toBe(true);
    const names = (await mcp('tools/list')).body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['replace_text', 'insert_after_heading', 'add_tags', 'move_note', 'rename_note']));
    expect(names).not.toContain('delete_note');
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

describe('AI proxy', () => {
  it('streams the provider answer to a signed-in browser and keeps the key on the server', async () => {
    let seenAuth = '';
    const aiFetch = (async (_u: string, init: RequestInit) => {
      seenAuth = new Headers(init.headers).get('authorization') ?? '';
      const chunks = [{ choices: [{ delta: { content: 'Hi ' } }] }, { choices: [{ delta: { content: 'there' } }] }];
      return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    await withServer({ aiFetch }, async (_s, u) => {
      const ask = (headers: Record<string, string> = {}) =>
        postJson(u, '/api/ai/stream', JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'hello' }] }), headers);
      expect((await ask()).status).toBe(401);
      const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const cookie = created.headers.get('set-cookie')!.split(';')[0];
      const saved = await (await postJson(u, '/api/rpc/setAiSettings', JSON.stringify([{ connection: { id: 'or', type: 'openrouter', key: 'sk-or-server-side' } }]), { cookie })).json();
      expect(saved).toMatchObject({ chatReady: true });
      expect(saved.connections[0].keyHint).toBe('side');
      expect(JSON.stringify(saved)).not.toContain('server-side');
      expect(JSON.stringify(await (await postJson(u, '/api/rpc/getAiSettings', '[]', { cookie })).json())).not.toContain('sk-or');
      const r = await ask({ cookie });
      expect(r.status).toBe(200);
      const events = (await r.text()).trim().split('\n').map(l => JSON.parse(l) as { type: string; delta?: string });
      expect(events.filter(e => e.type === 'text').map(e => e.delta).join('')).toBe('Hi there');
      expect(seenAuth).toBe('Bearer sk-or-server-side');
      const bad = await postJson(u, '/api/ai/stream', JSON.stringify({ model: 'nope', messages: [] }), { cookie });
      expect(bad.status).toBe(400);
      const cross = await postJson(u, '/api/ai/stream', JSON.stringify({ model: 'chat', messages: [] }), { cookie, origin: 'https://evil.example' });
      expect(cross.status).toBe(403);
    });
  });

  it('talks to a custom OpenAI-style server (Ollama) and lists its models', async () => {
    const { createServer } = await import('node:http');
    const calls: { url: string; auth: string | undefined; body: string }[] = [];
    const ollama = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        calls.push({ url: req.url ?? '', auth: req.headers.authorization, body });
        if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'llama3.2:3b' }] })); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'local ' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}\n\ndata: [DONE]\n\n`);
        res.end();
      });
    });
    await new Promise<void>(r => ollama.listen(0, '127.0.0.1', r));
    const port = (ollama.address() as { port: number }).port;
    try {
      await withServer({}, async (_s, u) => {
        const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
        const cookie = created.headers.get('set-cookie')!.split(';')[0];
        const saved = await (await postJson(u, '/api/rpc/setAiSettings', JSON.stringify([{ connection: { id: 'ollama', type: 'custom', url: `http://127.0.0.1:${port}` } }]), { cookie })).json();
        expect(saved).toMatchObject({ chatReady: true, chatModel: { connection: 'ollama', model: 'llama3.2' } });
        expect((await postJson(u, '/api/ai/models', '{"connection":"ollama"}')).status).toBe(401);
        expect((await postJson(u, '/api/ai/models', '{"connection":"nope"}', { cookie })).status).toBe(400);
        const models = await (await postJson(u, '/api/ai/models', '{"connection":"ollama"}', { cookie })).json();
        expect(models).toEqual({ models: [{ id: 'llama3.2:3b' }] });
        const r = await postJson(u, '/api/ai/stream', JSON.stringify({ model: 'chat', messages: [{ role: 'user', content: 'hi' }] }), { cookie });
        const text = (await r.text()).trim().split('\n').map(l => JSON.parse(l) as { type: string; delta?: string }).filter(e => e.type === 'text').map(e => e.delta).join('');
        expect(text).toBe('local answer');
        expect(calls.at(-1)!.url).toBe('/v1/chat/completions');
        expect(calls.at(-1)!.auth).toBeUndefined();
        expect(JSON.parse(calls.at(-1)!.body).model).toBe('llama3.2');
        // an address nobody listens on is explained, not a hang
        await postJson(u, '/api/rpc/setAiSettings', JSON.stringify([{ connection: { id: 'ollama', url: 'http://127.0.0.1:9' } }]), { cookie });
        const down = await (await postJson(u, '/api/ai/stream', JSON.stringify({ model: 'chat', messages: [] }), { cookie })).text();
        expect(JSON.parse(down.trim().split('\n').at(-1)!).message).toMatch(/Could not reach 127\.0\.0\.1:9/);
      });
    } finally { await new Promise<void>(r => ollama.close(() => r())); }
  });

  it('transcribes a recording through the configured server, for a signed-in browser only', async () => {
    let seen = '';
    const aiFetch = (async (u: string, init: RequestInit) => {
      seen = `${u} ${new Headers(init.headers).get('authorization')} ${String((init.body as FormData).get('model'))}`;
      return new Response(JSON.stringify({ text: 'Buy milk' }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await withServer({ aiFetch }, async (_s, u) => {
      const body = JSON.stringify({ name: 'v.webm', mime: 'audio/webm', data: Buffer.from('audio').toString('base64') });
      expect((await postJson(u, '/api/ai/transcribe', body)).status).toBe(401);
      const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const cookie = created.headers.get('set-cookie')!.split(';')[0];
      const none = await postJson(u, '/api/ai/transcribe', body, { cookie });
      expect(none.status).toBe(400);
      expect((await none.json()).error).toMatch(/not set up/);
      await postJson(u, '/api/rpc/setAiSettings', JSON.stringify([{ connection: { id: 'w', type: 'custom', url: 'http://stt.local:9000', key: 'k' }, speechModel: { connection: 'w', model: '' } }]), { cookie });
      const r = await postJson(u, '/api/ai/transcribe', body, { cookie });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ text: 'Buy milk' });
      expect(seen).toBe('http://stt.local:9000/v1/audio/transcriptions Bearer k whisper-1');
      expect((await postJson(u, '/api/ai/transcribe', '{}', { cookie })).status).toBe(400);
      expect((await postJson(u, '/api/ai/transcribe', body, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    });
  });

  it('asks the same of every AI endpoint: a POST, a signed-in page of this site, and for the stream JSON', async () => {
    await withServer({}, async (_s, u) => {
      const get = (path: string, headers: Record<string, string> = {}) => fetch(`${u}${path}`, { headers });
      const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const cookie = created.headers.get('set-cookie')!.split(';')[0];
      for (const path of ['/api/ai/stream', '/api/ai/models', '/api/ai/transcribe']) {
        expect((await get(path, { cookie })).status, `GET ${path}`).toBe(405);
        expect((await postJson(u, path, '{}')).status, `signed out ${path}`).toBe(401);
        expect((await postJson(u, path, '{}', { cookie, origin: 'https://evil.example' })).status, `cross-origin ${path}`).toBe(403);
      }
      const plain = await fetch(`${u}/api/ai/stream`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' });
      expect(plain.status).toBe(415);
    });
  });

  it('reports a provider failure as an error event instead of hanging', async () => {
    const aiFetch = (async () => new Response(JSON.stringify({ error: { message: 'No credits' } }), { status: 402 })) as unknown as typeof fetch;
    await withServer({ aiFetch }, async (_s, u) => {
      const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const cookie = created.headers.get('set-cookie')!.split(';')[0];
      await postJson(u, '/api/rpc/setAiSettings', JSON.stringify([{ connection: { id: 'or', type: 'openrouter', key: 'k' } }]), { cookie });
      const r = await postJson(u, '/api/ai/stream', JSON.stringify({ model: 'chat', messages: [] }), { cookie });
      const last = JSON.parse((await r.text()).trim().split('\n').at(-1)!) as { type: string; message: string };
      expect(last).toEqual({ type: 'error', message: 'No credits' });
    });
  });
});

describe('first-run protection', () => {
  it('requires the setup token when configured and hides details before sign-in', async () => {
    const d = await mkdtemp(join(tmpdir(), 'ergonotes-setup-'));
    const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: d, kdf: { m: 256, t: 1, p: 1 }, setupToken: 'let-me-in' });
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

// ---------------------------------------------------------------- hardening (each test has its own server)
async function withServer(opts: Partial<Parameters<typeof startServer>[0]>, fn: (s: RunningServer, u: string, d: string) => Promise<void>) {
  const d = await mkdtemp(join(tmpdir(), 'ergonotes-hard-'));
  const s = await startServer({ port: 0, host: '127.0.0.1', dataDir: d, kdf: { m: 256, t: 1, p: 1 }, ...opts });
  try { await fn(s, `http://127.0.0.1:${s.port}`, d); } finally { await s.close(); await rm(d, { recursive: true, force: true }); }
}
const postJson = (u: string, path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${u}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
/** A request with a chosen Host header (fetch refuses to set it). */
const rawGet = (port: number, host: string) => new Promise<{ status: number; text: string }>((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: '/api/status', headers: { host } }, res => {
    let text = '';
    res.on('data', c => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
  });
  req.on('error', reject);
  req.end();
});

describe('sign-in protection', () => {
  it('rate limits password guessing', async () => {
    await withServer({}, async (_s, u) => {
      await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      let last = 0;
      for (let i = 0; i < 12; i++) last = (await postJson(u, '/api/rpc/unlock', JSON.stringify([`wrong password number ${i}`]))).status;
      expect(last).toBe(429);
    });
  });

  it('counts parallel guesses: they cannot all slip in before the first answer', async () => {
    await withServer({}, async (_s, u) => {
      await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const answers = await Promise.all(Array.from({ length: 24 }, (_, i) => postJson(u, '/api/rpc/unlock', JSON.stringify([`parallel wrong ${i}`])).then(r => r.status)));
      expect(answers.filter(x => x === 401).length).toBeLessThanOrEqual(8);
      expect(answers.filter(x => x === 429).length).toBeGreaterThanOrEqual(16);
    });
  });

  it('behind a proxy only the hop the proxy appended counts, so a forged first entry buys nothing', async () => {
    await withServer({ trustProxy: true }, async (_s, u) => {
      await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      let last = 0;
      for (let i = 0; i < 12; i++) {
        last = (await postJson(u, '/api/rpc/unlock', JSON.stringify([`wrong ${i}`]), { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.9`, 'x-forwarded-proto': 'https' })).status;
      }
      expect(last).toBe(429);
    });
  });
});

describe('request limits and addressing', () => {
  it('does not read a large body for someone who is not signed in', async () => {
    await withServer({}, async (_s, u) => {
      const big = JSON.stringify(['x'.repeat(200_000)]); // over the 64 KB allowed before a session exists
      expect((await postJson(u, '/api/rpc/listItems', big)).status).toBe(401);
      const signIn = await postJson(u, '/api/rpc/unlock', big);
      expect(signIn.status).toBe(413);
      expect((await signIn.json()).error).toMatch(/too large/i);
    });
  });

  it('is not fooled by a Host header: a request for another name is plain HTTP from elsewhere', async () => {
    await withServer({}, async (s) => {
      expect((await rawGet(s.port, `localhost:${s.port}`)).status).toBe(200);
      const other = await rawGet(s.port, 'notes.example.com');
      expect(other.status).toBe(400);
      expect(other.text).toMatch(/HTTPS/);
    });
  });

  it('keeps folder storage inside the data directory', async () => {
    await withServer({}, async (_s, u, d) => {
      const created = await postJson(u, '/api/rpc/createVault', JSON.stringify([PASSWORD]));
      const cookie = created.headers.get('set-cookie')!.split(';')[0];
      const outside = await postJson(u, '/api/rpc/setStore', JSON.stringify([{ type: 'folder', path: '/etc' }]), { cookie });
      expect(outside.status).toBe(400);
      expect((await outside.json()).error).toMatch(/has to be inside/);
      const inside = await postJson(u, '/api/rpc/setStore', JSON.stringify([{ type: 'folder', path: join(d, 'stores', 'a') }]), { cookie });
      expect(inside.status).toBe(200);
    });
  });
});
