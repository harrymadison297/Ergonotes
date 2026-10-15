import { describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import type { StoreConfig } from '../src/api.ts';
import {
  DEFAULT_MODELS, PROVIDER_LABEL, ThinkSplitter, apiBase, applyAiPatch, buildTools, listModels, normalizeAiConfig, resolveTarget, toSettings, chatSystemPrompt, cleanSuggestion, completeText, defaultAiConfig, runAgent, sectionRange, streamChat, suggestionRequest,
  type AiConfig, type AiEvent, type AiProvider, type ThinkingLevel, type AiMessage, type AiRequest, type AiTransport, type NoteIO,
} from '../src/index.ts';

const KDF = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const shared = new Map<string, MemStore>();
async function open(name: string) {
  return Vault.open({
    persist: new MemPersist(), kdf: KDF, defaultDeviceName: name,
    storeFactory: cfg => { if (cfg.type !== 'folder') throw new Error('x'); return shared.get(cfg.path)!; },
  });
}
const cfgFor = (id: string): StoreConfig => ({ type: 'folder', path: id });

const sse = (chunks: unknown[]): Response => new Response(
  chunks.map(c => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''),
  { headers: { 'content-type': 'text/event-stream' } },
);
async function collect(it: AsyncIterable<AiEvent>): Promise<AiEvent[]> {
  const out: AiEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
/** One connection of one kind, used as both the chat and the suggestion model: what most tests need. */
interface One { provider?: AiProvider; keys?: Partial<Record<AiProvider, string>>; customUrl?: string; chatModel?: string; suggestModel?: string; chatThinking?: ThinkingLevel; suggestThinking?: ThinkingLevel }
const cfg = (o: One = {}): AiConfig => {
  const provider = o.provider ?? 'openrouter';
  const key = o.keys ? o.keys[provider] : provider === 'anthropic' ? 'sk-ant-test' : provider === 'openrouter' ? 'sk-or-test' : undefined;
  return {
    ...defaultAiConfig(),
    connections: [{ id: 'c1', name: PROVIDER_LABEL[provider], type: provider, ...(key ? { key } : {}), url: provider === 'custom' ? o.customUrl ?? 'http://localhost:11434' : '' }],
    chatModel: { connection: 'c1', model: o.chatModel ?? DEFAULT_MODELS[provider].chat },
    suggestModel: { connection: 'c1', model: o.suggestModel ?? DEFAULT_MODELS[provider].suggest },
    chatThinking: o.chatThinking ?? 'auto', suggestThinking: o.suggestThinking ?? 'off',
  };
};

describe('AI settings in the vault', () => {
  it('keeps keys out of what clients may read, and syncs them to another device', async () => {
    shared.set('ai1', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('ai1'));
    const s = await A.setAiSettings({ connection: { id: 'or', type: 'openrouter', name: 'Work', key: ' sk-or-secret-1234 ' }, chatModel: { connection: 'or', model: 'x/y' }, wholeVault: true });
    expect(s.connections).toEqual([{ id: 'or', name: 'Work', type: 'openrouter', url: '', keyHint: '1234', ready: true }]);
    expect(s).toMatchObject({ chatModel: { connection: 'or', model: 'x/y' }, chatReady: true, suggestReady: true, wholeVault: true, autoApply: false });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(A.aiConfig().connections[0].key).toBe('sk-or-secret-1234');
    await A.sync();

    const B = await open('Phone');
    await B.joinVault(cfgFor('ai1'), PASSWORD);
    expect(await B.getAiSettings()).toMatchObject({ chatReady: true, chatModel: { connection: 'or', model: 'x/y' }, wholeVault: true });
    expect((await B.getAiSettings()).connections[0].keyHint).toBe('1234');
    // the settings item is not a note, and is not a conflict
    expect(await B.conflicts()).toHaveLength(0);
  });

  it('settles two devices saving at once without asking anyone', async () => {
    shared.set('ai2', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('ai2'));
    await A.setAiSettings({ connection: { id: 'c', type: 'custom', url: 'http://h:1' }, chatModel: { connection: 'c', model: 'first' } });
    await A.sync();
    const B = await open('Phone');
    await B.joinVault(cfgFor('ai2'), PASSWORD);
    await A.setAiSettings({ chatModel: { connection: 'c', model: 'from-laptop' } });
    await new Promise(r => setTimeout(r, 5));
    await B.setAiSettings({ chatModel: { connection: 'c', model: 'from-phone' } });
    await A.sync(); await B.sync(); await A.sync(); await B.sync(); await A.sync();
    expect(await A.conflicts()).toHaveLength(0);
    expect(await B.conflicts()).toHaveLength(0);
    const a = (await A.getAiSettings()).chatModel.model, b = (await B.getAiSettings()).chatModel.model;
    expect(a).toBe(b);
    expect(['from-laptop', 'from-phone']).toContain(a);
  });

  it('keeps the suggestion switch and its pause in the vault, within bounds', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    expect(await v.getAiSettings()).toMatchObject({ suggest: false, suggestDelay: 400 });
    expect(await v.setAiSettings({ suggest: true, suggestDelay: 50 })).toMatchObject({ suggest: true, suggestDelay: 150 });
    expect((await v.setAiSettings({ suggestDelay: 99_999 })).suggestDelay).toBe(3000);
    expect((await v.getAiSettings()).suggest).toBe(true);
  });

  it('holds several connections of several kinds, and the two jobs may use different ones', () => {
    let c = applyAiPatch(defaultAiConfig(), { connection: { id: 'a', type: 'anthropic', key: 'secret-one-AAAA' } });
    // the first connection becomes both models, with its own defaults
    expect(c.chatModel).toEqual({ connection: 'a', model: 'claude-sonnet-5-5' });
    expect(c.suggestModel).toEqual({ connection: 'a', model: 'claude-haiku-5-5' });
    c = applyAiPatch(c, { connection: { id: 'o1', type: 'openrouter', name: 'Personal', key: 'secret-two-BBBB' } });
    c = applyAiPatch(c, { connection: { id: 'o2', type: 'openrouter', name: 'Work', key: 'secret-three-CCCC' } });
    c = applyAiPatch(c, { connection: { id: 'l', type: 'custom', name: 'Home Ollama', url: 'http://10.0.0.2:11434' } });
    expect(c.connections.map(x => x.name)).toEqual(['Anthropic', 'Personal', 'Work', 'Home Ollama']);
    // adding connections does not move the models
    expect(c.chatModel.connection).toBe('a');
    c = applyAiPatch(c, { chatModel: { connection: 'o2', model: 'x/y' }, suggestModel: { connection: 'l', model: '' } });
    expect(c.chatModel).toEqual({ connection: 'o2', model: 'x/y' });
    expect(c.suggestModel).toEqual({ connection: 'l', model: 'llama3.2' });
    expect(resolveTarget(c, 'chat')?.conn.key).toBe('secret-three-CCCC');
    expect(resolveTarget(c, 'suggest')?.conn.url).toBe('http://10.0.0.2:11434');
    const s = toSettings(c);
    expect(s.chatReady && s.suggestReady).toBe(true);
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(s.connections.map(x => x.keyHint)).toEqual(['AAAA', 'BBBB', 'CCCC', null]);
  });

  it('forgets a key, renames, refuses a bad address or a changed kind, and moves the models when a connection goes', () => {
    let c = applyAiPatch(defaultAiConfig(), { connection: { id: 'o', type: 'openrouter', key: 'k' } });
    c = applyAiPatch(c, { connection: { id: 'a', type: 'anthropic', key: 'k2' } });
    c = applyAiPatch(c, { connection: { id: 'o', name: ' Mine ', key: null } });
    expect(c.connections[0]).toMatchObject({ name: 'Mine', url: '' });
    expect(c.connections[0].key).toBeUndefined();
    expect(toSettings(c).chatReady).toBe(false);
    expect(() => applyAiPatch(c, { connection: { id: 'o', type: 'anthropic' } })).toThrow(/cannot be changed/);
    expect(() => applyAiPatch(c, { connection: { id: 'n', type: 'custom', url: 'localhost:11434' } })).toThrow(/http/);
    expect(() => applyAiPatch(c, { chatModel: { connection: 'ghost', model: 'm' } })).toThrow(/no longer exists/);
    c = applyAiPatch(c, { removeConnection: 'o' });
    expect(c.chatModel).toEqual({ connection: 'a', model: 'claude-sonnet-5-5' });
    c = applyAiPatch(c, { removeConnection: 'a' });
    expect(c.chatModel).toEqual({ connection: '', model: '' });
    expect(toSettings(c).chatReady).toBe(false);
  });

  it('reads the single-provider settings of the first version as connections', () => {
    const c = normalizeAiConfig({
      provider: 'anthropic', keys: { openrouter: 'or-key', anthropic: 'an-key' }, customUrl: 'http://ollama:11434',
      chatModel: 'claude-x', suggestModel: 'claude-y', chatThinking: 'high', suggest: true, suggestDelay: 600, wholeVault: true,
    });
    expect(c.connections.map(x => [x.id, x.type, x.key ?? null, x.url])).toEqual([
      ['openrouter', 'openrouter', 'or-key', ''], ['anthropic', 'anthropic', 'an-key', ''], ['custom', 'custom', null, 'http://ollama:11434'],
    ]);
    expect(c.chatModel).toEqual({ connection: 'anthropic', model: 'claude-x' });
    expect(c.suggestModel).toEqual({ connection: 'anthropic', model: 'claude-y' });
    expect(c).toMatchObject({ chatThinking: 'high', suggest: true, suggestDelay: 600, wholeVault: true });
    expect(normalizeAiConfig(null)).toEqual(defaultAiConfig());
  });
});

describe('providers', () => {
  it('streams text, tool calls and usage from OpenRouter', async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get('authorization') };
      return sse([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_note', arguments: '{"id":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"n1"}' } }] }, finish_reason: 'tool_calls' }] },
        { usage: { prompt_tokens: 11, completion_tokens: 5 }, choices: [] },
        '[DONE]',
      ]);
    }) as unknown as typeof fetch;
    const req: AiRequest = {
      model: 'chat', system: 'sys', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'search_notes', args: { query: 'x' } }] },
        { role: 'tool', callId: 'a', name: 'search_notes', content: '[]' },
      ],
      tools: [{ name: 'read_note', description: 'd', parameters: { type: 'object', properties: {} } }],
    };
    const ev = await collect(streamChat(cfg(), req, { fetchImpl }));
    expect(ev.filter(e => e.type === 'text').map(e => (e as { delta: string }).delta).join('')).toBe('Hello');
    expect(ev.find(e => e.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'c1', name: 'read_note', args: { id: 'n1' } } });
    expect(ev.find(e => e.type === 'usage')).toEqual({ type: 'usage', input: 11, output: 5 });
    expect(ev.at(-1)).toEqual({ type: 'done' });
    expect(sent!.url).toContain('openrouter.ai');
    expect(sent!.auth).toBe('Bearer sk-or-test');
    expect(sent!.body.model).toBe('google/gemma-4-31b-it:free');
    const msgs = sent!.body.messages as { role: string; tool_call_id?: string; tool_calls?: unknown[] }[];
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(msgs[2].tool_calls).toHaveLength(1);
    expect(msgs[3].tool_call_id).toBe('a');
  });

  it('streams from Anthropic and merges consecutive tool results into one user turn', async () => {
    let body: { messages: { role: string; content: { type: string }[] }[]; system: string; tools: { input_schema: unknown }[] } | null = null;
    let headers: Headers | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string); headers = new Headers(init.headers);
      return sse([
        { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'append_to_note' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"text":' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"hi"}' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
        { type: 'message_stop' },
      ]);
    }) as unknown as typeof fetch;
    const messages: AiMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'a', args: {} }, { id: 't2', name: 'b', args: {} }] },
      { role: 'tool', callId: 't1', name: 'a', content: '1' },
      { role: 'tool', callId: 't2', name: 'b', content: '2' },
    ];
    const ev = await collect(streamChat(cfg({ provider: 'anthropic', chatModel: 'claude-sonnet-5-5' }), {
      model: 'chat', system: 'S', messages, tools: [{ name: 'append_to_note', description: 'd', parameters: { type: 'object' } }],
    }, { fetchImpl }));
    expect(ev.filter(e => e.type === 'text')).toEqual([{ type: 'text', delta: 'Sure' }]);
    expect(ev.find(e => e.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'tu1', name: 'append_to_note', args: { text: 'hi' } } });
    expect(ev.find(e => e.type === 'usage')).toEqual({ type: 'usage', input: 20, output: 9 });
    expect(headers!.get('x-api-key')).toBe('sk-ant-test');
    expect(body!.system).toBe('S');
    expect(body!.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(body!.messages[2].content.map(c => c.type)).toEqual(['tool_result', 'tool_result']);
    expect(body!.tools[0].input_schema).toEqual({ type: 'object' });
  });

  it('reports a rejected key and a missing key in plain words', async () => {
    const reject = (async () => new Response(JSON.stringify({ error: { message: 'No auth credentials found' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(collect(streamChat(cfg(), { model: 'chat', messages: [] }, { fetchImpl: reject }))).rejects.toThrow(/rejected the API key/);
    await expect(collect(streamChat(cfg({ keys: {} }), { model: 'chat', messages: [] }))).rejects.toThrow(/Add an API key to/);
  });
});

describe('agent', () => {
  it('runs tools, feeds results back and stops when the model answers', async () => {
    const seen: AiRequest[] = [];
    const transport: AiTransport = async function* (req) {
      seen.push(structuredClone(req));
      if (seen.length === 1) yield { type: 'tool_call', call: { id: 'c1', name: 'echo', args: { v: 'x' } } } as AiEvent;
      else if (seen.length === 2) yield { type: 'tool_call', call: { id: 'c2', name: 'nope', args: {} } } as AiEvent;
      else yield { type: 'text', delta: 'done' } as AiEvent;
      yield { type: 'done' } as AiEvent;
    };
    const events: string[] = [];
    const added = await runAgent({
      transport, system: 's', history: [{ role: 'user', content: 'hi' }],
      tools: [{ spec: { name: 'echo', description: '', parameters: {} }, run: async a => `got ${String(a.v)}` }],
      onEvent: e => events.push(e.type === 'tool' ? `tool:${e.call.name}:${e.error ? 'err' : 'ok'}:${e.result}` : e.type),
    });
    expect(events).toEqual(['tool:echo:ok:got x', 'tool:nope:err:Error: there is no tool called nope.', 'text']);
    expect(added.map(m => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(seen[2].messages.at(-1)).toMatchObject({ role: 'tool', callId: 'c2' });
  });

  it('stops a model that never stops asking, and when aborted', async () => {
    const forever: AiTransport = async function* () { yield { type: 'tool_call', call: { id: 'x', name: 'echo', args: {} } } as AiEvent; };
    const tools = [{ spec: { name: 'echo', description: '', parameters: {} }, run: async () => 'ok' }];
    const out = await runAgent({ transport: forever, system: '', history: [], tools, maxSteps: 3, onEvent: () => undefined });
    expect(out.at(-1)).toMatchObject({ role: 'assistant', content: expect.stringContaining('Stopped') });
    const ac = new AbortController();
    ac.abort();
    expect(await runAgent({ transport: forever, system: '', history: [], tools, signal: ac.signal, onEvent: () => undefined })).toEqual([]);
  });

  it('puts the open note and the visibility rule in the system prompt', () => {
    const p = chatSystemPrompt({ note: { id: 'n1', title: 'Plan', body: 'Body text' }, wholeVault: false, today: '2026-10-14' });
    expect(p).toContain('id n1');
    expect(p).toContain('Body text');
    expect(p).toContain('only see the note that is open');
    expect(chatSystemPrompt({ note: null, wholeVault: true, today: 'x' })).toContain('except those the user marked private');
  });
});

describe('note tools', () => {
  async function setup() {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const open1 = await v.createNote({ title: 'Open', body: '# Plan\n\nalpha\n\n## Tasks\n\n- [ ] one\n\n## Notes\n\nbeta beta\n' });
    const secret = await v.createNote({ title: 'Secret diary', body: 'hunter2' });
    await v.setPrivate(secret.id, true);
    const other = await v.createNote({ title: 'Other', body: 'about hunter' });
    return { v, open1, secret, other };
  }
  const run = async (tools: ReturnType<typeof buildTools>, name: string, args: Record<string, unknown> = {}) => {
    const t = tools.find(x => x.spec.name === name);
    if (!t) throw new Error(`no tool ${name}`);
    return t.run(args);
  };

  it('never shows a private note, whichever way it is asked for', async () => {
    const { v, secret, other } = await setup();
    const tools = buildTools({ vault: v, scope: { kind: 'vault' } });
    expect(await run(tools, 'search_notes', { query: 'hunter2' })).not.toContain(secret.id);
    expect(await run(tools, 'search_notes', { query: 'diary' })).toBe('[]');
    expect(await run(tools, 'search_notes', { query: 'hunter' })).toContain(other.id);
    expect(await run(tools, 'list_recent', {})).not.toContain(secret.id);
    await expect(run(tools, 'read_note', { id: secret.id })).rejects.toThrow(/not found/);
    await expect(run(tools, 'append_to_note', { id: secret.id, text: 'x' })).rejects.toThrow(/not found/);
    await expect(run(tools, 'update_note', { id: secret.id, body: 'x' })).rejects.toThrow(/not found/);
    await expect(run(tools, 'add_tags', { id: secret.id, tags: ['x'] })).rejects.toThrow(/not found/);
    await expect(run(tools, 'move_note', { id: secret.id })).rejects.toThrow(/not found/);
    expect((await v.getNote(secret.id))!.body).toBe('hunter2');
    await v.saveNote(secret.id, { body: '- [ ] secret task' });
    expect(await run(tools, 'list_tasks', {})).not.toContain('secret task');
    // the owner still sees it in the app
    expect((await v.searchHits('diary')).map(h => h.id)).toContain(secret.id);
  });

  it('limits the chat to the open note unless the whole vault is allowed', async () => {
    const { v, open1, other } = await setup();
    const tools = buildTools({ vault: v, scope: { kind: 'note', noteId: open1.id } });
    expect(tools.map(t => t.spec.name)).not.toContain('search_notes');
    expect(tools.map(t => t.spec.name)).not.toContain('move_note');
    expect(JSON.parse(await run(tools, 'read_note', {})).title).toBe('Open');
    await expect(run(tools, 'read_note', { id: other.id })).rejects.toThrow(/not found/);
    await expect(run(tools, 'append_to_note', { id: other.id, text: 'x' })).rejects.toThrow(/not found/);
    // writing a new document is allowed: it reads nothing
    const made = JSON.parse(await run(tools, 'create_note', { title: 'Draft', body: 'text' }));
    expect((await v.getNote(made.id))!.body).toBe('text');
  });

  it('edits a passage, inserts under a heading and refuses ambiguous matches', async () => {
    const { v, open1 } = await setup();
    const tools = buildTools({ vault: v, scope: { kind: 'note', noteId: open1.id } });
    await expect(run(tools, 'replace_text', { find: 'beta', replace: 'gamma' })).rejects.toThrow(/appears 2 times/);
    await expect(run(tools, 'replace_text', { find: 'zzz', replace: 'x' })).rejects.toThrow(/not found/);
    await run(tools, 'replace_text', { find: 'alpha', replace: 'ALPHA $& $1' });
    expect((await v.getNote(open1.id))!.body).toContain('ALPHA $& $1');
    await run(tools, 'insert_after_heading', { heading: 'Tasks', markdown: '- [ ] two' });
    const body = (await v.getNote(open1.id))!.body;
    expect(body).toContain('- [ ] one\n- [ ] two\n\n## Notes');
    await expect(run(tools, 'insert_after_heading', { heading: 'Missing', markdown: 'x' })).rejects.toThrow(/Headings in this note: Plan \| Tasks \| Notes/);
    await run(tools, 'append_to_note', { text: 'The end' });
    expect((await v.getNote(open1.id))!.body.trimEnd().endsWith('The end')).toBe(true);
    expect(sectionRange('# A\n\nx\n## B\ny\n# C', 'A')).toEqual({ start: 0, end: 5 });
  });

  it('lets the host review edits before they are written', async () => {
    const { v, open1 } = await setup();
    const pending = new Map<string, { title: string; body: string }>();
    const io: NoteIO = {
      read: async id => pending.get(id) ? { id, ...pending.get(id)! } : (await v.getNote(id)) ? { id, title: (await v.getNote(id))!.title, body: (await v.getNote(id))!.body } : null,
      write: async (id, patch) => {
        const cur = await io.read(id);
        pending.set(id, { title: patch.title ?? cur!.title, body: patch.body ?? cur!.body });
        return 'Proposed; waiting for the user.';
      },
    };
    const tools = buildTools({ vault: v, scope: { kind: 'note', noteId: open1.id }, io });
    const before = (await v.getNote(open1.id))!.body;
    await run(tools, 'replace_text', { find: 'alpha', replace: 'ONE' });
    await run(tools, 'replace_text', { find: 'ONE', replace: 'two' }); // sees the first edit
    expect(pending.get(open1.id)!.body).toContain('two');
    expect((await v.getNote(open1.id))!.body).toBe(before);
    expect(JSON.parse(await run(tools, 'read_note', {})).body).toContain('two');
  });
});

describe('next-words suggestion', () => {
  it('shows the model the text around a cursor marker, with worked examples', () => {
    const r = suggestionRequest({ title: 'T', before: 'a'.repeat(3000) + ' i am a en', after: 'z'.repeat(2000) });
    expect(r.model).toBe('suggest');
    expect(r.maxTokens).toBeLessThanOrEqual(60);
    const last = r.messages.at(-1) as { content: string };
    expect(last.content.startsWith('Note: T')).toBe(true);
    expect(last.content).toContain(' i am a en<CURSOR>z');
    expect(last.content.length).toBeLessThan(1500 + 300 + 60);
    expect(r.messages.length).toBeGreaterThanOrEqual(5);
    expect(r.system).toContain('single JSON string');
  });

  it('keeps the spacing the model chose, and never doubles a space', () => {
    expect(cleanSuggestion('"gineer who builds apps"', 'I am a software en')).toBe('gineer who builds apps');
    expect(cleanSuggestion('" first version"', 'We agreed to ship the')).toBe(' first version');
    expect(cleanSuggestion('" a cake"', 'balloons and ')).toBe('a cake');
    expect(cleanSuggestion('"the quick fox"', 'Today ')).toBe('the quick fox');
    // an answer that ignored the format: guess a new word
    expect(cleanSuggestion('and then', 'We went home')).toBe(' and then');
    expect(cleanSuggestion('Continuation: and then', 'We went home')).toBe(' and then');
  });

  it('drops text the model repeated from before the cursor', () => {
    expect(cleanSuggestion('"abc is a test property listing"', 'abc is a')).toBe(' test property listing');
    expect(cleanSuggestion('"went home and slept"', 'we went home and slept')).toBe('');
    expect(cleanSuggestion('"I like cats and dogs"', 'I like')).toBe(' cats and dogs');
    // a word that merely starts like the end of the text is not a repeat
    expect(cleanSuggestion('"cat sat"', 'the c')).toBe('cat sat');
  });

  it('keeps one short paragraph', () => {
    expect(cleanSuggestion('"first line\\n\\nsecond"', 'x ')).toBe('first line');
    expect(cleanSuggestion('   ', 'x')).toBe('');
    expect(cleanSuggestion('""', 'x')).toBe('');
    const long = JSON.stringify(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '));
    expect(cleanSuggestion(long, 'a ').split(' ').length).toBe(14);
    expect(cleanSuggestion('x'.repeat(500), 'a ').length).toBeLessThanOrEqual(240);
  });

  it('completeText joins the streamed text', async () => {
    const t: AiTransport = async function* () { yield { type: 'text', delta: 'a' } as AiEvent; yield { type: 'text', delta: 'b' } as AiEvent; };
    expect(await completeText(t, { model: 'suggest', messages: [] })).toBe('ab');
  });
});

describe('agent skill', () => {
  it('the text served by the app is the file in docs/', async () => {
    const { readFile } = await import('node:fs/promises');
    const { ERGONOTES_SKILL_MD } = await import('../src/index.ts');
    const file = await readFile(new URL('../../../docs/agents/ergonotes-skill/SKILL.md', import.meta.url), 'utf8');
    expect(ERGONOTES_SKILL_MD).toBe(file);
  });

  it('names every tool the endpoint offers', async () => {
    const { ERGONOTES_SKILL_MD } = await import('../src/index.ts');
    const v = await open('A');
    await v.createVault(PASSWORD);
    for (const t of buildTools({ vault: v, scope: { kind: 'vault' } })) expect(ERGONOTES_SKILL_MD).toContain(`\`${t.spec.name}\``);
  });
});

describe('conversations in the vault', () => {
  it('saves, lists, reopens and deletes a conversation, and syncs it to another device', async () => {
    shared.set('chat1', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('chat1'));
    const saved = await A.saveChat({ title: 'Trip ideas', data: JSON.stringify({ items: ['line one\nline two', '---'] }) });
    expect((await A.listChats()).map(c => c.title)).toEqual(['Trip ideas']);
    const again = await A.saveChat({ id: saved.id, title: 'Trip ideas (2)', data: '{"items":[]}' });
    expect(again.id).toBe(saved.id);
    expect(again.created).toBe(saved.created);
    expect((await A.listChats())).toHaveLength(1);
    // a conversation is not a note
    expect((await A.listItems()).some(i => i.id === saved.id)).toBe(false);
    expect(await A.conflicts()).toHaveLength(0);
    await A.saveChat({ id: saved.id, title: 'Trip ideas', data: JSON.stringify({ items: ['---\nid: x', 'tail'] }) });
    await A.sync();

    const B = await open('Phone');
    await B.joinVault(cfgFor('chat1'), PASSWORD);
    const got = await B.getChat(saved.id);
    expect(JSON.parse(got!.data).items).toEqual(['---\nid: x', 'tail']);
    await B.deleteChat(saved.id);
    expect(await B.listChats()).toEqual([]);
    await B.sync(); await A.sync();
    expect(await A.listChats()).toEqual([]);
  });

  it('settles a conversation both devices extended', async () => {
    shared.set('chat2', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('chat2'));
    const c = await A.saveChat({ title: 'Plan', data: '{"n":1}' });
    await A.sync();
    const B = await open('Phone');
    await B.joinVault(cfgFor('chat2'), PASSWORD);
    await A.saveChat({ id: c.id, title: 'Plan', data: '{"n":2,"by":"A"}' });
    await new Promise(r => setTimeout(r, 5));
    await B.saveChat({ id: c.id, title: 'Plan', data: '{"n":2,"by":"B"}' });
    await A.sync(); await B.sync(); await A.sync(); await B.sync(); await A.sync();
    expect(await A.conflicts()).toHaveLength(0);
    expect(await B.conflicts()).toHaveLength(0);
    expect((await A.getChat(c.id))!.data).toBe((await B.getChat(c.id))!.data);
  });
});

describe('attached notes and answer-only mode', () => {
  it('lets the chat work on notes the person attached, and nothing else', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const open1 = await v.createNote({ title: 'Open', body: 'one' });
    const attached = await v.createNote({ title: 'Attached', body: 'two' });
    const other = await v.createNote({ title: 'Other', body: 'three' });
    const tools = buildTools({ vault: v, scope: { kind: 'note', noteId: open1.id, allow: [attached.id] } });
    const run = (n: string, a: Record<string, unknown>) => tools.find(t => t.spec.name === n)!.run(a);
    expect(JSON.parse(await run('read_note', { id: attached.id })).body).toBe('two');
    await run('append_to_note', { id: attached.id, text: 'more' });
    await expect(run('read_note', { id: other.id })).rejects.toThrow(/not found/);
  });

  it('answer-only mode has no tool that changes anything', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const names = buildTools({ vault: v, scope: { kind: 'vault' }, readOnly: true, extra: [{ spec: { name: 'insert_diagram', description: '', parameters: {} }, run: async () => '' }] }).map(t => t.spec.name);
    expect(names).toEqual(expect.arrayContaining(['search_notes', 'read_note', 'list_folders', 'list_tasks']));
    for (const w of ['create_note', 'append_to_note', 'replace_text', 'insert_after_heading', 'update_note', 'rename_note', 'add_tags', 'move_note', 'complete_task', 'daily_note', 'insert_diagram']) expect(names).not.toContain(w);
  });
});

describe('busy providers', () => {
  it('retries before anything was produced, and reports it', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls < 3) return new Response(JSON.stringify({ error: { message: 'Provider returned error', metadata: { raw: 'model is temporarily rate-limited upstream' } } }), { status: 429 });
      return sse([{ choices: [{ delta: { content: 'finally' } }] }, '[DONE]']);
    }) as unknown as typeof fetch;
    const ev = await collect(streamChat(cfg(), { model: 'chat', messages: [] }, { fetchImpl }));
    expect(calls).toBe(3);
    expect(ev.filter(e => e.type === 'notice')).toHaveLength(2);
    expect(ev.find(e => e.type === 'text')).toEqual({ type: 'text', delta: 'finally' });
  }, 15_000);

  it('does not repeat text that was already produced, and does not retry a bad key', async () => {
    let calls = 0;
    const broken = (async () => {
      calls++;
      return sse([{ choices: [{ delta: { content: 'half' } }] }, { error: { message: 'JSON error injected into SSE stream' } }]);
    }) as unknown as typeof fetch;
    await expect(collect(streamChat(cfg(), { model: 'chat', messages: [] }, { fetchImpl: broken }))).rejects.toThrow(/injected/);
    expect(calls).toBe(1);
    let c2 = 0;
    const bad = (async () => { c2++; return new Response('{"error":{"message":"no"}}', { status: 401 }); }) as unknown as typeof fetch;
    await expect(collect(streamChat(cfg(), { model: 'chat', messages: [] }, { fetchImpl: bad }))).rejects.toThrow(/rejected the API key/);
    expect(c2).toBe(1);
  });
});

describe('custom OpenAI-style server (Ollama)', () => {
  const custom = (over: One = {}): AiConfig => cfg({ provider: 'custom', keys: {}, ...over });

  it('finds the API from whatever address was typed', () => {
    expect(apiBase('http://localhost:11434')).toBe('http://localhost:11434/v1');
    expect(apiBase('http://localhost:11434/')).toBe('http://localhost:11434/v1');
    expect(apiBase('https://gw.example.com/v1/')).toBe('https://gw.example.com/v1');
    expect(apiBase('https://gw.example.com/openai/v1/chat/completions')).toBe('https://gw.example.com/openai/v1');
    expect(apiBase('http://10.0.0.5:8080/api')).toBe('http://10.0.0.5:8080/api');
  });

  it('needs an address but not a key, and sends the key only when there is one', async () => {
    expect(toSettings(custom({ customUrl: '' })).chatReady).toBe(false);
    expect(toSettings(custom()).chatReady).toBe(true);
    const seen: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body as string) });
      return sse([{ choices: [{ delta: { content: 'hi' } }] }, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'read_note', arguments: { id: 'n1' } } }] } }] }, '[DONE]']);
    }) as unknown as typeof fetch;
    const ev = await collect(streamChat(custom(), { model: 'suggest', messages: [{ role: 'user', content: 'x' }] }, { fetchImpl }));
    expect(seen[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(seen[0].auth).toBeNull();
    expect(seen[0].body.model).toBe('llama3.2');
    expect('reasoning' in seen[0].body).toBe(false); // an OpenRouter-only option
    expect(ev.find(e => e.type === 'tool_call')).toEqual({ type: 'tool_call', call: { id: 'c', name: 'read_note', args: { id: 'n1' } } });
    await collect(streamChat(custom({ keys: { custom: 'secret' } }), { model: 'chat', messages: [] }, { fetchImpl }));
    expect(seen[1].auth).toBe('Bearer secret');
    await expect(collect(streamChat(custom({ customUrl: '' }), { model: 'chat', messages: [] }, { fetchImpl }))).rejects.toThrow(/Add the address of/);
  });

  it('explains an unreachable server instead of "Failed to fetch"', async () => {
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(collect(streamChat(custom(), { model: 'chat', messages: [] }, { fetchImpl: down }))).rejects.toThrow(/Could not reach localhost:11434.*running/);
  });

  it('lists the models, from the OpenAI-style and the Ollama shapes', async () => {
    const openai = (async (url: string) => { expect(url).toBe('http://localhost:11434/v1/models'); return new Response(JSON.stringify({ data: [{ id: 'qwen2.5:7b' }, { id: 'llama3.2:3b' }] })); }) as unknown as typeof fetch;
    expect((await listModels(custom().connections[0], { fetchImpl: openai })).map(m => m.id)).toEqual(['llama3.2:3b', 'qwen2.5:7b']);
    const native = (async () => new Response(JSON.stringify({ models: [{ name: 'phi3' }, { name: 'gemma2' }] }))) as unknown as typeof fetch;
    expect((await listModels(custom().connections[0], { fetchImpl: native })).map(m => m.id)).toEqual(['gemma2', 'phi3']);
    await expect(listModels(custom({ customUrl: '' }).connections[0])).rejects.toThrow(/address/);
  });

  it('stores the address in the vault and refuses one that is not http(s)', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    const s = await v.setAiSettings({ connection: { id: 'home', type: 'custom', name: 'Home', url: ' http://192.168.1.20:11434 ', key: 'k' } });
    expect(s.connections[0]).toMatchObject({ id: 'home', type: 'custom', url: 'http://192.168.1.20:11434', ready: true });
    expect(s).toMatchObject({ chatReady: true, chatModel: { connection: 'home', model: 'llama3.2' } });
    expect(v.aiConfig().connections[0].key).toBe('k');
    await expect(v.setAiSettings({ connection: { id: 'home', url: 'ftp://nope' } })).rejects.toThrow(/http/);
    await expect(v.setAiSettings({ connection: { id: 'home', url: 'localhost:11434' } })).rejects.toThrow(/http/);
    expect((await v.setAiSettings({ connection: { id: 'home', url: '' } })).chatReady).toBe(false);
  });
});

describe('thinking', () => {
  const capture = () => {
    const seen: Record<string, unknown>[] = [];
    const f = (reply: () => Response) => (async (_u: string, init: RequestInit) => { seen.push(JSON.parse(init.body as string)); return reply(); }) as unknown as typeof fetch;
    return { seen, f };
  };

  it('asks OpenRouter for the level of the job (chat and suggestions differ) and shows the thought', async () => {
    const { seen, f } = capture();
    const fetchImpl = f(() => sse([{ choices: [{ delta: { reasoning: 'Let me ' } }] }, { choices: [{ delta: { reasoning: 'check.' } }] }, { choices: [{ delta: { content: 'Done' } }] }, '[DONE]']));
    const c = cfg({ chatModel: 'm/x', suggestModel: 'm/x', chatThinking: 'high', suggestThinking: 'off' });
    const ev = await collect(streamChat(c, { model: 'chat', messages: [] }, { fetchImpl }));
    expect(seen[0].reasoning).toEqual({ effort: 'high' });
    expect(ev.filter(e => e.type === 'thinking').map(e => (e as { delta: string }).delta).join('')).toBe('Let me check.');
    expect(ev.find(e => e.type === 'text')).toEqual({ type: 'text', delta: 'Done' });
    await collect(streamChat(c, { model: 'suggest', messages: [] }, { fetchImpl }));
    expect(seen[1].reasoning).toEqual({ enabled: false });
    await collect(streamChat({ ...c, chatThinking: 'auto' }, { model: 'chat', messages: [] }, { fetchImpl }));
    expect('reasoning' in seen[2]).toBe(false);
  });

  it('sends reasoning_effort to an Ollama-style server and splits <think> tags across chunks', async () => {
    const { seen, f } = capture();
    const fetchImpl = f(() => sse([
      { choices: [{ delta: { content: '<thi' } }] }, { choices: [{ delta: { content: 'nk>hmm, 2+' } }] }, { choices: [{ delta: { content: '2</th' } }] },
      { choices: [{ delta: { content: 'ink>The answer is 4' } }] }, { choices: [{ delta: { reasoning_content: ' (again)' } }] }, '[DONE]',
    ]));
    const c = cfg({ provider: 'custom', keys: {}, chatThinking: 'low', suggestThinking: 'off' });
    const ev = await collect(streamChat(c, { model: 'chat', messages: [] }, { fetchImpl }));
    expect(seen[0].reasoning_effort).toBe('low');
    expect(ev.filter(e => e.type === 'thinking').map(e => (e as { delta: string }).delta).join('')).toBe('hmm, 2+2 (again)');
    expect(ev.filter(e => e.type === 'text').map(e => (e as { delta: string }).delta).join('')).toBe('The answer is 4');
    await collect(streamChat(c, { model: 'suggest', messages: [] }, { fetchImpl }));
    expect(seen[1].reasoning_effort).toBe('none');
  });

  it('splits <think> text exactly, even byte by byte', () => {
    const sp = new ThinkSplitter();
    const text = 'a<think>b</think>c<think>d';
    const out: { thinking: boolean; delta: string }[] = [];
    for (const ch of text) out.push(...sp.push(ch));
    out.push(...sp.flush());
    const join = (t: boolean) => out.filter(o => o.thinking === t).map(o => o.delta).join('');
    expect(join(false)).toBe('ac');
    expect(join(true)).toBe('bd');
  });

  it('turns on extended thinking for Anthropic and keeps the signed thoughts for the next request', async () => {
    const { seen, f } = capture();
    const stream = () => sse([
      { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I should ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'read it.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu', name: 'read_note' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_stop' },
    ]);
    const c = cfg({ provider: 'anthropic', chatThinking: 'medium', suggestThinking: 'off' });
    const calls: AiRequest[] = [];
    const transport: AiTransport = (req, signal) => { calls.push(structuredClone(req)); return streamChat(c, req, { fetchImpl: f(stream), signal }); };
    const added = await runAgent({
      transport, system: 's', history: [{ role: 'user', content: 'go' }],
      tools: [{ spec: { name: 'read_note', description: '', parameters: {} }, run: async () => 'body' }],
      maxSteps: 2, onEvent: () => undefined,
    });
    expect(seen[0].thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(seen[0].max_tokens).toBe(4096 + 4096);
    expect('temperature' in seen[0]).toBe(false);
    expect(added[0]).toMatchObject({ role: 'assistant', thinking: [{ text: 'I should read it.', signature: 'SIG' }] });
    // the second request carries the thought first, then the tool call, then the result
    const second = seen[1].messages as { role: string; content: { type: string; signature?: string }[] }[];
    expect(second[1].role).toBe('assistant');
    expect(second[1].content.map(b => b.type)).toEqual(['thinking', 'tool_use']);
    expect(second[1].content[0].signature).toBe('SIG');
    // suggestions do not think, and keep their temperature
    await collect(streamChat(c, { model: 'suggest', messages: [], temperature: 0.3 }, { fetchImpl: f(stream) }));
    expect('thinking' in seen[2]).toBe(false);
    expect(seen[2].temperature).toBe(0.3);
    expect(calls).toHaveLength(2);
  });

  it('keeps the two levels in the vault and ignores nonsense', async () => {
    const v = await open('A');
    await v.createVault(PASSWORD);
    expect(await v.getAiSettings()).toMatchObject({ chatThinking: 'auto', suggestThinking: 'off' });
    expect(await v.setAiSettings({ chatThinking: 'high', suggestThinking: 'low' })).toMatchObject({ chatThinking: 'high', suggestThinking: 'low' });
    expect(await v.setAiSettings({ chatThinking: 'extreme' as never })).toMatchObject({ chatThinking: 'high' });
  });
});

describe('model list', () => {
  it('reads what OpenRouter says about each model', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ data: [
      { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context_length: 262144, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'temperature'] },
      { id: 'anthropic/claude-sonnet-4.5', name: 'Anthropic: Claude Sonnet 4.5', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools', 'reasoning'] },
      { id: 'tiny/model', pricing: { prompt: '0.1', completion: '0.1' }, supported_parameters: [] },
    ] }))) as unknown as typeof fetch;
    const list = await listModels(cfg().connections[0], { fetchImpl });
    const by = Object.fromEntries(list.map(m => [m.id, m]));
    expect(by['google/gemma-4-31b-it:free']).toMatchObject({ name: 'Google: Gemma 4 31B (free)', context: 262144, free: true, tools: true, thinking: false });
    expect(by['anthropic/claude-sonnet-4.5']).toMatchObject({ free: false, tools: true, thinking: true });
    expect(by['tiny/model']).toMatchObject({ free: false, tools: false });
    expect(list[0].id).toBe('anthropic/claude-sonnet-4.5');
  });

  it('reads the Anthropic list', async () => {
    let seen: Headers | null = null;
    const fetchImpl = (async (_u: string, init: RequestInit) => { seen = new Headers(init.headers); return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', type: 'model' }] })); }) as unknown as typeof fetch;
    const list = await listModels(cfg({ provider: 'anthropic' }).connections[0], { fetchImpl });
    expect(list).toEqual([{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }]);
    expect(seen!.get('x-api-key')).toBe('sk-ant-test');
  });
});
