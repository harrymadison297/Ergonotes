// Streaming chat against OpenRouter (OpenAI-style) and Anthropic (Messages API), normalised to AiEvent.
import type { AiConfig, AiEvent, AiMessage, AiRequest, AiToolCall } from './types.ts';

export interface StreamOptions { fetchImpl?: typeof fetch; signal?: AbortSignal }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class AiError extends Error {
  status: number | undefined;
  constructor(message: string, status?: number) { super(message); this.name = 'AiError'; this.status = status; }
}

/** Server-sent events: yields the `data:` payload of each event (comment lines are ignored). */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new AiError('The provider sent an empty response');
  const reader = res.body.getReader();
  const td = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += td.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
    }
    const rest = buf.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

/** The provider's own explanation: OpenRouter hides the useful part (which upstream, why) under `metadata.raw`. */
function explain(j: { error?: { message?: string; metadata?: { raw?: unknown } } | string; message?: string }): string | null {
  if (typeof j.error === 'string') return j.error;
  const raw = j.error?.metadata?.raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const inner = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
      const m = typeof inner.error === 'string' ? inner.error : inner.error?.message ?? inner.message;
      if (m) return m;
    } catch { /* plain text */ }
    return raw;
  }
  return j.error?.message ?? j.message ?? null;
}

async function failure(res: Response): Promise<AiError> {
  let msg = `The AI provider answered ${res.status}`;
  try { msg = explain((await res.json()) as Parameters<typeof explain>[0]) ?? msg; } catch { /* keep the status text */ }
  if (res.status === 401 || res.status === 403) msg = `The provider rejected the API key (${msg})`;
  else if (res.status === 429) msg = `Rate limited: ${msg}`;
  return new AiError(msg, res.status);
}

const parseArgs = (s: string): Record<string, unknown> => {
  if (!s.trim()) return {};
  try { const v: unknown = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; } catch { return {}; }
};

// ---------------------------------------------------------------- OpenRouter
function openAiMessages(req: AiRequest): unknown[] {
  const out: unknown[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  for (const m of req.messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const o: Record<string, unknown> = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) o.tool_calls = m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      out.push(o);
    } else out.push({ role: 'tool', tool_call_id: m.callId, content: m.content });
  }
  return out;
}

async function* openRouter(cfg: AiConfig, req: AiRequest, o: StreamOptions): AsyncGenerator<AiEvent> {
  const key = cfg.keys.openrouter;
  if (!key) throw new AiError('Add an OpenRouter API key in Settings → AI.');
  const model = req.model === 'chat' ? cfg.chatModel : cfg.suggestModel;
  const body: Record<string, unknown> = {
    model, messages: openAiMessages(req), stream: true, stream_options: { include_usage: true },
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  // a suggestion has to be quick and short: a model that "thinks" first would spend the whole answer on it
  if (req.model === 'suggest') body.reasoning = { enabled: false };
  if (req.tools?.length) body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const res = await (o.fetchImpl ?? fetch)(OPENROUTER_URL, {
    method: 'POST', signal: o.signal,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Ergonotes' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for await (const data of sseData(res)) {
    if (data.trim() === '[DONE]') break;
    let j: {
      error?: { message?: string; metadata?: { raw?: unknown } };
      choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AiError(explain({ error: j.error }) ?? 'The AI provider reported an error');
    const d = j.choices?.[0]?.delta;
    if (d?.content) yield { type: 'text', delta: d.content };
    for (const tc of d?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      calls.set(idx, cur);
    }
    if (j.usage) yield { type: 'usage', input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
  }
  for (const [i, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
    if (!c.name) continue;
    yield { type: 'tool_call', call: { id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) } };
  }
  yield { type: 'done' };
}

// ---------------------------------------------------------------- Anthropic
function anthropicMessages(messages: AiMessage[]): unknown[] {
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  const push = (role: 'user' | 'assistant', block: unknown) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', { type: 'text', text: m.content });
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args });
    } else push('user', { type: 'tool_result', tool_use_id: m.callId, content: m.content });
  }
  return out;
}

async function* anthropic(cfg: AiConfig, req: AiRequest, o: StreamOptions): AsyncGenerator<AiEvent> {
  const key = cfg.keys.anthropic;
  if (!key) throw new AiError('Add an Anthropic API key in Settings → AI.');
  const model = req.model === 'chat' ? cfg.chatModel : cfg.suggestModel;
  const body: Record<string, unknown> = {
    model, max_tokens: req.maxTokens ?? 4096, messages: anthropicMessages(req.messages), stream: true,
    ...(req.system ? { system: req.system } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  if (req.tools?.length) body.tools = req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await (o.fetchImpl ?? fetch)(ANTHROPIC_URL, {
    method: 'POST', signal: o.signal,
    headers: {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      // a browser needs this flag to be allowed to send the key; the user's own key, their own device
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  let input = 0, output = 0;
  for await (const data of sseData(res)) {
    let j: {
      type?: string; index?: number; error?: { message?: string };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string };
      usage?: { output_tokens?: number };
    };
    try { j = JSON.parse(data); } catch { continue; }
    switch (j.type) {
      case 'error': throw new AiError(j.error?.message ?? 'The AI provider reported an error');
      case 'message_start': input = j.message?.usage?.input_tokens ?? 0; output = j.message?.usage?.output_tokens ?? 0; break;
      case 'content_block_start':
        if (j.content_block?.type === 'tool_use') blocks.set(j.index ?? 0, { id: j.content_block.id ?? '', name: j.content_block.name ?? '', json: '' });
        break;
      case 'content_block_delta':
        if (j.delta?.type === 'text_delta' && j.delta.text) yield { type: 'text', delta: j.delta.text };
        else if (j.delta?.type === 'input_json_delta') { const b = blocks.get(j.index ?? 0); if (b) b.json += j.delta.partial_json ?? ''; }
        break;
      case 'content_block_stop': {
        const b = blocks.get(j.index ?? 0);
        if (b) { blocks.delete(j.index ?? 0); yield { type: 'tool_call', call: { id: b.id, name: b.name, args: parseArgs(b.json) } satisfies AiToolCall }; }
        break;
      }
      case 'message_delta': if (j.usage?.output_tokens !== undefined) output = j.usage.output_tokens; break;
    }
  }
  yield { type: 'usage', input, output };
  yield { type: 'done' };
}

export function streamChat(cfg: AiConfig, req: AiRequest, o: StreamOptions = {}): AsyncGenerator<AiEvent> {
  return cfg.provider === 'anthropic' ? anthropic(cfg, req, o) : openRouter(cfg, req, o);
}

/** The whole answer of a request without tools, as text. */
export async function completeText(transport: (r: AiRequest, s?: AbortSignal) => AsyncIterable<AiEvent>, req: AiRequest, signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const e of transport(req, signal)) if (e.type === 'text') out += e.delta;
  return out;
}
