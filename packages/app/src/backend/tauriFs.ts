// The vault folder of the installed apps: the shell's `vault_*` commands (apps/desktop/src-tauri/src/lib.rs),
// all confined to the folder the person chose.
import { invoke } from '@tauri-apps/api/core';
import { fromB64, toB64, type FsEntry, type FsStat, type LocalMeta, type VaultFs } from '@ergonotes/core';

export class TauriFs implements VaultFs {
  readonly durable = true;
  readdir(dir: string): Promise<FsEntry[]> { return invoke<FsEntry[]>('vault_readdir', { dir }); }
  async read(path: string): Promise<Uint8Array | null> {
    try { return new Uint8Array(await invoke<ArrayBuffer>('vault_read', { path })); } catch { return null; }
  }
  async write(path: string, data: Uint8Array | string, o: { private?: boolean } = {}): Promise<void> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await invoke('vault_write', bytes, { headers: { 'x-path': encodeURIComponent(path), 'x-private': o.private ? '1' : '0' } });
  }
  async remove(path: string): Promise<void> { await invoke('vault_remove', { path }); }
  async rename(from: string, to: string): Promise<void> { await invoke('vault_rename', { from, to }); }
  async mkdir(path: string): Promise<void> { await invoke('vault_mkdir', { path }); }
  async stat(path: string): Promise<FsStat | null> {
    if (path === '') return (await this.readdir('').then(() => ({ kind: 'dir', size: 0, mtime: 0 }) as FsStat).catch(() => null));
    return invoke<FsStat | null>('vault_stat', { path });
  }
}

/** The desktop app can show a vault file in the system's file manager. */
export const canRevealInFolder = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && !/Android/i.test(navigator.userAgent);
export const revealInFolder = (path: string): Promise<void> => invoke('vault_reveal', { path });

/** The device's own settings: next to the app's, never in the vault folder. */
export const deviceMetaFor = (key?: string): LocalMeta => ({
  async load() { return JSON.parse(await invoke<string>('device_meta_load', { key })) as Record<string, unknown>; },
  async save(meta) { await invoke('device_meta_save', { json: JSON.stringify(meta), key }); },
});

// ---------------------------------------------------------------- Android: a folder chosen with the system's chooser
interface ErgoVaultBridge {
  root(): string; defaultDir(): string; pick(): void; list(dir: string): string; stat(path: string): string | null; read(path: string): string | null;
  write(path: string, b64: string): string; mkdir(path: string): string; remove(path: string): string; rename(from: string, to: string): string;
}
declare global { interface Window { ErgoVault?: ErgoVaultBridge } }

class SafFs implements VaultFs {
  readonly durable = true;
  private b: ErgoVaultBridge;
  constructor(b: ErgoVaultBridge) { this.b = b; }
  private ok(err: string) { if (err) throw new Error(err); }
  async readdir(dir: string): Promise<FsEntry[]> { return JSON.parse(this.b.list(dir)) as FsEntry[]; }
  // a Kotlin `null` string reaches the page as `null` or as `undefined`, depending on the WebView: both mean "not there"
  async read(path: string): Promise<Uint8Array | null> { const s = this.b.read(path); return s == null ? null : fromB64(s); }
  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.ok(this.b.write(path, toB64(typeof data === 'string' ? new TextEncoder().encode(data) : data)));
  }
  async remove(path: string): Promise<void> { this.ok(this.b.remove(path)); }
  async rename(from: string, to: string): Promise<void> { this.ok(this.b.rename(from, to)); }
  async mkdir(path: string): Promise<void> { this.ok(this.b.mkdir(path)); }
  async stat(path: string): Promise<FsStat | null> { const s = this.b.stat(path); return s == null ? null : (JSON.parse(s) as FsStat); }
}

/** `content://…/tree/primary%3ADocuments%2FNotes` as `Internal storage / Documents / Notes`. */
function treeLabel(tree: string): string {
  const id = decodeURIComponent(tree.split('/tree/')[1] ?? tree);
  const [vol, rest = ''] = id.split(':');
  return [vol === 'primary' ? 'Internal storage' : vol, ...rest.split('/').filter(Boolean)].join(' / ');
}

export interface VaultFolder {
  /** the folder the notes live in */
  path: string;
  /** a native folder chooser is available (not on phones) */
  canPick: boolean;
  /** pick a folder and make it the vault; the app reloads to open it */
  change(): Promise<void>;
  /** make this full path the vault (created when missing); the app reloads to open it */
  use(path: string): Promise<void>;
}

export async function tauriFolder(): Promise<{ fs: VaultFs; folder: VaultFolder; meta: LocalMeta }> {
  const saf = typeof window !== 'undefined' ? window.ErgoVault : undefined;
  const pick = saf
    ? () => new Promise<void>(resolve => {
      window.addEventListener('ergo-vault-picked', e => { if ((e as CustomEvent<{ ok: boolean }>).detail.ok) window.location.reload(); resolve(); }, { once: true });
      saf.pick();
    })
    : undefined;
  const tree = saf?.root();
  if (saf && tree) {
    return {
      fs: new SafFs(saf), meta: deviceMetaFor(tree),
      folder: { path: treeLabel(tree), canPick: true, use: async () => undefined, change: pick! },
    };
  }
  let path = await invoke<string | null>('vault_root');
  if (!path) path = await invoke<string>('vault_set_root', { path: saf ? saf.defaultDir() : await invoke<string>('vault_default_dir') });
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const use = async (p: string) => { await invoke('vault_set_root', { path: p }); window.location.reload(); };
  return {
    fs: new TauriFs(), meta: deviceMetaFor(),
    folder: {
      path,
      canPick: !mobile || !!pick,
      use,
      change: pick ?? (async () => {
        const p = await invoke<string | null>('vault_pick_folder');
        if (p) await use(p);
      }),
    },
  };
}
