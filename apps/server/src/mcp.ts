// A small MCP (Model Context Protocol) endpoint so AI agents can search, read and write notes.
// Transport: JSON-RPC 2.0 over HTTP POST (the "streamable HTTP" transport without server push).
// Auth: `Authorization: Bearer <token>` with tokens created in Settings -> AI & agents.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildTools, type Vault } from '@ergonotes/core';

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

type Json = Record<string, unknown>;

/** The same note tools the in-app chat uses; private notes are invisible to MCP agents too. */
function tools(vault: Vault) {
  return buildTools({ vault, scope: { kind: 'vault' } }).map(t => ({ name: t.spec.name, description: t.spec.description, inputSchema: t.spec.parameters, run: t.run }));
}

/** Handle one JSON-RPC message. Returns the response object, or null for notifications. */
export async function handleRpc(vault: Vault, msg: Json): Promise<Json | null> {
  const id = msg.id as string | number | undefined;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const method = String(msg.method ?? '');
  if (id === undefined) return null; // notification
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ergonotes', version: '0.1.0' },
        instructions: 'Ergonotes notes. Notes are Markdown. Use search_notes/read_note before writing; new captures go to the Inbox.',
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: tools(vault).map(({ run: _r, ...t }) => t) });
    case 'tools/call': {
      const params = (msg.params ?? {}) as Json;
      const tool = tools(vault).find(t => t.name === params.name);
      if (!tool) return fail(-32602, `Unknown tool ${String(params.name)}`);
      if ((await vault.status()).state !== 'ready') return reply({ isError: true, content: [{ type: 'text', text: 'The vault is locked. Sign in to the server once to unlock it.' }] });
      try { return reply({ content: [{ type: 'text', text: await tool.run((params.arguments ?? {}) as Json) }] }); }
      catch (e) { return reply({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }); }
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}
