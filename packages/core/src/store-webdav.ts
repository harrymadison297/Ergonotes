// Minimal WebDAV Store (Nextcloud, Synology, rclone serve webdav...). Listing is a recursive PROPFIND, so it is
// slower than S3 for very large vaults; `startAfter` is applied client side.
import { toB64 } from './util.ts';
import type { Store, StoredKey } from './store.ts';

export interface WebDavConfig {
  type: 'webdav';
  url: string;
  username?: string;
  password?: string;
  prefix?: string;
}

const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class WebDavStore implements Store {
  private cfg: WebDavConfig;
  private f: typeof fetch;
  private dirs = new Set<string>();
  constructor(cfg: WebDavConfig, fetchImpl?: typeof fetch) {
    this.cfg = { ...cfg, url: cfg.url.replace(/\/+$/, '') };
    this.f = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  private base() { return this.cfg.url + (this.cfg.prefix ? '/' + this.cfg.prefix.replace(/^\/+|\/+$/g, '') : ''); }
  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra };
    if (this.cfg.username) h.authorization = 'Basic ' + toB64(new TextEncoder().encode(`${this.cfg.username}:${this.cfg.password ?? ''}`));
    return h;
  }
  private url(key: string) { return `${this.base()}/${key.split('/').map(encodeURIComponent).join('/')}`; }

  private async mkcols(key: string) {
    const parts = key.split('/').slice(0, -1);
    let cur = '';
    if (this.cfg.prefix) await this.mkcolAbs(this.base());
    for (const p of parts) {
      cur += (cur ? '/' : '') + p;
      if (this.dirs.has(cur)) continue;
      await this.mkcolAbs(this.url(cur));
      this.dirs.add(cur);
    }
  }
  private async mkcolAbs(url: string) {
    const r = await this.f(url, { method: 'MKCOL', headers: this.headers() });
    if (!r.ok && r.status !== 405 && r.status !== 301) throw new Error(`WebDAV MKCOL ${url}: ${r.status}`);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.mkcols(key);
    const r = await this.f(this.url(key), { method: 'PUT', headers: this.headers(), body: data as BodyInit });
    if (!r.ok) throw new Error(`WebDAV PUT ${key}: ${r.status}`);
  }
  async get(key: string): Promise<Uint8Array | null> {
    const r = await this.f(this.url(key), { headers: this.headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`WebDAV GET ${key}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(key: string): Promise<void> {
    const r = await this.f(this.url(key), { method: 'DELETE', headers: this.headers() });
    if (!r.ok && r.status !== 404) throw new Error(`WebDAV DELETE ${key}: ${r.status}`);
  }

  private async propfind(dirKey: string): Promise<{ key: string; dir: boolean; lastModified: number }[]> {
    const url = dirKey ? this.url(dirKey) + '/' : this.base() + '/';
    const r = await this.f(url, { method: 'PROPFIND', headers: this.headers({ Depth: '1' }) });
    if (r.status === 404) return [];
    if (!r.ok && r.status !== 207) throw new Error(`WebDAV PROPFIND ${dirKey}: ${r.status}`);
    const xml = await r.text();
    const out: { key: string; dir: boolean; lastModified: number }[] = [];
    const baseHref = new URL(this.base() + '/').pathname;
    for (const m of xml.matchAll(/<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
      const href = /<(?:\w+:)?href>([\s\S]*?)<\/(?:\w+:)?href>/.exec(m[1])?.[1];
      if (!href) continue;
      let path = decodeURIComponent(xmlDecode(href));
      try { path = decodeURIComponent(new URL(xmlDecode(href), this.base()).pathname); } catch { /* keep */ }
      if (!path.startsWith(baseHref) && !(path + '/').startsWith(baseHref)) continue;
      const rel = path.slice(baseHref.length).replace(/\/+$/, '');
      if (!rel || rel === dirKey) continue;
      const dir = /<(?:\w+:)?collection\s*\/?>/.test(m[1]);
      const lm = /<(?:\w+:)?getlastmodified>([\s\S]*?)<\/(?:\w+:)?getlastmodified>/.exec(m[1])?.[1];
      out.push({ key: rel, dir, lastModified: lm ? Date.parse(lm) : 0 });
    }
    return out;
  }

  async list(prefix: string, startAfter = ''): Promise<StoredKey[]> {
    const out: StoredKey[] = [];
    const walk = async (dir: string) => {
      for (const e of await this.propfind(dir)) {
        if (e.dir) { if (prefix.startsWith(e.key + '/') || e.key.startsWith(prefix) || (e.key + '/').startsWith(prefix)) await walk(e.key); }
        else if (e.key.startsWith(prefix) && e.key > startAfter) out.push({ key: e.key, lastModified: e.lastModified });
      }
    };
    const lastSlash = prefix.lastIndexOf('/');
    await walk(lastSlash > 0 ? prefix.slice(0, lastSlash) : '');
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}
