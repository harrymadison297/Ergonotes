// Streaming chat against OpenRouter (OpenAI-style) and Anthropic (Messages API), normalised to AiEvent.
import { resolveTarget, type AiConfig, type AiConnection, type AiEvent, type AiMessage, type AiRequest, type AiThinkingBlock, type AiToolCall, type ModelInfo, type ThinkingLevel } from './types.ts';

export interface StreamOptions { fetchImpl?: typeof fetch; signal?: AbortSignal }

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
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

/** Base of an OpenAI-style API from whatever the person typed: `http://host:11434`, `…/v1`, or the full chat URL. */
export function apiBase(raw: string): string {
  const u = new URL(raw.trim());
  let p = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (p === '') p = '/v1';
  return u.origin + p;
}

/** fetch that explains a network failure: "Failed to fetch" tells nobody that their server is not running. */
async function post(url: string, init: RequestInit, o: StreamOptions): Promise<Response> {
  try { return await (o.fetchImpl ?? fetch)(url, init); } catch (e) {
    if (o.signal?.aborted) throw e;
    let host = url;
    try { host = new URL(url).host; } catch { /* keep */ }
    throw new AiError(`Could not reach ${host}. Is the server running and reachable from this device? (${e instanceof Error ? e.message : String(e)})`);
  }
}

const thinkingFor = (cfg: AiConfig, req: AiRequest): ThinkingLevel => (req.model === 'chat' ? cfg.chatThinking : cfg.suggestThinking) ?? 'auto';

/** Models that think in the answer itself (`<think>…</think>`): split the thought from the text, across chunk borders. */
export class ThinkSplitter {
  private inside = false;
  private buf = '';
  private static OPEN = '<think>';
  private static CLOSE = '</think>';

  push(chunk: string): { thinking: boolean; delta: string }[] {
    this.buf += chunk;
    const out: { thinking: boolean; delta: string }[] = [];
    for (;;) {
      const tag = this.inside ? ThinkSplitter.CLOSE : ThinkSplitter.OPEN;
      const i = this.buf.indexOf(tag);
      if (i >= 0) {
        if (i > 0) out.push({ thinking: this.inside, delta: this.buf.slice(0, i) });
        this.buf = this.buf.slice(i + tag.length);
        this.inside = !this.inside;
        continue;
      }
      // keep a possible start of the tag for the next chunk
      let keep = 0;
      for (let k = Math.min(tag.length - 1, this.buf.length); k > 0; k--) if (tag.startsWith(this.buf.slice(-k))) { keep = k; break; }
      const emit = this.buf.slice(0, this.buf.length - keep);
      if (emit) out.push({ thinking: this.inside, delta: emit });
      this.buf = this.buf.slice(this.buf.length - keep);
      return out;
    }
  }

  flush(): { thinking: boolean; delta: string }[] {
    const rest = this.buf;
    this.buf = '';
    return rest ? [{ thinking: this.inside, delta: rest }] : [];
  }
}

// ---------------------------------------------------------------- OpenRouter and any OpenAI-style server
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

async function* openAiStyle(cfg: AiConfig, req: AiRequest, o: StreamOptions): AsyncGenerator<AiEvent> {
  const target = resolveTarget(cfg, req.model);
  if (!target) throw new AiError('Add a connection and choose a model in Settings → AI.');
  const { conn, model } = target;
  const custom = conn.type === 'custom';
  const key = conn.key;
  if (custom && !conn.url) throw new AiError(`Add the address of “${conn.name}” in Settings → AI.`);
  if (!custom && !key) throw new AiError(`Add an API key to “${conn.name}” in Settings → AI.`);
  const url = `${custom ? apiBase(conn.url) : OPENROUTER_BASE}/chat/completions`;
  const body: Record<string, unknown> = {
    model, messages: openAiMessages(req), stream: true, stream_options: { include_usage: true },
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
  };
  const level = thinkingFor(cfg, req);
  if (level !== 'auto') {
    // OpenRouter takes a `reasoning` object; Ollama and other OpenAI-style servers take `reasoning_effort`
    if (custom) body.reasoning_effort = level === 'off' ? 'none' : level;
    else body.reasoning = level === 'off' ? { enabled: false } : { effort: level };
  }
  if (req.tools?.length) body.tools = req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const res = await post(url, {
    method: 'POST', signal: o.signal,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...(custom ? {} : { 'x-title': 'Ergonotes' }) },
    body: JSON.stringify(body),
  }, o);
  if (!res.ok) throw await failure(res);
  const calls = new Map<number, { id: string; name: string; args: string }>();
  const split = new ThinkSplitter();
  for await (const data of sseData(res)) {
    if (data.trim() === '[DONE]') break;
    let j: {
      error?: { message?: string; metadata?: { raw?: unknown } };
      choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[] }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AiError(explain({ error: j.error }) ?? 'The AI provider reported an error');
    const d = j.choices?.[0]?.delta;
    const thought = d?.reasoning ?? d?.reasoning_content;
    if (thought) yield { type: 'thinking', delta: thought };
    if (d?.content) {
      for (const part of split.push(d.content)) yield part.thinking ? { type: 'thinking', delta: part.delta } : { type: 'text', delta: part.delta };
    }
    for (const tc of d?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const cur = calls.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      const a = tc.function?.arguments;
      if (a) cur.args += typeof a === 'string' ? a : JSON.stringify(a); // some servers send the arguments as an object
      calls.set(idx, cur);
    }
    if (j.usage) yield { type: 'usage', input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 };
  }
  for (const part of split.flush()) yield part.thinking ? { type: 'thinking', delta: part.delta } : { type: 'text', delta: part.delta };
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
      // thoughts come first, and exactly as received: the signature is checked when a tool result follows
      for (const t of m.thinking ?? []) push('assistant', t.redacted !== undefined ? { type: 'redacted_thinking', data: t.redacted } : { type: 'thinking', thinking: t.text, signature: t.signature ?? '' });
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.args });
    } else push('user', { type: 'tool_result', tool_use_id: m.callId, content: m.content });
  }
  return out;
}

async function* anthropic(cfg: AiConfig, req: AiRequest, o: StreamOptions): AsyncGenerator<AiEvent> {
  const target = resolveTarget(cfg, req.model);
  if (!target) throw new AiError('Add a connection and choose a model in Settings → AI.');
  const { conn, model } = target;
  const key = conn.key;
  if (!key) throw new AiError(`Add an API key to “${conn.name}” in Settings → AI.`);
  const level = thinkingFor(cfg, req);
  const budget = level === 'low' ? 1024 : level === 'medium' ? 4096 : level === 'high' ? 10000 : 0;
  const body: Record<string, unknown> = {
    // the thinking budget is part of max_tokens, so it is added on top of what the answer itself may use
    model, max_tokens: (req.maxTokens ?? 4096) + budget, messages: anthropicMessages(req.messages), stream: true,
    ...(req.system ? { system: req.system } : {}),
    // with thinking switched on the API insists on the default temperature
    ...(req.temperature !== undefined && !budget ? { temperature: req.temperature } : {}),
    ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : {}),
  };
  if (req.tools?.length) body.tools = req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await post(ANTHROPIC_URL, {
    method: 'POST', signal: o.signal,
    headers: {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      // a browser needs this flag to be allowed to send the key; the user's own key, their own device
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  }, o);
  if (!res.ok) throw await failure(res);
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  const thoughts = new Map<number, AiThinkingBlock>();
  let input = 0, output = 0;
  for await (const data of sseData(res)) {
    let j: {
      type?: string; index?: number; error?: { message?: string };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string; data?: string };
      delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string };
      usage?: { output_tokens?: number };
    };
    try { j = JSON.parse(data); } catch { continue; }
    switch (j.type) {
      case 'error': throw new AiError(j.error?.message ?? 'The AI provider reported an error');
      case 'message_start': input = j.message?.usage?.input_tokens ?? 0; output = j.message?.usage?.output_tokens ?? 0; break;
      case 'content_block_start':
        if (j.content_block?.type === 'tool_use') blocks.set(j.index ?? 0, { id: j.content_block.id ?? '', name: j.content_block.name ?? '', json: '' });
        else if (j.content_block?.type === 'thinking') thoughts.set(j.index ?? 0, { text: '' });
        else if (j.content_block?.type === 'redacted_thinking') thoughts.set(j.index ?? 0, { text: '', redacted: j.content_block.data ?? '' });
        break;
      case 'content_block_delta':
        if (j.delta?.type === 'text_delta' && j.delta.text) yield { type: 'text', delta: j.delta.text };
        else if (j.delta?.type === 'input_json_delta') { const b = blocks.get(j.index ?? 0); if (b) b.json += j.delta.partial_json ?? ''; }
        else if (j.delta?.type === 'thinking_delta' && j.delta.thinking) {
          const t = thoughts.get(j.index ?? 0);
          if (t) t.text += j.delta.thinking;
          yield { type: 'thinking', delta: j.delta.thinking };
        } else if (j.delta?.type === 'signature_delta') { const t = thoughts.get(j.index ?? 0); if (t) t.signature = (t.signature ?? '') + (j.delta.signature ?? ''); }
        break;
      case 'content_block_stop': {
        const t = thoughts.get(j.index ?? 0);
        if (t) { thoughts.delete(j.index ?? 0); yield { type: 'thinking_block', block: t }; break; }
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

function streamOnce(cfg: AiConfig, req: AiRequest, o: StreamOptions): AsyncGenerator<AiEvent> {
  return resolveTarget(cfg, req.model)?.conn.type === 'anthropic' ? anthropic(cfg, req, o) : openAiStyle(cfg, req, o);
}

/** Busy providers answer 429/5xx, or break the stream before it starts: worth another try. */
const transient = (e: unknown): boolean =>
  e instanceof AiError && (e.status === 429 || e.status === 408 || (e.status !== undefined && e.status >= 500) || /rate.?limit|temporarily|overloaded|injected into SSE|try again/i.test(e.message));

const RETRY_WAITS_MS = [1500, 4000];

const pause = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * One streamed answer. A transient failure before anything was produced is retried (twice, with a pause);
 * after the first word or tool call the error is reported, because the text would repeat.
 */
export async function* streamChat(cfg: AiConfig, req: AiRequest, o: StreamOptions = {}): AsyncGenerator<AiEvent> {
  for (let attempt = 0; ; attempt++) {
    let produced = false;
    try {
      for await (const e of streamOnce(cfg, req, o)) {
        if (e.type === 'text' || e.type === 'tool_call') produced = true;
        yield e;
      }
      return;
    } catch (e) {
      if (produced || o.signal?.aborted || !transient(e) || attempt >= RETRY_WAITS_MS.length) throw e;
      yield { type: 'notice', text: `The provider is busy, trying again (${attempt + 1}/${RETRY_WAITS_MS.length})…` };
      await pause(RETRY_WAITS_MS[attempt], o.signal);
      if (o.signal?.aborted) return;
    }
  }
}

/** The whole answer of a request without tools, as text. */
export async function completeText(transport: (r: AiRequest, s?: AbortSignal) => AsyncIterable<AiEvent>, req: AiRequest, signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const e of transport(req, signal)) if (e.type === 'text') out += e.delta;
  return out;
}

/** The models the provider offers, for the settings page. */
export async function listModels(conn: AiConnection, o: Pick<StreamOptions, 'fetchImpl' | 'signal'> = {}): Promise<ModelInfo[]> {
  const key = conn.key;
  let url: string;
  const headers: Record<string, string> = {};
  if (conn.type === 'custom') {
    if (!conn.url) throw new AiError(`Add the address of “${conn.name}” first.`);
    url = `${apiBase(conn.url)}/models`;
    if (key) headers.authorization = `Bearer ${key}`;
  } else if (conn.type === 'anthropic') {
    if (!key) throw new AiError(`Add an API key to “${conn.name}” first.`);
    url = 'https://api.anthropic.com/v1/models?limit=100';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else {
    url = `${OPENROUTER_BASE}/models`;
    if (key) headers.authorization = `Bearer ${key}`;
  }
  const res = await post(url, { method: 'GET', headers, signal: o.signal }, o);
  if (!res.ok) throw await failure(res);
  const j = (await res.json()) as {
    data?: { id?: string; name?: string; display_name?: string; context_length?: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[];
    models?: { name?: string; model?: string }[];
  };
  const byId = new Map<string, ModelInfo>();
  for (const m of j.data ?? []) {
    if (!m.id) continue;
    const params = m.supported_parameters;
    const info: ModelInfo = { id: m.id };
    const name = m.name ?? m.display_name;
    if (name && name !== m.id) info.name = name;
    if (typeof m.context_length === 'number') info.context = m.context_length;
    if (m.pricing) info.free = Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
    else if (m.id.endsWith(':free')) info.free = true;
    if (params) { info.tools = params.includes('tools'); info.thinking = params.includes('reasoning') || params.includes('include_reasoning'); }
    byId.set(m.id, info);
  }
  for (const m of j.models ?? []) { const id = m.name ?? m.model; if (id && !byId.has(id)) byId.set(id, { id }); }
  return [...byId.values()].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
