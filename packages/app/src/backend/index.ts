import { listModels, streamChat, Vault, VAULT_METHODS, type AiEvent, type AiTransport, type ModelInfo, type VaultApi, type VaultEvent, type VaultStatus } from '@ergonotes/core';
import { IdbPersist } from '@ergonotes/core/browser';

export interface Backend {
  api: VaultApi;
  /** subscribe to vault events (items changed, status changed) */
  onEvent(fn: (e: VaultEvent) => void): () => void;
  mode: 'local' | 'remote';
  /** how the chat and the suggestions reach the AI provider: directly, or through the server that holds the key */
  aiTransport: AiTransport;
  /** the model names the provider offers */
  aiModels(): Promise<ModelInfo[]>;
  /** called once the vault is ready (starts sync timers in local mode) */
  start(): void;
}

// ---------------------------------------------------------------- remote (web build served by the Server peer)
class HttpBackend implements Backend {
  mode = 'remote' as const;
  private listeners = new Set<(e: VaultEvent) => void>();
  private es: EventSource | null = null;
  api: VaultApi;

  aiModels = async (): Promise<ModelInfo[]> => {
    const r = await fetch('./api/ai/models', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
    const b = await r.json().catch(() => null) as { models?: ModelInfo[]; error?: string } | null;
    if (!r.ok) throw new Error(b?.error ?? `Request failed (${r.status})`);
    return b?.models ?? [];
  };

  /** The server calls the provider with the key it holds and streams the events back as one JSON object per line. */
  aiTransport: AiTransport = async function* (req, signal) {
    const r = await fetch('./api/ai/stream', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(req),
    });
    if (!r.ok || !r.body) {
      const body = await r.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `Request failed (${r.status})`);
    }
    const reader = r.body.getReader();
    const td = new TextDecoder();
    let buf = '';
    const parse = function* (line: string): Generator<AiEvent> {
      if (!line.trim()) return;
      const e = JSON.parse(line) as AiEvent | { type: 'error'; message: string };
      if (e.type === 'error') throw new Error(e.message);
      yield e;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); yield* parse(line); }
      }
      yield* parse(buf);
    } finally { reader.releaseLock(); }
  };

  constructor() {
    const call = async (method: string, args: unknown[]) => {
      const r = await fetch(`./api/rpc/${method}`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(args),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const err = new Error((body as { error?: string } | null)?.error ?? `Request failed (${r.status})`);
        (err as Error & { status?: number }).status = r.status;
        if (r.status === 401) this.emit({ type: 'status' });
        throw err;
      }
      return body;
    };
    this.api = Object.fromEntries(VAULT_METHODS.map(m => [m, (...args: unknown[]) => call(m, args)])) as unknown as VaultApi;
  }

  private emit(e: VaultEvent) { for (const l of this.listeners) l(e); }

  onEvent(fn: (e: VaultEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.es) return;
    this.es = new EventSource('./api/events');
    this.es.onmessage = m => { try { this.emit(JSON.parse(m.data) as VaultEvent); } catch { /* ignore */ } };
  }
}

// ---------------------------------------------------------------- local (Tauri shells, offline-first)
class LocalBackend implements Backend {
  mode = 'local' as const;
  api: VaultApi;
  private vault: Vault;
  private started = false;
  aiTransport: AiTransport;
  aiModels: () => Promise<ModelInfo[]>;

  constructor(vault: Vault, fetchImpl?: typeof fetch) {
    this.vault = vault;
    this.aiTransport = (req, signal) => streamChat(vault.aiConfig(), req, { fetchImpl, signal });
    this.aiModels = () => listModels(vault.aiConfig(), { fetchImpl });
    this.api = vault;
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void vault.flush();
      // coming back to the app (or switching device): look for news at once instead of waiting for the timer
      else if (this.started) void vault.sync();
    });
    window.addEventListener('pagehide', () => { void vault.flush(); });
  }

  onEvent(fn: (e: VaultEvent) => void) { return this.vault.onEvent(fn); }

  start() {
    if (this.started) return;
    this.started = true;
    this.vault.startAutoSync();
  }
}

export async function createBackend(): Promise<Backend> {
  const inTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
  if (!inTauri) {
    try {
      const r = await fetch('./api/status', { credentials: 'same-origin' });
      const ct = r.headers.get('content-type') ?? '';
      if (r.ok && ct.includes('application/json')) {
        const st = (await r.json()) as VaultStatus;
        if (st.remote) return new HttpBackend();
      }
    } catch { /* no server: run on-device */ }
  }
  const fetchImpl = await tauriFetch();
  const vault = await Vault.open({ persist: new IdbPersist(), fetchImpl, defaultDeviceName: guessDeviceName() });
  return new LocalBackend(vault, fetchImpl);
}

/** Inside Tauri, S3/WebDAV requests go through the Rust HTTP plugin so storage endpoints need no CORS setup. */
async function tauriFetch(): Promise<typeof fetch | undefined> {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;
  try {
    const mod = await import(/* @vite-ignore */ '@tauri-apps/plugin-http');
    return mod.fetch as unknown as typeof fetch;
  } catch { return undefined; }
}

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android phone';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'This device';
}
