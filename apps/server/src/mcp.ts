// The HTTP side of the MCP (Model Context Protocol) endpoint so AI agents can search, read and write notes: API tokens.
// Transport: JSON-RPC 2.0 over HTTP POST (the "streamable HTTP" transport without server push).
// Auth: `Authorization: Bearer <token>` with tokens created in Settings -> AI & agents.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TokenRecord { id: string; name: string; hash: string; created: string; lastUsed: string | null }

export class TokenStore {
  private file: string;
  private tokens: TokenRecord[] | null = null;
  constructor(file: string) { this.file = file; }

  private lastSaved = 0;
  private async load(): Promise<TokenRecord[]> {
    if (this.tokens) return this.tokens;
    try { this.tokens = JSON.parse(await readFile(this.file, 'utf8')) as TokenRecord[]; } catch { this.tokens = []; }
    return this.tokens;
  }
  private async save() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.tokens ?? [], null, 2), { mode: 0o600 });
  }
  async list(): Promise<Omit<TokenRecord, 'hash'>[]> {
    return (await this.load()).map(({ hash: _h, ...t }) => t);
  }
  async create(name: string): Promise<{ id: string; token: string }> {
    const list = await this.load();
    const token = 'ergo_' + randomBytes(24).toString('base64url');
    const rec: TokenRecord = { id: randomBytes(6).toString('hex'), name: name.trim() || 'Agent', hash: hash(token), created: new Date().toISOString(), lastUsed: null };
    list.push(rec);
    await this.save();
    return { id: rec.id, token };
  }
  async revoke(id: string): Promise<void> {
    this.tokens = (await this.load()).filter(t => t.id !== id);
    await this.save();
  }
  async check(token: string): Promise<boolean> {
    const h = hash(token);
    const rec = (await this.load()).find(t => t.hash === h);
    if (!rec) return false;
    const now = Date.now();
    rec.lastUsed = new Date(now).toISOString();
    if (now - this.lastSaved > 60_000) { this.lastSaved = now; await this.save().catch(() => undefined); }
    return true;
  }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

// The protocol itself (tools, resources, prompts) lives in the core so the desktop app serves exactly the same.
export { handleRpc } from '@ergonotes/core';
