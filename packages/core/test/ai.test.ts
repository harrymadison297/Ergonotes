import { describe, expect, it } from 'vitest';
import { MemPersist } from '../src/persist.ts';
import { MemStore } from '../src/store.ts';
import { Vault } from '../src/vault.ts';
import type { StoreConfig } from '../src/api.ts';
import {
  applyAiPatch, buildTools, chatSystemPrompt, cleanSuggestion, completeText, defaultAiConfig, runAgent, sectionRange, streamChat, suggestionRequest,
  type AiConfig, type AiEvent, type AiMessage, type AiRequest, type AiTransport, type NoteIO,
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
const cfg = (over: Partial<AiConfig> = {}): AiConfig => ({ ...defaultAiConfig(), keys: { openrouter: 'sk-or-test', anthropic: 'sk-ant-test' }, ...over });

describe('AI settings in the vault', () => {
  it('keeps the key out of what clients may read, and syncs it to another device', async () => {
    shared.set('ai1', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('ai1'));
    const s = await A.setAiSettings({ keys: { openrouter: ' sk-or-secret-1234 ' }, chatModel: 'x/y', wholeVault: true });
    expect(s).toMatchObject({ provider: 'openrouter', hasKey: true, keyHint: '1234', chatModel: 'x/y', wholeVault: true, autoApply: false });
    expect(JSON.stringify(s)).not.toContain('secret');
    expect(A.aiConfig().keys.openrouter).toBe('sk-or-secret-1234');
    await A.sync();

    const B = await open('Phone');
    await B.joinVault(cfgFor('ai1'), PASSWORD);
    expect(await B.getAiSettings()).toMatchObject({ hasKey: true, keyHint: '1234', chatModel: 'x/y', wholeVault: true });
    // the settings item is not a note, and is not a conflict
    expect((await B.listItems()).every(i => i.type === 'folder' || i.title !== '')).toBe(true);
    expect(await B.conflicts()).toHaveLength(0);
  });

  it('settles two devices saving at once without asking anyone', async () => {
    shared.set('ai2', new MemStore());
    const A = await open('Laptop');
    await A.createVault(PASSWORD);
    await A.setStore(cfgFor('ai2'));
    await A.setAiSettings({ chatModel: 'first' });
    await A.sync();
    const B = await open('Phone');
    await B.joinVault(cfgFor('ai2'), PASSWORD);
    await A.setAiSettings({ chatModel: 'from-laptop' });
    await new Promise(r => setTimeout(r, 5));
    await B.setAiSettings({ chatModel: 'from-phone' });
    await A.sync(); await B.sync(); await A.sync(); await B.sync(); await A.sync();
    expect(await A.conflicts()).toHaveLength(0);
    expect(await B.conflicts()).toHaveLength(0);
    const a = (await A.getAiSettings()).chatModel, b = (await B.getAiSettings()).chatModel;
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

  it('switching provider swaps default models only, and null forgets a key', () => {
    let c = applyAiPatch(defaultAiConfig(), { provider: 'anthropic' });
    expect(c.chatModel).toBe('claude-sonnet-5-5');
    c = applyAiPatch({ ...c, chatModel: 'my/own' }, { provider: 'openrouter' });
    expect(c.chatModel).toBe('my/own');
    c = applyAiPatch(c, { keys: { openrouter: 'k' } });
    expect(c.keys.openrouter).toBe('k');
    expect(applyAiPatch(c, { keys: { openrouter: null } }).keys.openrouter).toBeUndefined();
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
    await expect(collect(streamChat(cfg({ keys: {} }), { model: 'chat', messages: [] }))).rejects.toThrow(/Add an OpenRouter API key/);
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
  it('builds a short request around the cursor', () => {
    const r = suggestionRequest({ title: 'T', before: 'a'.repeat(2000), after: 'z'.repeat(2000) });
    expect(r.model).toBe('suggest');
    expect(r.maxTokens).toBeLessThanOrEqual(60);
    const m = (r.messages[0] as { content: string }).content;
    expect(m.length).toBeLessThan(1300);
  });

  it('cleans what the model returns', () => {
    expect(cleanSuggestion('"the quick fox"', 'Today ')).toBe('the quick fox');
    expect(cleanSuggestion('Continuation: and then', 'We went home')).toBe(' and then');
    expect(cleanSuggestion('first line\n\nsecond', 'x ')).toBe('first line');
    expect(cleanSuggestion('   ', 'x')).toBe('');
    expect(cleanSuggestion('went home and slept', 'we went home and slept')).toBe('');
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
