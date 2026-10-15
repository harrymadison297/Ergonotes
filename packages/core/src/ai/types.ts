// Shared shapes for the AI features: provider configuration, the chat protocol and the stream of events.
/** `custom`: a server that speaks the OpenAI chat API: Ollama, LM Studio, vLLM, LiteLLM… */
export type AiProvider = 'openrouter' | 'anthropic' | 'custom';
export const AI_PROVIDERS: readonly AiProvider[] = ['openrouter', 'anthropic', 'custom'];

/** How much a model may think before it answers. `auto` sends nothing: the model's own default. */
export type ThinkingLevel = 'auto' | 'off' | 'low' | 'medium' | 'high';
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['auto', 'off', 'low', 'medium', 'high'];

/** One way to reach models: an OpenRouter or Anthropic account, or a server of the person's own. */
export interface AiConnection {
  id: string;
  /** what the person calls it, e.g. "Work OpenRouter" */
  name: string;
  type: AiProvider;
  /** API key; optional for a custom server */
  key?: string;
  /** address of a custom server, e.g. http://localhost:11434 or https://host/v1 */
  url: string;
}

/** A model, and the connection it is reached through. */
export interface ModelRef { connection: string; model: string }

/** What is stored in the vault (encrypted, synced). Keys never leave a device that holds the vault, except to the provider. */
export interface AiConfig {
  connections: AiConnection[];
  chatModel: ModelRef;
  suggestModel: ModelRef;
  /** speech-to-text (voice dictation, recordings, audio files): an OpenAI-style `/audio/transcriptions` model of a custom server */
  speechModel: ModelRef;
  /** thinking for the chat and for suggestions are separate: one model, two jobs */
  chatThinking: ThinkingLevel;
  suggestThinking: ThinkingLevel;
  /** the chat may search and read the whole vault, not only the open note */
  wholeVault: boolean;
  /** apply the agent's edits at once instead of asking first */
  autoApply: boolean;
  /** the grey next-words suggestion while typing (each one is a request to the provider) */
  suggest: boolean;
  /** pause in typing before one is requested, ms */
  suggestDelay: number;
}

/** A connection as a client may see it: without the key. */
export interface AiConnectionInfo {
  id: string;
  name: string;
  type: AiProvider;
  url: string;
  /** last characters of the saved key, for recognising it in the settings page */
  keyHint: string | null;
  /** can be used: has a key (or, for a custom server, an address; its key is optional) */
  ready: boolean;
}

export interface AiSettings {
  connections: AiConnectionInfo[];
  chatModel: ModelRef;
  suggestModel: ModelRef;
  /** the connection of the chat model is ready */
  chatReady: boolean;
  /** the connection of the suggestion model is ready */
  suggestReady: boolean;
  speechModel: ModelRef;
  /** speech-to-text can be used */
  speechReady: boolean;
  chatThinking: ThinkingLevel;
  suggestThinking: ThinkingLevel;
  wholeVault: boolean;
  autoApply: boolean;
  suggest: boolean;
  suggestDelay: number;
}

export interface AiSettingsPatch {
  /** add a connection, or change the one with that id (`key: null` forgets its key) */
  connection?: { id: string; name?: string; type?: AiProvider; key?: string | null; url?: string };
  removeConnection?: string;
  /** an empty `model` picks the connection's default */
  chatModel?: ModelRef;
  suggestModel?: ModelRef;
  /** `null` turns speech-to-text off; an empty `model` picks `whisper-1` */
  speechModel?: ModelRef | null;
  chatThinking?: ThinkingLevel;
  suggestThinking?: ThinkingLevel;
  wholeVault?: boolean;
  autoApply?: boolean;
  suggest?: boolean;
  suggestDelay?: number;
}

export const DEFAULT_MODELS: Record<AiProvider, { chat: string; suggest: string }> = {
  openrouter: { chat: 'google/gemma-4-31b-it:free', suggest: 'google/gemma-4-31b-it:free' },
  anthropic: { chat: 'claude-sonnet-5-5', suggest: 'claude-haiku-5-5' },
  custom: { chat: 'llama3.2', suggest: 'llama3.2' },
};

export const DEFAULT_SPEECH_MODEL = 'whisper-1';

export const PROVIDER_LABEL: Record<AiProvider, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic', custom: 'Custom server' };

export function defaultAiConfig(): AiConfig {
  return {
    connections: [], chatModel: { connection: '', model: '' }, suggestModel: { connection: '', model: '' }, speechModel: { connection: '', model: '' },
    chatThinking: 'auto', suggestThinking: 'off', wholeVault: false, autoApply: false, suggest: false, suggestDelay: 400,
  };
}

export const isReady = (c: AiConnection | undefined): boolean => !!c && (c.type === 'custom' ? !!c.url : !!c.key);

/** The connection and model a job (the chat or a suggestion) will use, when there is one. */
export function resolveTarget(cfg: AiConfig, job: 'chat' | 'suggest'): { conn: AiConnection; model: string } | null {
  const ref = job === 'chat' ? cfg.chatModel : cfg.suggestModel;
  const conn = cfg.connections.find(c => c.id === ref.connection);
  return conn && ref.model ? { conn, model: ref.model } : null;
}

/** The server and model that turn speech into text, when one is set up and reachable. */
export function speechTarget(cfg: AiConfig): { conn: AiConnection; model: string } | null {
  const conn = cfg.connections.find(c => c.id === cfg.speechModel.connection);
  return conn && conn.type === 'custom' && isReady(conn) && cfg.speechModel.model ? { conn, model: cfg.speechModel.model } : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Read a stored configuration. The first version kept one provider with a key per provider: those become connections,
 * so nothing a person entered is lost.
 */
export function normalizeAiConfig(raw: unknown): AiConfig {
  const base = defaultAiConfig();
  if (!raw || typeof raw !== 'object') return base;
  const j = raw as Record<string, unknown>;
  let connections: AiConnection[] = [];
  if (Array.isArray(j.connections)) {
    for (const c of j.connections as Record<string, unknown>[]) {
      const type = c.type as AiProvider;
      if (!c || !AI_PROVIDERS.includes(type) || !str(c.id)) continue;
      connections.push({ id: str(c.id), name: str(c.name) || PROVIDER_LABEL[type], type, ...(str(c.key) ? { key: str(c.key) } : {}), url: str(c.url) });
    }
  } else {
    const keys = (j.keys && typeof j.keys === 'object' ? j.keys : {}) as Record<string, unknown>;
    for (const p of AI_PROVIDERS) {
      const key = str(keys[p]);
      const url = p === 'custom' ? str(j.customUrl) : '';
      if (key || url) connections.push({ id: p, name: PROVIDER_LABEL[p], type: p, ...(key ? { key } : {}), url });
    }
  }
  const legacyProvider = AI_PROVIDERS.includes(j.provider as AiProvider) ? (j.provider as AiProvider) : 'openrouter';
  const ref = (v: unknown, legacyModel: unknown, fallbackModel: 'chat' | 'suggest'): ModelRef => {
    if (v && typeof v === 'object') {
      const r = v as Record<string, unknown>;
      if (str(r.connection)) return { connection: str(r.connection), model: str(r.model) };
    }
    // legacy: a model name on the selected provider
    const conn = connections.find(c => c.id === legacyProvider) ?? connections[0];
    return conn ? { connection: conn.id, model: str(legacyModel) || DEFAULT_MODELS[conn.type][fallbackModel] } : { connection: '', model: '' };
  };
  const level = (v: unknown, d: ThinkingLevel): ThinkingLevel => (THINKING_LEVELS.includes(v as ThinkingLevel) ? (v as ThinkingLevel) : d);
  const delay = typeof j.suggestDelay === 'number' && j.suggestDelay >= 150 && j.suggestDelay <= 3000 ? Math.round(j.suggestDelay) : base.suggestDelay;
  return {
    connections,
    chatModel: ref(j.chatModel, j.chatModel, 'chat'),
    suggestModel: ref(j.suggestModel, j.suggestModel, 'suggest'),
    speechModel: j.speechModel && typeof j.speechModel === 'object' && str((j.speechModel as Record<string, unknown>).connection)
      ? { connection: str((j.speechModel as Record<string, unknown>).connection), model: str((j.speechModel as Record<string, unknown>).model) || DEFAULT_SPEECH_MODEL }
      : { connection: '', model: '' },
    chatThinking: level(j.chatThinking, base.chatThinking),
    suggestThinking: level(j.suggestThinking, base.suggestThinking),
    wholeVault: j.wholeVault === true,
    autoApply: j.autoApply === true,
    suggest: j.suggest === true,
    suggestDelay: delay,
  };
}

/** One model a provider offers, for the picker in the settings. Only `id` is always known. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** context window, tokens */
  context?: number;
  free?: boolean;
  /** can call tools (needed for the assistant to edit notes) */
  tools?: boolean;
  /** can think before answering */
  thinking?: boolean;
}

/** A thought of the model that has to be sent back with its answer (Anthropic checks the signature). */
export interface AiThinkingBlock { text: string; signature?: string; redacted?: string }

export interface AiToolCall { id: string; name: string; args: Record<string, unknown> }

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[]; thinking?: AiThinkingBlock[] }
  | { role: 'tool'; callId: string; name: string; content: string };

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the arguments */
  parameters: Record<string, unknown>;
}

export interface AiRequest {
  /** which of the two configured models to use */
  model: 'chat' | 'suggest';
  system?: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  maxTokens?: number;
  temperature?: number;
}

export type AiEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: AiToolCall }
  /** a piece of the model's thinking, to show while it works */
  | { type: 'thinking'; delta: string }
  /** a finished thought, kept with the answer so it can be sent back */
  | { type: 'thinking_block'; block: AiThinkingBlock }
  | { type: 'usage'; input: number; output: number }
  /** the provider is busy; the request is being tried again */
  | { type: 'notice'; text: string }
  | { type: 'done' };

/** Anything that turns a request into a stream of events: a direct call to the provider, or the Server peer's proxy. */
export type AiTransport = (req: AiRequest, signal?: AbortSignal) => AsyncIterable<AiEvent>;

export function toSettings(c: AiConfig): AiSettings {
  return {
    connections: c.connections.map(x => ({ id: x.id, name: x.name, type: x.type, url: x.url, keyHint: x.key ? x.key.slice(-4) : null, ready: isReady(x) })),
    chatModel: c.chatModel, suggestModel: c.suggestModel,
    chatReady: !!resolveTarget(c, 'chat') && isReady(c.connections.find(x => x.id === c.chatModel.connection)),
    suggestReady: !!resolveTarget(c, 'suggest') && isReady(c.connections.find(x => x.id === c.suggestModel.connection)),
    speechModel: c.speechModel, speechReady: speechTarget(c) !== null,
    chatThinking: c.chatThinking, suggestThinking: c.suggestThinking, wholeVault: c.wholeVault, autoApply: c.autoApply,
    suggest: c.suggest, suggestDelay: c.suggestDelay,
  };
}

const validUrl = (u: string): boolean => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

/** Merge a patch into a config. Throws a sentence a person can read when a value cannot be used. */
export function applyAiPatch(c: AiConfig, p: AiSettingsPatch): AiConfig {
  const next: AiConfig = { ...c, connections: c.connections.map(x => ({ ...x })) };
  const p1 = p.connection;
  if (p1) {
    if (!p1.id || typeof p1.id !== 'string') throw new Error('A connection needs an id.');
    let conn = next.connections.find(x => x.id === p1.id);
    if (!conn) {
      if (!p1.type || !AI_PROVIDERS.includes(p1.type)) throw new Error('Choose what kind of connection this is.');
      conn = { id: p1.id, name: PROVIDER_LABEL[p1.type], type: p1.type, url: '' };
      next.connections.push(conn);
    } else if (p1.type && p1.type !== conn.type) throw new Error('The kind of a connection cannot be changed. Add a new one.');
    if (typeof p1.name === 'string' && p1.name.trim()) conn.name = p1.name.trim().slice(0, 60);
    if (p1.key === null || (typeof p1.key === 'string' && p1.key.trim() === '')) delete conn.key;
    else if (typeof p1.key === 'string') conn.key = p1.key.trim();
    if (typeof p1.url === 'string') {
      const u = p1.url.trim();
      if (u && !validUrl(u)) throw new Error('The server address must start with http:// or https://');
      conn.url = u;
    }
    // the first connection becomes the model of both jobs, so the assistant works as soon as one exists
    if (!next.connections.some(x => x.id === next.chatModel.connection)) next.chatModel = { connection: conn.id, model: DEFAULT_MODELS[conn.type].chat };
    if (!next.connections.some(x => x.id === next.suggestModel.connection)) next.suggestModel = { connection: conn.id, model: DEFAULT_MODELS[conn.type].suggest };
  }
  if (p.removeConnection) {
    next.connections = next.connections.filter(x => x.id !== p.removeConnection);
    const first = next.connections[0];
    const fix = (r: ModelRef, job: 'chat' | 'suggest'): ModelRef =>
      next.connections.some(x => x.id === r.connection) ? r : first ? { connection: first.id, model: DEFAULT_MODELS[first.type][job] } : { connection: '', model: '' };
    next.chatModel = fix(next.chatModel, 'chat');
    next.suggestModel = fix(next.suggestModel, 'suggest');
    if (next.speechModel.connection === p.removeConnection) next.speechModel = { connection: '', model: '' };
  }
  if (p.speechModel === null) next.speechModel = { connection: '', model: '' };
  else if (p.speechModel) {
    const conn = next.connections.find(x => x.id === p.speechModel!.connection);
    if (!conn) throw new Error('That connection no longer exists.');
    if (conn.type !== 'custom') throw new Error('Speech-to-text needs a custom server (OpenAI, Groq, a local Whisper server…): OpenRouter and Anthropic have no transcription endpoint.');
    next.speechModel = { connection: conn.id, model: p.speechModel.model.trim() || DEFAULT_SPEECH_MODEL };
  }
  const pick = (r: ModelRef | undefined, job: 'chat' | 'suggest'): ModelRef | null => {
    if (!r) return null;
    const conn = next.connections.find(x => x.id === r.connection);
    if (!conn) throw new Error('That connection no longer exists.');
    return { connection: conn.id, model: r.model.trim() || DEFAULT_MODELS[conn.type][job] };
  };
  next.chatModel = pick(p.chatModel, 'chat') ?? next.chatModel;
  next.suggestModel = pick(p.suggestModel, 'suggest') ?? next.suggestModel;
  if (p.chatThinking && THINKING_LEVELS.includes(p.chatThinking)) next.chatThinking = p.chatThinking;
  if (p.suggestThinking && THINKING_LEVELS.includes(p.suggestThinking)) next.suggestThinking = p.suggestThinking;
  if (typeof p.wholeVault === 'boolean') next.wholeVault = p.wholeVault;
  if (typeof p.autoApply === 'boolean') next.autoApply = p.autoApply;
  if (typeof p.suggest === 'boolean') next.suggest = p.suggest;
  if (typeof p.suggestDelay === 'number' && Number.isFinite(p.suggestDelay)) next.suggestDelay = Math.min(3000, Math.max(150, Math.round(p.suggestDelay)));
  return next;
}
