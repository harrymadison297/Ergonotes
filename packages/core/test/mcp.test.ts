import { beforeAll, describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { Vault } from '../src/vault.ts';
import { ERGONOTES_GUIDE, handleRpc, MCP_PROTOCOL_VERSIONS } from '../src/index.ts';

const KDF = { m: 256, t: 1, p: 1 };
let vault: Vault;
let seq = 0;
const rpc = async (method: string, params?: unknown) => {
  const r = await handleRpc(vault, { jsonrpc: '2.0', id: ++seq, method, params: params as Record<string, unknown> });
  return r as { result?: Record<string, any>; error?: { code: number; message: string; data?: unknown } };
};
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await rpc('tools/call', { name, arguments: args })).result!;
  return { error: r.isError === true, text: r.content[0].text as string, structured: r.structuredContent as Record<string, any> | undefined };
};

beforeAll(async () => {
  vault = await Vault.open({ persist: new MemPersist(), kdf: KDF, defaultDeviceName: 'Test' });
  await vault.createVault('correct horse battery staple');
});

describe('MCP protocol', () => {
  it('answers notifications with nothing and replies from the client are ignored', async () => {
    expect(await handleRpc(vault, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await handleRpc(vault, { jsonrpc: '2.0', id: 9, result: {} })).toBeNull();
    expect((await handleRpc(vault, { jsonrpc: '2.0', id: 9 }) as any).error.code).toBe(-32600);
  });

  it('negotiates the protocol version and describes the server', async () => {
    for (const v of MCP_PROTOCOL_VERSIONS) expect((await rpc('initialize', { protocolVersion: v })).result!.protocolVersion).toBe(v);
    const odd = (await rpc('initialize', { protocolVersion: '1999-01-01' })).result!;
    expect(odd.protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0]);
    expect(odd.serverInfo).toMatchObject({ name: 'ergonotes', title: 'Ergonotes' });
    expect(odd.capabilities).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    expect(odd.instructions).toContain('Read before you write');
    expect((await rpc('nope')).error!.code).toBe(-32601);
  });

  it('hints which tools only read and which may destroy', async () => {
    const tools = (await rpc('tools/list')).result!.tools as { name: string; title: string; annotations: Record<string, unknown>; inputSchema: unknown }[];
    const by = (n: string) => tools.find(t => t.name === n)!;
    expect(tools.every(t => t.title && t.inputSchema && t.annotations.openWorldHint === false)).toBe(true);
    for (const n of ['search_notes', 'read_note', 'list_tags', 'get_links', 'list_tasks']) expect(by(n).annotations.readOnlyHint).toBe(true);
    expect(by('read_note').annotations.destructiveHint).toBeUndefined();
    expect(by('append_to_note').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(by('update_note').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(tools.map(t => t.name)).not.toContain('delete_note');
  });

  it('returns structured content next to the text, and tells the model what it got wrong', async () => {
    const made = await call('create_note', { title: 'Structured', body: 'x' });
    expect(made.structured).toMatchObject({ title: 'Structured' });
    const list = await call('list_recent');
    expect(Array.isArray(list.structured!.items)).toBe(true);
    expect(JSON.parse(list.text)).toEqual(list.structured!.items);
    expect(await call('read_note', {})).toMatchObject({ error: true });
    expect(await call('search_notes', { query: 5 })).toMatchObject({ error: true, text: 'Argument "query" must be a string.' });
    expect((await call('add_tags', { id: 'x' })).text).toBe('Missing argument "tags".');
    expect((await call('list_tags', { surprise: 1 })).text).toContain('Unknown argument "surprise"');
    expect((await rpc('tools/call', { name: 'delete_note', arguments: {} })).error!.code).toBe(-32602);
  });
});

describe('MCP tools for writing well', () => {
  it('lists tags without counting private notes, and filters search', async () => {
    const a = JSON.parse((await call('create_note', { title: 'Acme kickoff', body: 'Kickoff with the Acme team', tags: ['work/acme'] })).text);
    const b = JSON.parse((await call('create_note', { title: 'Acme invoice', body: 'Invoice for Acme', tags: ['work/acme', 'money'] })).text);
    const hush = await vault.createNote({ title: 'Acme secrets', body: 'Acme secret plans', tags: ['secret-tag'] });
    await vault.setPrivate(hush.id, true);

    const tags = JSON.parse((await call('list_tags')).text) as { tag: string; notes: number }[];
    expect(tags.find(t => t.tag === 'work/acme')?.notes).toBe(2);
    expect(tags.map(t => t.tag)).not.toContain('secret-tag');

    const ids = (r: { text: string }) => (JSON.parse(r.text) as { id: string }[]).map(x => x.id);
    expect(ids(await call('search_notes', { query: 'acme' }))).not.toContain(hush.id);
    expect(ids(await call('search_notes', { query: 'acme', tag: 'money' }))).toEqual([b.id]);
    expect(ids(await call('search_notes', { query: 'acme', tag: '#work' })).sort()).toEqual([a.id, b.id].sort());
    expect(ids(await call('search_notes', { tag: 'work/acme', limit: 1 }))).toHaveLength(1);
    expect(ids(await call('search_notes', { query: 'acme', since: '2999-01-01' }))).toEqual([]);
    expect((await call('search_notes', {})).error).toBe(true);
  });

  it('filters by folder including its subfolders', async () => {
    const proj = await vault.createFolder({ title: 'Projects' });
    const sub = await vault.createFolder({ title: 'Launch', parent: proj.id });
    const inSub = await vault.createNote({ title: 'Launch plan', body: 'quarterly roadmap', parent: sub.id });
    await vault.createNote({ title: 'Elsewhere', body: 'quarterly roadmap' });
    const ids = (JSON.parse((await call('search_notes', { query: 'roadmap', folder: proj.id })).text) as { id: string }[]).map(x => x.id);
    expect(ids).toEqual([inSub.id]);
  });

  it('reads one section, and hides private notes from backlinks and get_links', async () => {
    const note = JSON.parse((await call('create_note', { title: 'Sections', body: '# One\nfirst\n\n## Two\nsecond\n\n# Three\nthird' })).text);
    const sec = JSON.parse((await call('read_note', { id: note.id, heading: 'Two' })).text);
    expect(sec.section).toBe('Two');
    expect(sec.body).toContain('second');
    expect(sec.body).not.toContain('first');
    expect(sec.body).not.toContain('third');
    const missing = await call('read_note', { id: note.id, heading: 'Nope' });
    expect(missing).toMatchObject({ error: true });
    expect(missing.text).toContain('One | Two | Three');

    const target = await vault.createNote({ title: 'Target', body: 'hello' });
    const open = await vault.createNote({ title: 'Open linker', body: 'See [Target](Target.md)' });
    const secret = await vault.createNote({ title: 'Secret linker', body: 'Also [Target](Target.md)' });
    await vault.setPrivate(secret.id, true);
    const links = JSON.parse((await call('get_links', { id: target.id })).text);
    expect(links.backlinks.map((l: { id: string }) => l.id)).toEqual([open.id]);
    expect(JSON.parse((await call('read_note', { id: target.id })).text).backlinks.map((l: { id: string }) => l.id)).toEqual([open.id]);
    expect(JSON.stringify(links)).not.toContain('Secret linker');
    expect((await call('get_links', { id: secret.id })).text).toBe('Note not found');
  });

  it('does not let a folder listing reveal private notes', async () => {
    const f = await vault.createFolder({ title: 'Counted' });
    await vault.createNote({ title: 'Seen', body: 'x', parent: f.id });
    const hush = await vault.createNote({ title: 'Unseen', body: 'x', parent: f.id });
    await vault.setPrivate(hush.id, true);
    const folders = JSON.parse((await call('list_folders')).text) as { id: string; notes: number }[];
    expect(folders.find(x => x.id === f.id)?.notes).toBe(1);
  });

  it('warns when a note with the same title already exists', async () => {
    await call('create_note', { title: 'Weekly review' });
    const again = JSON.parse((await call('create_note', { title: 'weekly review' })).text);
    expect(again.warning).toContain('already exists');
    expect(JSON.parse((await call('create_note', { title: 'A brand new title' })).text).warning).toBeUndefined();
  });
});

describe('MCP resources and prompts', () => {
  it('serves the guide and notes as resources, never a private one', async () => {
    const list = (await rpc('resources/list')).result!.resources as { uri: string }[];
    expect(list.map(r => r.uri)).toContain('ergonotes://guide');
    expect((await rpc('resources/templates/list')).result!.resourceTemplates[0].uriTemplate).toBe('ergonotes://note/{id}');
    expect((await rpc('resources/read', { uri: 'ergonotes://guide' })).result!.contents[0].text).toBe(ERGONOTES_GUIDE);

    const n = await vault.createNote({ title: 'Readable', body: 'plain **text**' });
    const read = (await rpc('resources/read', { uri: `ergonotes://note/${n.id}` })).result!.contents[0];
    expect(read).toMatchObject({ mimeType: 'text/markdown', text: expect.stringContaining('plain **text**') });

    const p = await vault.createNote({ title: 'Hidden', body: 'nope' });
    await vault.setPrivate(p.id, true);
    expect((await rpc('resources/read', { uri: `ergonotes://note/${p.id}` })).error).toMatchObject({ code: -32002 });
    expect((await rpc('resources/read', { uri: 'ergonotes://elsewhere' })).error).toMatchObject({ code: -32002 });
  });

  it('offers prompts that tell the model to follow the conventions', async () => {
    const prompts = (await rpc('prompts/list')).result!.prompts as { name: string; arguments: { name: string; required: boolean }[] }[];
    expect(prompts.map(p => p.name)).toEqual(expect.arrayContaining(['write_note', 'capture', 'daily_plan', 'triage_inbox', 'ask_notes', 'meeting_minutes']));
    const got = (await rpc('prompts/get', { name: 'write_note', arguments: { topic: 'Zettelkasten' } })).result!;
    expect(got.messages[0]).toMatchObject({ role: 'user', content: { type: 'text', text: expect.stringContaining('Zettelkasten') } });
    expect(got.messages[0].content.text).toContain('ergonotes://guide');
    expect((await rpc('prompts/get', { name: 'write_note', arguments: {} })).error!.code).toBe(-32602);
    expect((await rpc('prompts/get', { name: 'nope' })).error!.code).toBe(-32602);
  });
});

describe('MCP with a locked vault', () => {
  it('refuses tools and note resources but still answers the protocol', async () => {
    await vault.lock();
    expect(await call('list_recent')).toMatchObject({ error: true, text: expect.stringContaining('locked') });
    expect((await rpc('resources/read', { uri: 'ergonotes://note/x' })).error!.code).toBe(-32002);
    expect((await rpc('tools/list')).result!.tools.length).toBeGreaterThan(10);
    expect((await rpc('resources/read', { uri: 'ergonotes://guide' })).result).toBeDefined();
  });
});
