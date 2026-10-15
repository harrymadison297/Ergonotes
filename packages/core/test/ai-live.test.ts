// Talks to the real provider. Skipped unless OPENROUTER_API_KEY is set in the environment (never committed).
import { describe, expect, it } from 'vitest';
import {
  buildTools, chatSystemPrompt, cleanSuggestion, completeText, defaultAiConfig, runAgent, streamChat, suggestionRequest,
  MemPersist, Vault, type AiConfig, type AiRequest, type AiTransport,
} from '../src/index.ts';

const key = process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it:free';
const cfg: AiConfig = {
  ...defaultAiConfig(),
  connections: [{ id: 'or', name: 'OpenRouter', type: 'openrouter', key, url: '' }],
  chatModel: { connection: 'or', model }, suggestModel: { connection: 'or', model },
};
const transport: AiTransport = (req: AiRequest, signal) => streamChat(cfg, req, { signal });

/** Free models share an upstream pool and are often rate limited. That says nothing about our code: skip then. */
async function patient<T>(ctx: { skip: (note?: string) => never }, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!/rate.?limit|temporarily|overloaded|upstream/i.test(String(e))) throw e;
      await new Promise(r => setTimeout(r, 5000 * (i + 1)));
    }
  }
  return ctx.skip(`provider is rate limited: ${String(last).slice(0, 120)}`);
}

describe.skipIf(!key)(`live provider (${model})`, () => {
  it('answers a plain question', async ctx => {
    const text = await patient(ctx, () => completeText(transport, { model: 'chat', messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 20 }));
    expect(text.toLowerCase()).toContain('pong');
  }, 60_000);

  it('calls a tool and uses its result', async ctx => {
    const out: string[] = [];
    await patient(ctx, async () => {
      out.length = 0;
      await runAgent({
        transport, system: 'Use the tools you are given. Answer briefly.', history: [{ role: 'user', content: 'Call get_code and tell me the code it returns.' }],
        tools: [{ spec: { name: 'get_code', description: 'Returns the secret code.', parameters: { type: 'object', properties: {}, additionalProperties: false } }, run: async () => 'ZEBRA-4242' }],
        onEvent: e => { if (e.type === 'text') out.push(e.delta); },
      });
      if (!out.join('').includes('ZEBRA-4242')) throw new Error(`model did not use the tool result: ${out.join('')}`);
    });
    expect(out.join('')).toContain('ZEBRA-4242');
  }, 90_000);

  it('suggests a short continuation', async ctx => {
    const raw = await patient(ctx, () => completeText(transport, suggestionRequest({ title: 'Shopping', before: 'For the party tomorrow I still need to buy balloons, candles and', after: '' })));
    const s = cleanSuggestion(raw, 'For the party tomorrow I still need to buy balloons, candles and');
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(240);
  }, 90_000);

  it('edits the open note through the tools', async ctx => {
    const v = await Vault.open({ persist: new MemPersist(), kdf: { m: 256, t: 1, p: 1 } });
    await v.createVault('correct horse battery staple');
    const n = await v.createNote({ title: 'Groceries', body: '## Fruit\n\n- apples\n\n## Dairy\n\n- milk\n' });
    const tools = buildTools({ vault: v, scope: { kind: 'note', noteId: n.id } });
    await patient(ctx, async () => {
      await v.saveNote(n.id, { body: '## Fruit\n\n- apples\n\n## Dairy\n\n- milk\n' });
      await runAgent({
        transport, tools, system: chatSystemPrompt({ note: { id: n.id, title: 'Groceries', body: '## Fruit\n\n- apples\n\n## Dairy\n\n- milk\n' }, wholeVault: false, today: '2026-10-14' }),
        history: [{ role: 'user', content: 'Add bananas to the Fruit list.' }], onEvent: () => undefined,
      });
      if (!/banana/i.test((await v.getNote(n.id))!.body)) throw new Error('note was not changed');
    });
    expect((await v.getNote(n.id))!.body).toMatch(/banana/i);
  }, 120_000);
});
