// Server peer: a headless Device that serves the web UI and exposes the Vault API over HTTP RPC.
// It never holds plaintext at rest beyond the replica files (the Store stays encrypted) and unlocks on login.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { listModels, streamChat, transcribeAudio, Vault, VAULT_METHODS, type AiRequest, type StoreConfig, type VaultStatus } from '@ergonotes/core';
import { FilePersist, FolderStore } from '@ergonotes/core/node';
import { Mirror } from './mirror.ts';
import { handleRpc, TokenStore } from './mcp.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  dataDir: string;
  webDir?: string;
  /** unlock automatically at start (needed for unattended restarts; weakens at-rest protection) */
  autoUnlockPassword?: string;
  /** allow plain HTTP from non-local hosts (behind a TLS-terminating proxy this is not needed) */
  allowInsecure?: boolean;
  /** believe X-Forwarded-For / X-Forwarded-Proto (only behind a reverse proxy you control) */
  trustProxy?: boolean;
  /** when set, the first-run setup call must present this token (stops a stranger claiming a public server) */
  setupToken?: string;
  kdf?: { m: number; t: number; p: number };
  mirrorDir?: string | null;
  /** folder storage chosen from the web UI must live inside this directory (default: the data directory) */
  folderStoreRoot?: string;
  /** how the AI proxy reaches the provider (tests pass a fake) */
  aiFetch?: typeof fetch;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const SESSION_MS = 30 * 24 * 3600e3;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8; // failed sign-ins per address and window

export interface RunningServer {
  server: Server;
  port: number;
  vault: Vault;
  close(): Promise<void>;
}

export async function startServer(o: ServerOptions): Promise<RunningServer> {
  const log = o.log ?? (() => {});
  await mkdir(o.dataDir, { recursive: true });
  const vault = await Vault.open({
    persist: new FilePersist(join(o.dataDir, 'replica')),
    kdf: o.kdf,
    defaultDeviceName: 'Server',
    storeFactory: (cfg: StoreConfig) => {
      if (cfg.type !== 'folder') throw new Error('unsupported');
      // a signed-in browser must not be able to point the server at any directory it can reach
      const root = resolve(o.folderStoreRoot ?? o.dataDir);
      const want = resolve(cfg.path);
      if (want !== root && !want.startsWith(root + sep)) {
        throw new Error(`Folder storage has to be inside ${root} (the server's ERGONOTES_FOLDER_STORE_ROOT setting allows another place).`);
      }
      return new FolderStore(want);
    },
  });
  const tokens = new TokenStore(join(o.dataDir, 'api-tokens.json'));
  const mirror = o.mirrorDir === null ? null : new Mirror(vault, o.mirrorDir ?? join(o.dataDir, 'markdown'));
  const sessions = new Map<string, number>();
  const attempts = new Map<string, number[]>();
  const sse = new Set<ServerResponse>();

  const startWork = () => {
    vault.startAutoSync();
    mirror?.start();
  };
  vault.onEvent(e => { for (const r of sse) r.write(`data: ${JSON.stringify(e)}\n\n`); });

  if (o.autoUnlockPassword && (await vault.status()).state === 'locked') {
    try { await vault.unlock(o.autoUnlockPassword); startWork(); log('vault unlocked from environment'); } catch (e) { log(`auto-unlock failed: ${e}`); }
  } else if ((await vault.status()).state === 'ready') startWork();

  const cookieOf = (req: IncomingMessage) => /(?:^|;\s*)ergo_session=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
  const authed = (req: IncomingMessage) => {
    const t = cookieOf(req);
    const exp = t ? sessions.get(t) : undefined;
    if (!t || !exp || exp < Date.now()) return false;
    sessions.set(t, Date.now() + SESSION_MS);
    return true;
  };
  // behind one reverse proxy we control, the address it saw is the LAST entry it appended; earlier ones are client-supplied
  const clientIp = (req: IncomingMessage) =>
    (o.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').map(s => s.trim()).filter(Boolean).at(-1)) || req.socket.remoteAddress || '?';
  // "localhost" means the connection itself comes from this machine; the Host header alone proves nothing
  const isLocalHost = (req: IncomingMessage) => {
    const peer = req.socket.remoteAddress ?? '';
    const loopback = peer === '::1' || peer === '127.0.0.1' || peer.startsWith('::ffff:127.');
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    const named = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return loopback && named && !req.headers['x-forwarded-for'] && !req.headers.forwarded;
  };
  const sameOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; } // "null" and malformed origins are refused
  };
  const viaTls = (req: IncomingMessage) =>
    !!(req.socket as unknown as { encrypted?: boolean }).encrypted || (o.trustProxy === true && req.headers['x-forwarded-proto'] === 'https');
  const isSecure = (req: IncomingMessage) => o.allowInsecure === true || isLocalHost(req) || viaTls(req);
  const secureCookie = (req: IncomingMessage) => (viaTls(req) ? '; Secure' : '');

  const json = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
    const s = JSON.stringify(body ?? null);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(s);
  };
  const readBody = (req: IncomingMessage, limit = 64 * 1024 * 1024) => new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    let over = false;
    // past the limit nothing more is kept; the caller answers 413 and the connection is closed after that answer
    req.on('data', (c: Buffer) => { n += c.length; if (over) return; if (n > limit) { over = true; chunks.length = 0; reject(new Error('Body too large')); } else chunks.push(c); });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
  // only failures count, so a signed-in owner is never locked out by someone else's guesses on a shared address
  const failures = (req: IncomingMessage) => (attempts.get(clientIp(req)) ?? []).filter(t => Date.now() - t < RATE_WINDOW_MS);
  const rateLimited = (req: IncomingMessage) => failures(req).length >= RATE_MAX;
  /** Take an attempt slot BEFORE the slow password check, so parallel guesses cannot all slip in; success gives it back. */
  const reserveAttempt = (req: IncomingMessage) => {
    const t = Date.now() + Math.random() / 1000;
    attempts.set(clientIp(req), [...failures(req), t]);
    return () => attempts.set(clientIp(req), failures(req).filter(x => x !== t));
  };
  const recordFailure = (req: IncomingMessage) => attempts.set(clientIp(req), [...failures(req), Date.now()]);
  const statusFor = async (req: IncomingMessage): Promise<VaultStatus> => {
    const st = await vault.status();
    const ok = authed(req);
    // before sign-in only what the sign-in screen needs: no storage label, no sync errors
    return ok
      ? { ...st, remote: true, authenticated: true }
      : { ...st, remote: true, authenticated: false, store: null, lastSyncError: null, lastSyncAt: null, pending: 0, conflicts: 0, deviceName: 'Ergonotes' };
  };

  const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await statusFor(req));
    if (req.method === 'GET' && url.pathname === '/api/events') {
      if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      sse.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { clearInterval(ping); sse.delete(res); });
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'JSON only' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });

    if (url.pathname === '/api/logout') {
      const t = cookieOf(req);
      if (t) sessions.delete(t);
      return json(res, 200, { ok: true }, { 'set-cookie': `ergo_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` });
    }

    const m = /^\/api\/rpc\/([A-Za-z]+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'Not found' });
    const method = m[1] as (typeof VAULT_METHODS)[number];
    if (!(VAULT_METHODS as readonly string[]).includes(method)) return json(res, 404, { error: 'Unknown method' });
    // before a session exists only sign-in and first-run setup are possible, and their bodies are small:
    // never read a large body for someone who is not signed in
    const preAuth = method === 'status' || method === 'unlock' || method === 'createVault' || method === 'joinVault';
    if (!preAuth && !authed(req)) return json(res, 401, { error: 'Sign in first' });
    let args: unknown[];
    try { args = JSON.parse((await readBody(req, preAuth ? 64 * 1024 : 64 * 1024 * 1024)) || '[]'); if (!Array.isArray(args)) throw new Error('args must be an array'); } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      return json(res, /too large/i.test(msg) ? 413 : 400, { error: msg }, { connection: 'close' });
    }
    const st = await vault.status();

    // sign-in / first-run setup are the only calls allowed without a session
    if (method === 'status') return json(res, 200, await statusFor(req));
    if (method === 'unlock') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      const password = String(args[0] ?? '');
      const giveBack = reserveAttempt(req);
      try {
        if (st.state === 'locked') { await vault.unlock(password, { remember: false }); startWork(); }
        else if (st.state === 'ready') await vault.verifyPassword(password);
        else { giveBack(); return json(res, 409, { error: 'No vault yet' }); }
      } catch (e) {
        return json(res, 401, { error: e instanceof Error ? e.message : 'Wrong password' });
      }
      giveBack();
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      return json(res, 200, true, { 'set-cookie': `ergo_session=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secureCookie(req)}` });
    }
    if ((method === 'createVault' || method === 'joinVault') && st.state === 'no-vault') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      // first-run setup is open to whoever reaches the server first: require the setup token when one is configured
      const opts = (method === 'createVault' ? args[1] : args[2]) as { setupToken?: string; deviceName?: string } | undefined;
      if (o.setupToken && opts?.setupToken !== o.setupToken) {
        recordFailure(req);
        return json(res, 403, { error: 'This server needs its setup token to create the vault.' });
      }
      try {
        const deviceName = typeof opts?.deviceName === 'string' && opts.deviceName ? opts.deviceName : 'Server';
        if (method === 'createVault') await vault.createVault(String(args[0]), { deviceName, remember: false });
        else await vault.joinVault(args[0] as StoreConfig, String(args[1]), { deviceName, remember: false });
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
      startWork();
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      return json(res, 200, true, { 'set-cookie': `ergo_session=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secureCookie(req)}` });
    }
    if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
    if (method === 'lock') {
      const t = cookieOf(req);
      if (t) sessions.delete(t);
      return json(res, 200, true, { 'set-cookie': `ergo_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` });
    }
    try {
      const fn = (vault as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      const out = await fn.apply(vault, args);
      if (method === 'setStore' || method === 'createVault') startWork();
      return json(res, 200, out === undefined ? null : out);
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** The in-app chat and ghost text go through here so the provider key stays on the server. */
  const aiStream = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'JSON only' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
    let body: AiRequest;
    try {
      body = JSON.parse(await readBody(req, 16 * 1024 * 1024)) as AiRequest;
      if (!Array.isArray(body.messages) || (body.model !== 'chat' && body.model !== 'suggest')) throw new Error('Bad request');
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      return json(res, /too large/i.test(msg) ? 413 : 400, { error: msg }, { connection: 'close' });
    }
    if ((await vault.status()).state !== 'ready') return json(res, 409, { error: 'The vault is locked' });
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    const send = (o: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    try {
      for await (const e of streamChat(vault.aiConfig(), body, { signal: ac.signal, fetchImpl: o.aiFetch })) send(e);
    } catch (e) {
      if (!ac.signal.aborted) send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    res.end();
  };

  /** The model names the configured provider offers (the settings page fills its pick-list from this). */
  const aiTranscribe = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
    if ((await vault.status()).state !== 'ready') return json(res, 409, { error: 'The vault is locked' });
    let file: { name?: string; mime?: string; data?: string };
    try { file = JSON.parse((await readBody(req, 40 * 1024 * 1024)) || '{}') as typeof file; } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json(res, /too large/i.test(msg) ? 413 : 400, { error: /too large/i.test(msg) ? 'That recording is too large.' : 'Bad JSON' }, { connection: 'close' });
    }
    if (typeof file.data !== 'string' || !file.data) return json(res, 400, { error: 'No audio was sent.' });
    try { return json(res, 200, { text: await transcribeAudio(vault.aiConfig(), { name: String(file.name ?? 'audio.webm'), mime: String(file.mime ?? ''), data: file.data }, { fetchImpl: o.aiFetch }) }); }
    catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
  };

  const aiModels = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
    if ((await vault.status()).state !== 'ready') return json(res, 409, { error: 'The vault is locked' });
    let want = '';
    try { want = String((JSON.parse((await readBody(req, 64 * 1024)) || '{}') as { connection?: string }).connection ?? ''); } catch { return json(res, 400, { error: 'Bad JSON' }); }
    const conn = vault.aiConfig().connections.find(c => c.id === want);
    if (!conn) return json(res, 400, { error: 'That connection does not exist.' });
    try { return json(res, 200, { models: await listModels(conn, { fetchImpl: o.aiFetch }) }); }
    catch (e) { return json(res, 400, { error: e instanceof Error ? e.message : String(e) }); }
  };

  const serveStatic = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const root = o.webDir;
    if (!root) { res.writeHead(404); return res.end('No web build configured'); }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const full = normalize(join(root, rel));
    if (full !== root && !full.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    let file = full;
    try { if (!(await stat(file)).isFile()) throw new Error(); } catch { file = join(root, 'index.html'); }
    try {
      const data = await readFile(file);
      const ext = extname(file);
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (!isSecure(req)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end('Ergonotes only serves your notes over HTTPS (or from localhost). Put it behind a TLS proxy such as Caddy, or set ERGONOTES_ALLOW_INSECURE=1 on a trusted network.');
      }
      res.setHeader('x-frame-options', 'DENY');
      res.setHeader('referrer-policy', 'no-referrer');
      if (url.pathname === '/mcp') {
        const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        if (!bearer || !(await tokens.check(bearer))) return json(res, 401, { error: 'A valid API token is required' }, { 'www-authenticate': 'Bearer' });
        if (req.method !== 'POST') return json(res, 405, { error: 'POST JSON-RPC messages to this endpoint' });
        let body: unknown;
        try { body = JSON.parse(await readBody(req, 4 * 1024 * 1024)); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
        const batch = Array.isArray(body);
        const out = (await Promise.all((batch ? (body as unknown[]) : [body]).map(m => handleRpc(vault, m as Record<string, unknown>)))).filter(Boolean);
        if (out.length === 0) { res.writeHead(202); return res.end(); }
        return json(res, 200, batch ? out : out[0]);
      }
      if (url.pathname === '/api/tokens') {
        if (!authed(req)) return json(res, 401, { error: 'Sign in first' });
        if (req.method === 'GET') return json(res, 200, await tokens.list());
        if (req.method === 'POST') {
          if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'JSON only' });
          if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
          let b: { name?: string; revoke?: string };
          try { b = JSON.parse((await readBody(req, 64 * 1024)) || '{}'); } catch { return json(res, 400, { error: 'Bad JSON' }); }
          if (b.revoke) { await tokens.revoke(b.revoke); return json(res, 200, { ok: true }); }
          return json(res, 200, await tokens.create(b.name ?? 'Agent'));
        }
        return json(res, 405, { error: 'Method not allowed' });
      }
      if (url.pathname === '/api/ai/stream') return await aiStream(req, res);
      if (url.pathname === '/api/ai/models') return await aiModels(req, res);
      if (url.pathname === '/api/ai/transcribe') return await aiTranscribe(req, res);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      return await serveStatic(req, res, url);
    } catch (e) {
      log(`request failed: ${e instanceof Error ? e.stack : e}`);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
      else res.end();
    }
  });

  await new Promise<void>(resolve => server.listen(o.port, o.host ?? '0.0.0.0', resolve));
  const port = (server.address() as { port: number }).port;
  log(`Ergonotes server listening on ${o.host ?? '0.0.0.0'}:${port}`);
  return {
    server, port, vault,
    close: async () => {
      for (const r of sse) r.end();
      await new Promise<void>(r => server.close(() => r()));
      await mirror?.stop();
      await vault.close();
    },
  };
}
