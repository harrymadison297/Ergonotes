// Minimal S3-compatible Store (AWS S3, Cloudflare R2, Backblaze B2, MinIO...). SigV4 with @noble/hashes so it
// runs in Node, browsers and Android WebView alike. `fetchImpl` lets a shell inject a CORS-free fetch.
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { Store, StoredKey } from './store.ts';

export interface S3Config {
  type: 's3';
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** optional key prefix so several vaults can share a bucket */
  prefix?: string;
}

const encSeg = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (key: string) => key.split('/').map(encSeg).join('/');
const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Store implements Store {
  private cfg: S3Config;
  private f: typeof fetch;
  constructor(cfg: S3Config, fetchImpl?: typeof fetch) {
    this.cfg = cfg;
    this.f = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  }

  private k(key: string) { return (this.cfg.prefix ?? '') + key; }

  private async send(method: string, key: string, query: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const url = new URL(this.cfg.endpoint.replace(/\/+$/, ''));
    const basePath = url.pathname.replace(/\/+$/, '');
    const path = `${basePath}/${encSeg(this.cfg.bucket)}${key ? '/' + encPath(key) : ''}`;
    const q = Object.keys(query).sort().map(n => `${encSeg(n)}=${encSeg(query[n])}`).join('&');
    const payload = body ?? new Uint8Array(0);
    const payloadHash = bytesToHex(sha256(payload));
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const signedNames = Object.keys(headers).sort();
    const canonical = [
      method, path, q,
      signedNames.map(n => `${n}:${headers[n]}\n`).join(''),
      signedNames.join(';'),
      payloadHash,
    ].join('\n');
    const scope = `${date}/${this.cfg.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, bytesToHex(sha256(utf8ToBytes(canonical)))].join('\n');
    let k: Uint8Array = hmac(sha256, utf8ToBytes('AWS4' + this.cfg.secretAccessKey), utf8ToBytes(date));
    for (const part of [this.cfg.region, 's3', 'aws4_request']) k = hmac(sha256, k, utf8ToBytes(part));
    const sig = bytesToHex(hmac(sha256, k, utf8ToBytes(toSign)));
    const auth = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedNames.join(';')}, Signature=${sig}`;
    const { host: _host, ...sendHeaders } = headers;
    return this.f(`${url.origin}${path}${q ? '?' + q : ''}`, {
      method,
      headers: { ...sendHeaders, authorization: auth },
      body: body as BodyInit | undefined,
    });
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const r = await this.send('PUT', this.k(key), {}, data);
    if (!r.ok) throw new Error(`S3 PUT ${key}: ${r.status} ${await r.text().catch(() => '')}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const r = await this.send('GET', this.k(key));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`S3 GET ${key}: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const r = await this.send('DELETE', this.k(key));
    if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${key}: ${r.status}`);
  }

  async list(prefix: string, startAfter = ''): Promise<StoredKey[]> {
    const out: StoredKey[] = [];
    let token = '';
    const strip = (k: string) => (this.cfg.prefix ? k.slice(this.cfg.prefix.length) : k);
    do {
      const q: Record<string, string> = { 'list-type': '2', prefix: this.k(prefix), 'max-keys': '1000' };
      if (startAfter) q['start-after'] = this.k(startAfter);
      if (token) q['continuation-token'] = token;
      const r = await this.send('GET', '', q);
      if (!r.ok) throw new Error(`S3 LIST ${prefix}: ${r.status}`);
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
        const lm = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1])?.[1];
        if (key) out.push({ key: strip(xmlDecode(key)), lastModified: lm ? Date.parse(lm) : 0 });
      }
      token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '';
      if (token) token = xmlDecode(token);
    } while (token);
    return out;
  }

  /** Create the bucket if it does not exist (used by the server's first-run setup against MinIO). */
  async ensureBucket(): Promise<void> {
    const r = await this.send('PUT', '');
    if (!r.ok && r.status !== 409) throw new Error(`S3 create bucket: ${r.status}`);
  }
}
