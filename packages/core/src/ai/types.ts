// Shared shapes for the AI features: provider configuration, the chat protocol and the stream of events.
export type AiProvider = 'openrouter' | 'anthropic';
export const AI_PROVIDERS: readonly AiProvider[] = ['openrouter', 'anthropic'];

/** What is stored in the vault (encrypted, synced). Keys never leave a device that holds the vault, except to the provider. */
export interface AiConfig {
  provider: AiProvider;
  keys: Partial<Record<AiProvider, string>>;
  chatModel: string;
  suggestModel: string;
  /** the chat may search and read the whole vault, not only the open note */
  wholeVault: boolean;
  /** apply the agent's edits at once instead of asking first */
  autoApply: boolean;
}

/** What a client may see: the same without the key. */
export interface AiSettings {
  provider: AiProvider;
  /** a key is saved for the selected provider */
  hasKey: boolean;
  /** last characters of the saved key, for recognising it in the settings page */
  keyHint: string | null;
  chatModel: string;
  suggestModel: string;
  wholeVault: boolean;
  autoApply: boolean;
}

export interface AiSettingsPatch {
  provider?: AiProvider;
  /** `null` forgets the key of that provider */
  keys?: Partial<Record<AiProvider, string | null>>;
  chatModel?: string;
  suggestModel?: string;
  wholeVault?: boolean;
  autoApply?: boolean;
}

export const DEFAULT_MODELS: Record<AiProvider, { chat: string; suggest: string }> = {
  openrouter: { chat: 'google/gemma-4-31b-it:free', suggest: 'google/gemma-4-31b-it:free' },
  anthropic: { chat: 'claude-sonnet-5-5', suggest: 'claude-haiku-5-5' },
};

export function defaultAiConfig(): AiConfig {
  return { provider: 'openrouter', keys: {}, chatModel: DEFAULT_MODELS.openrouter.chat, suggestModel: DEFAULT_MODELS.openrouter.suggest, wholeVault: false, autoApply: false };
}

export interface AiToolCall { id: string; name: string; args: Record<string, unknown> }

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AiToolCall[] }
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
  | { type: 'usage'; input: number; output: number }
  | { type: 'done' };

/** Anything that turns a request into a stream of events: a direct call to the provider, or the Server peer's proxy. */
export type AiTransport = (req: AiRequest, signal?: AbortSignal) => AsyncIterable<AiEvent>;

export function toSettings(c: AiConfig): AiSettings {
  const key = c.keys[c.provider];
  return {
    provider: c.provider, hasKey: !!key, keyHint: key ? key.slice(-4) : null,
    chatModel: c.chatModel, suggestModel: c.suggestModel, wholeVault: c.wholeVault, autoApply: c.autoApply,
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
  if (typeof p.chatModel === 'string' && p.chatModel.trim()) next.chatModel = p.chatModel.trim();
  if (typeof p.suggestModel === 'string' && p.suggestModel.trim()) next.suggestModel = p.suggestModel.trim();
  if (typeof p.wholeVault === 'boolean') next.wholeVault = p.wholeVault;
  if (typeof p.autoApply === 'boolean') next.autoApply = p.autoApply;
  return next;
}
