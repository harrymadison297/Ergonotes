// The desktop app's MCP endpoint, webview side (ADR 0015). The shell (apps/desktop/src-tauri/src/mcp.rs) listens on a local
// port and checks who is asking; it hands each JSON-RPC message to `startMcpBridge`, which answers it with the open vault.
// The rest is what the Settings page needs: the endpoint's state and its tokens.
import { invoke } from '@tauri-apps/api/core';
import { handleRpc, type McpVault, type Vault } from '@ergonotes/core';
import { useSyncExternalStore } from 'react';

/** The installed apps for a computer (not a phone, not a browser): the ones that run the endpoint. */
export const isDesktopApp = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent);

export interface McpToken { id: string; name: string; token: string; created: number; lastUsed: number | null }
export interface McpStatus { state: 'off' | 'running' | 'error'; url: string | null; error: string | null }
export interface McpInfo {
  enabled: boolean; port: number; path: string; lan: boolean; closeToTray: boolean; trayOk: boolean;
  status: McpStatus; tokens: McpToken[]; discoveryFile: string | null;
}

// ---------------------------------------------------------------- answering the agents

export async function startMcpBridge(vault: Vault, fetchImpl?: typeof fetch): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const { createDrawingTools } = await import('../editor/drawingTools');
  const extraTools = createDrawingTools(vault as McpVault, fetchImpl);
  await listen<{ id: number; body: string }>('mcp-request', async e => {
    const { id, body } = e.payload;
    let status = 200, out = '';
    try {
      const msg = JSON.parse(body) as unknown;
      const batch = Array.isArray(msg);
      const answers = (await Promise.all((batch ? msg : [msg]).map(m => handleRpc(vault as McpVault, m as Record<string, unknown>, { extraTools })))).filter(Boolean);
      if (answers.length === 0) status = 202; else out = JSON.stringify(batch ? answers : answers[0]);
    } catch (err) {
      const bad = err instanceof SyntaxError;
      status = bad ? 400 : 500;
      out = JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: bad ? -32700 : -32603, message: bad ? 'Parse error' : 'Internal error' } });
    }
    await invoke('mcp_respond', { id, status, body: out }).catch(() => undefined);
  });
  await invoke('mcp_ready', { ready: true });
  window.addEventListener('beforeunload', () => { void invoke('mcp_ready', { ready: false }); });
}

// ---------------------------------------------------------------- the settings

let info: McpInfo | null = null;
const listeners = new Set<() => void>();
const set = (i: McpInfo) => { info = i; for (const l of listeners) l(); return i; };

export async function refreshMcp(): Promise<McpInfo | null> {
  if (!isDesktopApp()) return null;
  try { return set(await invoke<McpInfo>('mcp_get')); } catch { return info; }
}

let watching = false;
function watch() {
  if (watching || !isDesktopApp()) return;
  watching = true;
  void refreshMcp();
  void import('@tauri-apps/api/event').then(({ listen }) => listen('mcp-status', () => { void refreshMcp(); }));
}

/** The endpoint's state, kept current while the app runs. `null` where the app has no endpoint. */
export function useMcpInfo(): McpInfo | null {
  watch();
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => info);
}

export const mcpConfigure = async (patch: Partial<Pick<McpInfo, 'enabled' | 'port' | 'path' | 'lan' | 'closeToTray'>>) => set(await invoke<McpInfo>('mcp_configure', { patch }));
export const mcpTokenCreate = async (name: string) => set(await invoke<McpInfo>('mcp_token_create', { name }));
export const mcpTokenSet = async (id: string, value: string) => set(await invoke<McpInfo>('mcp_token_set', { id, value }));
export const mcpTokenRegenerate = async (id: string) => set(await invoke<McpInfo>('mcp_token_regenerate', { id }));
export const mcpTokenRevoke = async (id: string) => set(await invoke<McpInfo>('mcp_token_revoke', { id }));
export const autostartGet = () => invoke<boolean>('desktop_autostart_get');
export const autostartSet = (on: boolean) => invoke<boolean>('desktop_autostart_set', { on });

/** True when the endpoint is switched on but cannot run (the port is taken): Settings shows a red dot. */
export const mcpNeedsAttention = (i: McpInfo | null): boolean => !!i && i.enabled && i.status.state === 'error';
