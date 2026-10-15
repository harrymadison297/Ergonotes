// Shared shapes for the AI features: provider configuration, the chat protocol and the stream of events.
/** `custom`: a server that speaks the OpenAI chat API: Ollama, LM Studio, vLLM, LiteLLM… */
export type AiProvider = 'openrouter' | 'anthropic' | 'custom';
export const AI_PROVIDERS: readonly AiProvider[] = ['openrouter', 'anthropic', 'custom'];

/** How much a model may think before it answers. `auto` sends nothing: the model's own default. */
export type ThinkingLevel = 'auto' | 'off' | 'low' | 'medium' | 'high';
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['auto', 'off', 'low', 'medium', 'high'];

/** What is stored in the vault (encrypted, synced). Keys never leave a device that holds the vault, except to the provider. */
export interface AiConfig {
  provider: AiProvider;
  keys: Partial<Record<AiProvider, string>>;
  /** address of the custom server, e.g. http://localhost:11434 or https://host/v1 */
  customUrl: string;
  chatModel: string;
  suggestModel: string;
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

/** What a client may see: the same without the key. */
export interface AiSettings {
  provider: AiProvider;
  /** ready to use: a key is saved (or, for a custom server, an address is set: its key is optional) */
  hasKey: boolean;
  customUrl: string;
  /** last characters of the saved key, for recognising it in the settings page */
  keyHint: string | null;
  chatModel: string;
  suggestModel: string;
  chatThinking: ThinkingLevel;
  suggestThinking: ThinkingLevel;
  wholeVault: boolean;
  autoApply: boolean;
  suggest: boolean;
  suggestDelay: number;
}

export interface AiSettingsPatch {
  provider?: AiProvider;
  /** `null` forgets the key of that provider */
  keys?: Partial<Record<AiProvider, string | null>>;
  customUrl?: string;
  chatModel?: string;
  suggestModel?: string;
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

export function defaultAiConfig(): AiConfig {
  return { provider: 'openrouter', keys: {}, customUrl: '', chatModel: DEFAULT_MODELS.openrouter.chat, suggestModel: DEFAULT_MODELS.openrouter.suggest, chatThinking: 'auto', suggestThinking: 'off', wholeVault: false, autoApply: false, suggest: false, suggestDelay: 400 };
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
  const key = c.keys[c.provider];
  return {
    provider: c.provider, hasKey: c.provider === 'custom' ? !!c.customUrl : !!key, keyHint: key ? key.slice(-4) : null, customUrl: c.customUrl,
    chatModel: c.chatModel, suggestModel: c.suggestModel, chatThinking: c.chatThinking, suggestThinking: c.suggestThinking, wholeVault: c.wholeVault, autoApply: c.autoApply,
    suggest: c.suggest, suggestDelay: c.suggestDelay,
  };
}

/** Merge a patch into a config; switching provider swaps the models that were still the old provider's defaults. */
export function applyAiPatch(c: AiConfig, p: AiSettingsPatch): AiConfig {
  const next: AiConfig = { ...c, keys: { ...c.keys } };
  if (p.provider && AI_PROVIDERS.includes(p.provider) && p.provider !== c.provider) {
    next.provider = p.provider;
    const old = DEFAULT_MODELS[c.provider], now = DEFAULT_MODELS[p.provider];
    if (next.chatModel === old.chat) next.chatModel = now.chat;
    if (next.suggestModel === old.suggest) next.suggestModel = now.suggest;
  }
  for (const [prov, k] of Object.entries(p.keys ?? {}) as [AiProvider, string | null | undefined][]) {
    if (!AI_PROVIDERS.includes(prov) || k === undefined) continue;
    if (k === null || k.trim() === '') delete next.keys[prov]; else next.keys[prov] = k.trim();
  }
  if (typeof p.customUrl === 'string') {
    const u = p.customUrl.trim();
    if (u) {
      let ok = false;
      try { ok = /^https?:$/.test(new URL(u).protocol); } catch { /* not a URL */ }
      if (!ok) throw new Error('The server address must start with http:// or https://');
    }
    next.customUrl = u;
  }
  if (typeof p.chatModel === 'string' && p.chatModel.trim()) next.chatModel = p.chatModel.trim();
  if (typeof p.suggestModel === 'string' && p.suggestModel.trim()) next.suggestModel = p.suggestModel.trim();
  if (p.chatThinking && THINKING_LEVELS.includes(p.chatThinking)) next.chatThinking = p.chatThinking;
  if (p.suggestThinking && THINKING_LEVELS.includes(p.suggestThinking)) next.suggestThinking = p.suggestThinking;
  if (typeof p.wholeVault === 'boolean') next.wholeVault = p.wholeVault;
  if (typeof p.autoApply === 'boolean') next.autoApply = p.autoApply;
  if (typeof p.suggest === 'boolean') next.suggest = p.suggest;
  if (typeof p.suggestDelay === 'number' && Number.isFinite(p.suggestDelay)) next.suggestDelay = Math.min(3000, Math.max(150, Math.round(p.suggestDelay)));
  return next;
}
