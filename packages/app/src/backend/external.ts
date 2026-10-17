// Files outside the vault, opened with "Open with Ergonotes": read and written as they are (installed desktop app only).
import { invoke } from '@tauri-apps/api/core';

export const canOpenExternal = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !window.ErgoVault;

export interface ExternalText { text: string; mtime: number; size: number; bom: boolean; crlf: boolean }

export const extRead = (path: string): Promise<ExternalText> => invoke<ExternalText>('ext_read', { path });
export const extWrite = (path: string, text: string, o: { bom: boolean; crlf: boolean; expected: number | null; force?: boolean }): Promise<number> =>
  invoke<number>('ext_write', { path, text, bom: o.bom, crlf: o.crlf, expected: o.expected, force: !!o.force });
export const extStat = (path: string): Promise<{ kind: string; size: number; mtime: number } | null> => invoke('ext_stat', { path });
export const extReveal = (path: string): Promise<void> => invoke('ext_reveal', { path });

export async function extReadBeside(doc: string, rel: string): Promise<Uint8Array | null> {
  try { return new Uint8Array(await invoke<ArrayBuffer>('ext_read_beside', { doc, rel })); } catch { return null; }
}
export async function extWriteBeside(doc: string, rel: string, bytes: Uint8Array): Promise<void> {
  await invoke('ext_write_beside', bytes, { headers: { 'x-doc': encodeURIComponent(doc), 'x-rel': encodeURIComponent(rel) } });
}

/** Paths the system asked the app to open that nobody has taken yet. */
export const openWithTake = (): Promise<string[]> => invoke<string[]>('open_with_take');

/** Called when another start of the app handed it more files; the callback should then `openWithTake()`. */
export async function onOpenWith(cb: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen('open-with', cb);
}
