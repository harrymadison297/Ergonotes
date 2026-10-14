// Server peer: a headless Device that serves the web UI and exposes the Vault API over HTTP RPC.
// It never holds plaintext at rest beyond the replica files (the Store stays encrypted) and unlocks on login.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { Vault, VAULT_METHODS, type StoreConfig, type VaultStatus } from '@ergonotes/core';
import { FilePersist, FolderStore } from '@ergonotes/core/node';
import { Mirror } from './mirror.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  dataDir: string;
  webDir?: string;
  /** unlock automatically at start (needed for unattended restarts; weakens at-rest protection) */
  autoUnlockPassword?: string;
  /** allow plain HTTP from non-local hosts (behind a TLS-terminating proxy this is not needed) */
  allowInsecure?: boolean;
  kdf?: { m: number; t: number; p: number };
  mirrorDir?: string | null;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const SESSION_MS = 30 * 24 * 3600e3;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;

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
      return new FolderStore(cfg.path);
    },
  });
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
  const isLocalHost = (req: IncomingMessage) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  };
  const isSecure = (req: IncomingMessage) =>
    o.allowInsecure === true || isLocalHost(req) || req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as unknown as { encrypted?: boolean }).encrypted;
  const secureCookie = (req: IncomingMessage) => (req.headers['x-forwarded-proto'] === 'https' || (req.socket as unknown as { encrypted?: boolean }).encrypted ? '; Secure' : '');

  const json = (res: ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
    const s = JSON.stringify(body ?? null);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
    res.end(s);
  };
  const readBody = (req: IncomingMessage, limit = 64 * 1024 * 1024) => new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const rateLimited = (req: IncomingMessage) => {
    const ip = req.socket.remoteAddress ?? '?';
    const now = Date.now();
    const list = (attempts.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
    list.push(now);
    attempts.set(ip, list);
    return list.length > RATE_MAX;
  };
  const statusFor = async (req: IncomingMessage): Promise<VaultStatus> => {
    const st = await vault.status();
    return { ...st, remote: true, authenticated: authed(req) };
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
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin request refused' });

    if (url.pathname === '/api/logout') {
      const t = cookieOf(req);
      if (t) sessions.delete(t);
      return json(res, 200, { ok: true }, { 'set-cookie': `ergo_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` });
    }

    const m = /^\/api\/rpc\/([A-Za-z]+)$/.exec(url.pathname);
    if (!m) return json(res, 404, { error: 'Not found' });
    const method = m[1] as (typeof VAULT_METHODS)[number];
    if (!(VAULT_METHODS as readonly string[]).includes(method)) return json(res, 404, { error: 'Unknown method' });
    let args: unknown[];
    try { args = JSON.parse((await readBody(req)) || '[]'); if (!Array.isArray(args)) throw new Error('args must be an array'); } catch (e) {
      return json(res, 400, { error: String(e instanceof Error ? e.message : e) });
    }
    const st = await vault.status();

    // sign-in / first-run setup are the only calls allowed without a session
    if (method === 'status') return json(res, 200, await statusFor(req));
    if (method === 'unlock') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      const password = String(args[0] ?? '');
      try {
        if (st.state === 'locked') { await vault.unlock(password, { remember: false }); startWork(); }
        else if (st.state === 'ready') await vault.verifyPassword(password);
        else return json(res, 409, { error: 'No vault yet' });
      } catch (e) {
        return json(res, 401, { error: e instanceof Error ? e.message : 'Wrong password' });
      }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_MS);
      return json(res, 200, true, { 'set-cookie': `ergo_session=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secureCookie(req)}` });
    }
    if ((method === 'createVault' || method === 'joinVault') && st.state === 'no-vault') {
      if (rateLimited(req)) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      try {
        if (method === 'createVault') await vault.createVault(String(args[0]), { deviceName: 'Server', ...(args[1] as object | undefined), remember: false });
        else await vault.joinVault(args[0] as StoreConfig, String(args[1]), { deviceName: 'Server', remember: false });
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
      vault.stopAutoSync();
      mirror?.stop();
      for (const r of sse) r.end();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}
