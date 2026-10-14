// A small MCP (Model Context Protocol) endpoint so AI agents can search, read and write notes.
// Transport: JSON-RPC 2.0 over HTTP POST (the "streamable HTTP" transport without server push).
// Auth: `Authorization: Bearer <token>` with tokens created in Settings -> AI & agents.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Vault } from '@ergonotes/core';

export interface TokenRecord { id: string; name: string; hash: string; created: string; lastUsed: string | null }

export class TokenStore {
  private file: string;
  private tokens: TokenRecord[] | null = null;
  constructor(file: string) { this.file = file; }

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
    rec.lastUsed = new Date().toISOString();
    return true;
  }
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

type Json = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: Json; run(args: Json): Promise<unknown> }

const str = { type: 'string' };
const obj = (properties: Json, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

function tools(vault: Vault): Tool[] {
  const text = (o: unknown) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
  const brief = (i: { id: string; title: string; snippet: string; tags: string[]; updated: string; parent: string | null }) =>
    ({ id: i.id, title: i.title, snippet: i.snippet, tags: i.tags, updated: i.updated, folder: i.parent });
  return [
    {
      name: 'search_notes', description: 'Full-text search over note titles, text and tags.',
      inputSchema: obj({ query: str }, ['query']),
      run: async a => text((await vault.search(String(a.query))).map(brief)),
    },
    {
      name: 'list_recent', description: 'The most recently changed notes.',
      inputSchema: obj({ limit: { type: 'number' } }),
      run: async a => text((await vault.listItems()).filter(i => i.type === 'note' && !i.inTrash && !i.template)
        .sort((x, y) => y.updated.localeCompare(x.updated)).slice(0, Math.min(Number(a.limit ?? 10), 50)).map(brief)),
    },
    {
      name: 'read_note', description: 'Read one note as Markdown, with its folder path, tags and links.',
      inputSchema: obj({ id: str }, ['id']),
      run: async a => {
        const n = await vault.getNote(String(a.id));
        if (!n) throw new Error('Note not found');
        return text({ id: n.id, title: n.title, folder: n.path.map(p => p.title).join(' / '), tags: n.tags, updated: n.updated, body: n.body, backlinks: n.backlinks });
      },
    },
    {
      name: 'create_note', description: 'Create a note (in the Inbox unless a folder id is given).',
      inputSchema: obj({ title: str, body: str, folder: str, tags: { type: 'array', items: str } }, ['title']),
      run: async a => {
        const n = await vault.createNote({ title: String(a.title), body: String(a.body ?? ''), parent: a.folder ? String(a.folder) : undefined, tags: Array.isArray(a.tags) ? a.tags.map(String) : undefined });
        return text({ id: n.id, title: n.title });
      },
    },
    {
      name: 'append_to_note', description: 'Append Markdown to the end of an existing note.',
      inputSchema: obj({ id: str, text: str }, ['id', 'text']),
      run: async a => {
        const n = await vault.getNote(String(a.id));
        if (!n) throw new Error('Note not found');
        await vault.saveNote(n.id, { body: `${n.body.replace(/\s+$/, '')}\n\n${String(a.text)}\n` });
        return text('Appended.');
      },
    },
    {
      name: 'update_note', description: 'Replace the title and/or the whole Markdown body of a note.',
      inputSchema: obj({ id: str, title: str, body: str }, ['id']),
      run: async a => {
        await vault.saveNote(String(a.id), { title: a.title === undefined ? undefined : String(a.title), body: a.body === undefined ? undefined : String(a.body) });
        return text('Updated.');
      },
    },
    {
      name: 'list_folders', description: 'All folders with their ids and parents.',
      inputSchema: obj({}),
      run: async () => text((await vault.listItems()).filter(i => i.type === 'folder' && !i.inTrash).map(f => ({ id: f.id, title: f.title, parent: f.parent, notes: f.childCount }))),
    },
    {
      name: 'list_tasks', description: 'Checklist items across all notes, with due dates.',
      inputSchema: obj({ includeDone: { type: 'boolean' } }),
      run: async a => text((await vault.tasks()).filter(t => a.includeDone === true || !t.done).map(t => ({ noteId: t.noteId, note: t.noteTitle, index: t.index, text: t.text, done: t.done, due: t.due, remind: t.remind, flag: t.flag }))),
    },
    {
      name: 'complete_task', description: 'Mark a checklist item done (use noteId and index from list_tasks).',
      inputSchema: obj({ noteId: str, index: { type: 'number' } }, ['noteId', 'index']),
      run: async a => { await vault.toggleTask(String(a.noteId), Number(a.index), true); return text('Done.'); },
    },
    {
      name: 'daily_note', description: "Open (creating if needed) the daily note for a date (YYYY-MM-DD).",
      inputSchema: obj({ date: str }, ['date']),
      run: async a => { const d = await vault.dailyNote(String(a.date)); return text({ id: d.id, title: d.title }); },
    },
  ];
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
      try { return reply(await tool.run((params.arguments ?? {}) as Json)); }
      catch (e) { return reply({ isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] }); }
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}
