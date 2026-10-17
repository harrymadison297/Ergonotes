// The Vault: the domain layer over a folder of Markdown files (ADR 0010). The files are the notes; the Replica is
// the derived layer that gives them history, merging and sync (ADR 0001, 0003). Everything the UI can do goes
// through the VaultApi implemented here.
import MarkdownIt from 'markdown-it';
import MiniSearch from 'minisearch';
import type {
  CalendarData, ChatRecord, ChatSummary, ConflictChoice, ConflictDetail, EventEntry, ExportResult, FileBlob, FileInfo, HeadInfo, ImportFile, ImportResult, ItemSummary, NoteDoc, RecordInfo, SearchHit,
  Settings, StoreConfig, SyncReport, TaskEntry, VaultApi, VaultState, VaultStatus, VersionInfo,
} from './api.ts';
import {
  DEFAULT_KDF, Sealer, WrongPasswordError, checkPassword, createPasswordlessVaultFile, createVaultFile, hasPassword, unwrapMasterKey, wrapMasterKey,
  type VaultFile,
} from './crypto.ts';
import {
  basename, buildLinkIndex, dirname, editFm, extOf, findLinks, folderIdOf, isBelow, isNotePath, joinPath, normalizePath, parseNote, relativePath, reservedOf,
  resolveLink, rewriteLinks, safeName, setReserved, stripExt, stripReserved, titleOfPath, toFileText, toItemText, uniquePath, withBody,
  type LinkIndex, type LinkRef,
} from './folder.ts';
import {
  firstImage, joinDoc, parseEvents, parseTasks, plainSnippet, setTaskDone,
  type Frontmatter, type NoteEvent, type Task,
} from './markdown.ts';
import { applyAiPatch, defaultAiConfig, normalizeAiConfig, toSettings, type AiConfig, type AiSettings, type AiSettingsPatch } from './ai/types.ts';
import { baseText, unionText } from './merge.ts';
import { fmtMark, frameSecond, isPartName, isRecordDir, parseRecordMeta, parseTranscript, recordDirOf, type RecordMeta } from './record.ts';
import { recordDirsIn } from './recordlink.ts';
import type { Persist } from './persist.ts';
import { Replica, type SyncContext } from './replica.ts';
import type { Store } from './store.ts';
import { S3Store } from './store-s3.ts';
import { WebDavStore } from './store-webdav.ts';
import { DAY, MIN, dec, enc, fromB64, newId, sha256hex, toB64 } from './util.ts';
import { MemFs, type VaultFs } from './vaultfs.ts';

/** The single item that carries the AI provider settings (encrypted and synced like any other item, never listed). */
export const AI_CONFIG_ID = '00000000-0000-4000-8000-0000000a1c01';

export interface VaultOptions {
  persist: Persist;
  /** The vault folder. Omitted: an empty folder in memory (tests). */
  fs?: VaultFs;
  /** build a Store for configs the core cannot handle itself (folder stores in Node) */
  storeFactory?: (cfg: StoreConfig) => Promise<Store> | Store;
  fetchImpl?: typeof fetch;
  kdf?: { m: number; t: number; p: number };
  now?: () => number;
  defaultDeviceName?: string;
  /** A file changed less than this long ago is read on a later scan: another editor may still be writing it. */
  settleMs?: number;
  /** How often the folder is looked at for changes made outside the app (0: only on `rescan()`). */
  watchMs?: number;
  /** A folder with more files than this is read only in part and the person is told. */
  maxFiles?: number;
  /** ADR 0012: this Device may keep a vault with no password (desktop and Android; not the Server peer or the web). */
  passwordOptional?: boolean;
  /** Open the vault before the folder has been read (the interface shows the progress). Off: opening waits for the first look. */
  backgroundScan?: boolean;
}

interface View {
  id: string;
  type: 'note' | 'folder';
  /** the person's own frontmatter properties */
  fm: Frontmatter;
  title: string;
  /** where the file is (for a folder, the directory), relative to the vault folder */
  path: string;
  parent: string | null;
  tags: string[];
  created: string;
  updated: string;
  trashed: string | null;
  /** the folder that was moved to the Trash with this note (restoring that folder brings it back) */
  trashDir: string | null;
  pinned: boolean;
  template: boolean;
  private: boolean;
  role: string | null;
  daily: string | null;
  body: string;
  snippet: string;
  thumb: string | null;
  tasks: Task[];
  events: NoteEvent[];
  linkRefs: LinkRef[];
}

interface IndexEntry {
  id: string; kind: 'note' | 'file'; size: number; mtime: number; hash: string;
  /** the item's head commit when the file was last written or read: the base of an edit made outside */
  commit?: string;
}

export type VaultEvent = { type: 'items'; ids: string[] } | { type: 'status' };

/** Decoded size of a base64 string (whitespace ignored). */
const b64Bytes = (b64: string): number => {
  const s = b64.replace(/\s+/g, '');
  return Math.floor((s.length * 3) / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
};

const TRASH_DAYS = 30;
const MAX_SEARCH_HITS = 40;
const PUSH_DEBOUNCE_MS = 5 * MIN;
const PULL_EVERY_MS = 45_000;
const MAX_ATTACHMENT = 100 * 1024 * 1024;
const MAX_NOTE_BYTES = 8 * 1024 * 1024;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });
const TRASH_DIR = '.trash';
const ATTACH_DIR = 'attachments';
const ATTACH_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.heic', '.ico', '.pdf', '.mp3', '.m4a', '.wav', '.ogg', '.oga', '.opus', '.flac',
  '.webm', '.mp4', '.m4v', '.mov', '.mkv', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.csv', '.zip', '.txt', '.json', '.epub',
]);
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.heic': 'image/heic', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm', '.mp4': 'video/mp4',
  '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.csv': 'text/csv', '.txt': 'text/plain', '.json': 'application/json',
  '.zip': 'application/zip', '.epub': 'application/epub+zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
/** `.txt` and `.json` are kept as attachments only inside a record folder (its transcript and its list); elsewhere they are the person's own files. */
const SCAN_ONLY_IN_RECORD = new Set(['.txt', '.json']);
const attachable = (path: string): boolean => {
  const ext = extOf(path);
  return ATTACH_EXT.has(ext) && (!SCAN_ONLY_IN_RECORD.has(ext) || recordDirOf(path) !== null);
};
const IGNORED_NAMES = new Set(['node_modules', 'Thumbs.db', 'desktop.ini']);

const DEFAULT_FOLDERS = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archive', 'Templates'];
const ROLES: Record<string, string> = { inbox: 'inbox', projects: 'projects', areas: 'areas', resources: 'resources', archive: 'archive', templates: 'templates' };

const DEFAULT_TEMPLATES: { title: string; body: string; daily?: boolean; tags?: string[] }[] = [
  { title: 'Meeting notes', tags: ['meeting'], body: '**Date:** {{date}} {{time}}\n**Attendees:**\n\n## Agenda\n\n- \n\n## Notes\n\n## Action items\n\n- [ ] \n' },
  { title: 'Daily note', daily: true, body: '## Plan\n\n- [ ] \n\n## Notes\n\n{{cursor}}\n\n## Done today\n\n' },
  { title: 'Project plan', tags: ['project'], body: '## Goal\n\n{{cursor}}\n\n## Milestones\n\n- [ ] \n\n## Risks\n\n## Links\n\n' },
  { title: 'Reading note', tags: ['reading'], body: '**Source:**\n**Author:**\n\n## Summary\n\n{{cursor}}\n\n## Quotes\n\n## My thoughts\n\n' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const sortTitle = (a: View, b: View) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

function cleanTag(t: string): string {
  return t.trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

/** `tags: [a, b]`, a list, or `tags: a, b` / `tag: a b` as other tools write them. */
function tagsOf(fm: Frontmatter): string[] {
  const raw = fm.tags ?? fm.tag;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  return [...new Set(list.map(cleanTag).filter(Boolean))];
}

export class Vault implements VaultApi {
  private persist: Persist;
  private opts: VaultOptions;
  private fs: VaultFs;
  private meta: Record<string, unknown> = {};
  private replica: Replica | null = null;
  private sealer: Sealer | null = null;
  private vaultFile: VaultFile | null = null;
  /** notes and the folders derived from where they are */
  private views = new Map<string, View>();
  private files = new Map<string, { name: string; path: string; mime: string; body: string; size: number; created: string; trashed: boolean }>();
  private fileBySha = new Map<string, string>();
  private searchIndex = new MiniSearch<{ id: string; title: string; body: string; tags: string }>({
    fields: ['title', 'body', 'tags'],
    storeFields: [],
    searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 3, tags: 2 } },
  });
  private listeners = new Set<(e: VaultEvent) => void>();
  private store: Store | null | undefined;
  private syncing: Promise<SyncReport> | null = null;
  private lastSyncError: string | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private aiBody: string | null = null;
  private chats = new Map<string, ChatRecord>();
  // ---- the folder on disk
  /** disk path (including `.trash/...`) -> what was last read or written there */
  private index = new Map<string, IndexEntry>();
  private byLower = new Map<string, string>();
  private pathById = new Map<string, string>();
  private diskDirs = new Set<string>();
  private diskQ: Promise<unknown> = Promise.resolve();
  private indexTimer: ReturnType<typeof setTimeout> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private linkIdx: LinkIndex | null = null;
  private linkCache = new Map<string, string[]>();
  private notice: string | null = null;
  /** the first look at the folder after opening: the UI is shown while it runs (progress in the status) */
  private scanning: Promise<void> | null = null;
  private scanProgress: { done: number; total: number } | null = null;

  private constructor(opts: VaultOptions) {
    this.opts = opts;
    this.persist = opts.persist;
    this.fs = opts.fs ?? new MemFs();
  }

  static async open(opts: VaultOptions): Promise<Vault> {
    const v = new Vault(opts);
    v.meta = await opts.persist.loadMeta();
    v.vaultFile = (v.meta.vaultFile as VaultFile | undefined) ?? null;
    if (!v.meta.deviceId) {
      v.meta.deviceId = newId();
      await opts.persist.setMeta('deviceId', v.meta.deviceId);
    }
    const remembered = v.meta.rememberedKey as string | undefined;
    if (v.vaultFile && !hasPassword(v.vaultFile)) {
      try { await v.activate(await unwrapMasterKey('', v.vaultFile)); } catch { /* fall back to locked */ }
    } else if (v.vaultFile && remembered) {
      try { await v.activate(fromB64(remembered)); } catch { /* fall back to locked */ }
    }
    return v;
  }

  private now(): number { return (this.opts.now ?? Date.now)(); }
  private iso(): string { return new Date(this.now()).toISOString(); }
  private get deviceId(): string { return this.meta.deviceId as string; }
  private get deviceName(): string {
    return (this.meta.deviceName as string | undefined) ?? this.opts.defaultDeviceName ?? 'This device';
  }
  private emit(e: VaultEvent) { for (const l of this.listeners) l(e); }
  onEvent(fn: (e: VaultEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private async setMeta(k: string, v: unknown) { this.meta[k] = v; await this.persist.setMeta(k, v); }
  private ready(): Replica {
    if (!this.replica) throw new Error('The vault is locked');
    return this.replica;
  }

  // ---------- lifecycle ----------
  async status(): Promise<VaultStatus> {
    const st: VaultState = !this.vaultFile ? 'no-vault' : this.replica ? 'ready' : 'locked';
    const cfg = this.meta.store as StoreConfig | undefined;
    return {
      state: st,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      store: cfg ? { type: cfg.type, label: storeLabel(cfg) } : null,
      lastSyncAt: (this.meta.lastSyncAt as number | undefined) ?? null,
      lastSyncError: this.lastSyncError,
      syncing: this.syncing !== null,
      pending: this.replica ? this.replica.order.filter(i => !this.replica!.pushed.has(i)).length : 0,
      conflicts: this.replica ? this.conflictIds().length : 0,
      remembered: !!this.meta.rememberedKey,
      remote: false,
      notice: this.notice,
      hasPassword: this.vaultFile ? hasPassword(this.vaultFile) : true,
      passwordOptional: !!this.opts.passwordOptional,
      scan: this.scanProgress,
    };
  }

  private async activate(masterKey: Uint8Array): Promise<void> {
    this.sealer = new Sealer(masterKey);
    this.persist.setSealer?.(this.sealer);
    this.replica = await Replica.open(this.persist, this.deviceId, this.deviceName);
    this.unsub = this.replica.onChange(items => { this.refresh(items); this.queueWrite(items); this.emit({ type: 'items', ids: items }); this.noteLocalChange(); });
    this.views.clear();
    this.files.clear();
    this.fileBySha.clear();
    this.index.clear();
    this.byLower.clear();
    this.pathById.clear();
    if (this.fs.durable !== false) for (const [p, e] of (this.meta.fileIndex as [string, IndexEntry][] | undefined) ?? []) this.setIndex(p, e);
    this.refresh(this.replica.items());
    // files that changed while the app was closed, and notes that arrived but were never written out:
    // looked at in the background so the app shows at once (the status carries the progress)
    this.scanProgress = this.opts.backgroundScan ? { done: 0, total: 0 } : null;
    const replica = this.replica;
    const run = (async () => {
      try {
        await this.diskTask(() => this.scanNow(!!this.opts.backgroundScan));
        if (this.replica !== replica) return;
        this.queueWrite(replica.items().filter(i => !this.pathById.has(i)));
        await this.flushDisk();
      } catch (e) {
        this.notice = `Could not read the vault folder: ${e instanceof Error ? e.message : String(e)}`;
      } finally {
        if (this.replica === replica) { this.scanProgress = null; this.emit({ type: 'status' }); }
      }
    })();
    this.scanning = run;
    void run.finally(() => { if (this.scanning === run) this.scanning = null; });
    this.emit({ type: 'status' });
    if (!this.opts.backgroundScan) await run;
  }

  /** Wait until the first look at the folder is over (what must not run on a half-read vault). */
  private async scanned(): Promise<void> { await this.scanning; }

  private async folderIsEmpty(): Promise<boolean> {
    const top = await this.fs.readdir('');
    return top.every(e => e.name.startsWith('.'));
  }

  async createVault(password: string, o: { deviceName?: string; remember?: boolean; noPassword?: boolean } = {}): Promise<void> {
    if (this.vaultFile) throw new Error('A vault already exists on this device');
    if (o.noPassword && !this.opts.passwordOptional) throw new Error('A vault on this device needs a password.');
    const problem = o.noPassword ? null : checkPassword(password);
    if (problem) throw new Error(problem);
    const empty = await this.folderIsEmpty();
    const { file, masterKey } = o.noPassword ? createPasswordlessVaultFile() : await createVaultFile(password, this.opts.kdf ?? DEFAULT_KDF);
    this.vaultFile = file;
    await this.setMeta('vaultFile', file);
    if (o.deviceName) await this.setMeta('deviceName', o.deviceName);
    if (o.remember) await this.setMeta('rememberedKey', toB64(masterKey));
    await this.activate(masterKey);
    // a folder somebody already filled is taken as it is (read in the background); an empty one gets the PARA folders
    // and a welcome note, once the first look at it, which is instant, is over
    if (empty) { await this.scanned(); await this.seedDefaults(); }
  }

  async joinVault(store: StoreConfig, password: string, o: { deviceName?: string; remember?: boolean } = {}): Promise<void> {
    if (this.vaultFile) throw new Error('A vault already exists on this device');
    const s = await this.buildStore(store);
    const blob = await s.get('vault.json');
    if (!blob) throw new Error('No vault was found in that storage. Create one on your first device and sync it.');
    const file = JSON.parse(dec(blob)) as VaultFile;
    const masterKey = await unwrapMasterKey(password, file);
    this.vaultFile = file;
    await this.setMeta('vaultFile', file);
    await this.setMeta('store', store);
    this.store = s;
    if (o.deviceName) await this.setMeta('deviceName', o.deviceName);
    if (o.remember) await this.setMeta('rememberedKey', toB64(masterKey));
    await this.activate(masterKey);
    await this.scanned();
    await this.sync({ full: true });
    await this.flushDisk();
  }

  /**
   * Unwrap the master key. A password changed on another device only reaches this one through the
   * Store's `vault.json`, so a failed attempt is retried with that copy before giving up.
   */
  private async unwrap(password: string): Promise<Uint8Array> {
    try {
      return await unwrapMasterKey(password, this.vaultFile!);
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw e;
      const s = await this.getStore().catch(() => null);
      const blob = s ? await s.get('vault.json').catch(() => null) : null;
      if (!blob) throw e;
      const remote = JSON.parse(dec(blob)) as VaultFile;
      if (remote.wrappedKey === this.vaultFile!.wrappedKey) throw e;
      const key = await unwrapMasterKey(password, remote);
      this.vaultFile = remote;
      await this.setMeta('vaultFile', remote);
      return key;
    }
  }

  async unlock(password: string, o: { remember?: boolean } = {}): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault on this device');
    if (this.replica) return;
    const key = await this.unwrap(password);
    if (o.remember) await this.setMeta('rememberedKey', toB64(key));
    await this.activate(key);
  }

  /** Check a password without changing any state (used by the server to sign a browser in). */
  async verifyPassword(password: string): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault on this device');
    await this.unwrap(password);
  }

  async lock(): Promise<void> {
    this.stopAutoSync();
    this.stopWatching();
    await this.flushDisk();
    await this.saveIndexNow();
    this.unsub?.();
    this.replica = null;
    this.sealer = null;
    this.persist.setSealer?.(null);
    this.views.clear();
    this.files.clear(); // attachments are plaintext in memory
    this.fileBySha.clear();
    this.index.clear();
    this.byLower.clear();
    this.pathById.clear();
    this.aiBody = null;
    this.chats.clear();
    this.searchIndex.removeAll();
    await this.setMeta('rememberedKey', undefined);
    delete this.meta.rememberedKey;
    this.emit({ type: 'status' });
  }

  /** Sets a password on a vault that has none (`oldPassword` is not read then), or changes the one it has. */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault');
    const problem = checkPassword(newPassword);
    if (problem) throw new Error(problem);
    const key = await unwrapMasterKey(oldPassword, this.vaultFile);
    const wasOpen = !hasPassword(this.vaultFile);
    const file = await wrapMasterKey(newPassword, key, this.opts.kdf ?? DEFAULT_KDF, this.vaultFile.epoch);
    file.created = this.vaultFile.created;
    await this.saveVaultFile(file);
    // the installed apps keep the key on the Device (as the sign-in screen's "keep unlocked" does), so setting a password
    // protects the copy on the Store and other Devices without asking for it here at once
    if (wasOpen && this.opts.passwordOptional) await this.setMeta('rememberedKey', toB64(key));
  }

  /** ADR 0012: back to a vault with no password. The master key stays, so nothing is re-encrypted. */
  async removePassword(password: string): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault');
    if (!this.opts.passwordOptional) throw new Error('A vault on this device needs a password.');
    if (!hasPassword(this.vaultFile)) return;
    const key = await unwrapMasterKey(password, this.vaultFile);
    const { file } = createPasswordlessVaultFile(key, this.vaultFile.epoch);
    file.created = this.vaultFile.created;
    await this.saveVaultFile(file);
    await this.setMeta('rememberedKey', undefined);
    delete this.meta.rememberedKey;
  }

  /** The Store first: if it cannot be reached nothing has changed here, and other devices never see a password this one lost. */
  private async saveVaultFile(file: VaultFile): Promise<void> {
    const s = await this.getStore();
    if (s) await s.put('vault.json', enc(JSON.stringify(file)));
    this.vaultFile = file;
    await this.setMeta('vaultFile', file);
    this.emit({ type: 'status' });
  }

  /**
   * Forget a vault that has no password and is not connected to a Store, so that this Device can join one that exists.
   * History and conversations in `.ergonotes/` go; the notes in the folder stay and join the vault that is joined.
   */
  async leaveVault(): Promise<void> {
    if (!this.vaultFile) return;
    if (!this.opts.passwordOptional || hasPassword(this.vaultFile)) throw new Error('Only a vault with no password can be left from here.');
    if (this.meta.store) throw new Error('Disconnect the storage first.');
    await this.lock();
    for (const k of ['vaultFile', 'rememberedKey', 'store', 'fileIndex', 'lastSyncAt']) { delete this.meta[k]; await this.persist.setMeta(k, undefined); }
    await this.persist.reset?.();
    this.vaultFile = null;
    this.store = undefined;
    this.emit({ type: 'status' });
  }

  async setDeviceName(name: string): Promise<void> {
    await this.setMeta('deviceName', name.trim() || 'This device');
    if (this.replica) this.replica.deviceName = this.deviceName;
    this.emit({ type: 'status' });
  }

  private async seedDefaults() {
    for (const f of DEFAULT_FOLDERS) { await this.fs.mkdir(f); this.diskDirs.add(f); }
    for (const t of DEFAULT_TEMPLATES) {
      await this.createNoteRaw({ parent: 'Templates', title: t.title, body: t.body, tags: t.tags, template: true, daily: t.daily });
    }
    await this.createNoteRaw({
      parent: 'Inbox',
      title: 'Welcome to Ergonotes',
      body: [
        'This folder is your vault: every note is a Markdown file you can open with any other editor.',
        '',
        '- New notes land in **Inbox**; move them to Projects, Areas, Resources or Archive when you know where they belong.',
        '- Link notes with `[[` and see backlinks under each note.',
        '- Turn a line into a task with the checkbox button; tasks show up in **Tasks** and the **Calendar**.',
        '- Draw with the **Insert → Sketch** menu.',
        '',
        '- [ ] Try creating a note from a template',
        '',
      ].join('\n'),
    });
    this.syncFolders();
    this.emit({ type: 'status' });
  }

  // ---------- the folder: files <-> items ----------
  private setIndex(path: string, e: IndexEntry) {
    const old = this.index.get(path);
    if (old && old.id !== e.id && this.pathById.get(old.id) === path) this.pathById.delete(old.id);
    this.index.set(path, e);
    this.byLower.set(path.toLowerCase(), path);
    this.pathById.set(e.id, path);
    this.saveIndexSoon();
  }
  private dropIndex(path: string) {
    const e = this.index.get(path);
    if (!e) return;
    this.index.delete(path);
    if (this.byLower.get(path.toLowerCase()) === path) this.byLower.delete(path.toLowerCase());
    if (this.pathById.get(e.id) === path) this.pathById.delete(e.id);
    this.saveIndexSoon();
  }
  private saveIndexSoon() {
    if (this.indexTimer) return;
    this.indexTimer = setTimeout(() => { this.indexTimer = null; void this.saveIndexNow(); }, 800);
  }
  private async saveIndexNow() {
    if (this.indexTimer) { clearTimeout(this.indexTimer); this.indexTimer = null; }
    if (!this.replica || this.fs.durable === false) return;
    await this.setMeta('fileIndex', [...this.index.entries()]).catch(() => { /* retried on the next change */ });
  }

  private diskTask<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.diskQ.then(fn, fn);
    this.diskQ = r.catch(() => undefined);
    return r;
  }
  private async flushDisk(): Promise<void> {
    for (;;) {
      const q = this.diskQ;
      await q;
      if (q === this.diskQ) return;
    }
  }
  private queueWrite(ids: string[]) {
    if (!ids.length) return;
    void this.diskTask(() => this.writeOut(ids)).catch(e => { this.notice = `Could not write to the vault folder: ${e instanceof Error ? e.message : String(e)}`; });
  }

  private kindOf(text: string): string {
    const k = reservedOf(text)._ergo_kind;
    return typeof k === 'string' ? k : 'note';
  }

  /** Make the folder match the items: write what changed in the database (a pull, an edit in the app). */
  private async writeOut(ids: string[]): Promise<void> {
    const r = this.replica;
    if (!r) return;
    for (const id of ids) {
      try { await this.writeOne(r, id); } catch (e) { this.notice = `Could not write to the vault folder: ${e instanceof Error ? e.message : String(e)}`; }
    }
  }

  private async writeOne(r: Replica, id: string): Promise<void> {
    const text = r.text(id);
    const prev = this.pathById.get(id);
    if (text === null) {
      if (prev) { await this.fs.remove(prev); this.dropIndex(prev); if (prev.startsWith(TRASH_DIR + '/')) await this.pruneTrashDirs(dirname(prev)); }
      return;
    }
    const res = reservedOf(text);
    const kind = typeof res._ergo_kind === 'string' ? res._ergo_kind : 'note';
    if (kind !== 'note' && kind !== 'file') return;
    let rel = typeof res._ergo_path === 'string' ? res._ergo_path : '';
    const clean = rel ? normalizePath(rel) : null;
    if (!clean || clean !== rel) {
      // a path that is empty or leaves the vault is never written; give the item a place of its own
      rel = await this.freePath('', kind === 'note' ? safeName(basename(rel).replace(/\.\w+$/, '') || 'Untitled') : 'file', kind === 'note' ? '.md' : extOf(rel));
      await this.commitPath(id, rel);
      return;
    }
    const trashed = typeof res._ergo_trashed === 'string' && res._ergo_trashed !== '';
    const target = trashed ? `${TRASH_DIR}/${rel}` : rel;
    let bytes: Uint8Array;
    let hash: string;
    if (kind === 'note') {
      const ft = toFileText(text);
      bytes = enc(ft);
      hash = sha256hex(ft);
    } else {
      const b64 = parseNote(text).body.replace(/\s+/g, '');
      bytes = fromB64(b64);
      hash = sha256hex(b64);
    }
    const here = this.index.get(target);
    if (prev === target && here && here.id === id && here.hash === hash) {
      if (here.commit !== r.headId(id)) this.index.set(target, { ...here, commit: r.headId(id) });
      return; // already what the folder has
    }
    if (prev === target && here && here.id === id) {
      // the file was changed by another program after we last looked: it is read first, never overwritten
      const st = await this.fs.stat(target);
      if (st && (st.size !== here.size || st.mtime !== here.mtime)) { setTimeout(() => { void this.rescan(); }, 50); return; }
    }

    const occPath = this.byLower.get(target.toLowerCase());
    const occ = occPath ? this.index.get(occPath) : undefined;
    if (occ && occ.id !== id && occPath !== prev) {
      // two items want one path: the larger id moves aside, the same way on every Device
      const loser = occ.id > id ? occ.id : id;
      const lr = reservedOf(r.text(loser) ?? '');
      const lrel = typeof lr._ergo_path === 'string' ? lr._ergo_path : rel;
      const ltrash = typeof lr._ergo_trashed === 'string' && lr._ergo_trashed !== '';
      const free = await this.freePath(dirname(lrel), stripExt(basename(lrel)), extOf(lrel) || '', ltrash ? TRASH_DIR : '');
      await this.commitPath(loser, free);
      if (loser !== id) this.queueWrite([id]); // after the occupant has moved
      return;
    }
    if (prev && prev !== target) {
      const old = this.index.get(prev);
      if (await this.fs.stat(prev)) await this.fs.rename(prev, target);
      this.dropIndex(prev);
      if (prev.startsWith(TRASH_DIR + '/')) await this.pruneTrashDirs(dirname(prev));
      if (old && old.hash === hash) {
        const st = await this.fs.stat(target);
        if (st) { this.setIndex(target, { id, kind, size: st.size, mtime: st.mtime, hash, commit: r.headId(id) }); return; }
      }
    }
    await this.fs.write(target, bytes);
    const st = await this.fs.stat(target);
    this.setIndex(target, { id, kind, size: st?.size ?? bytes.length, mtime: st?.mtime ?? 0, hash, commit: r.headId(id) });
  }

  /** Remove now-empty folders under `.trash`, never the trash folder itself. */
  private async pruneTrashDirs(dir: string) {
    let d = dir;
    while (d && d !== TRASH_DIR && d.startsWith(TRASH_DIR + '/')) {
      if ((await this.fs.readdir(d)).length) return;
      await this.fs.remove(d);
      d = dirname(d);
    }
  }

  /** The first path `dir/name.ext`, `dir/name 2.ext`... that is free on disk (any case) and in the index. */
  private async freePath(dir: string, name: string, ext: string, namespace = ''): Promise<string> {
    const full = (p: string) => (namespace ? `${namespace}/${p}` : p);
    for (let n = 1; n < 10_000; n++) {
      const p = joinPath(dir, n === 1 ? `${name}${ext}` : `${name} ${n}${ext}`);
      if (!this.byLower.has(full(p).toLowerCase()) && !(await this.fs.stat(full(p)))) return p;
    }
    return joinPath(dir, `${name} ${newId().slice(0, 8)}${ext}`);
  }

  private async commitPath(id: string, rel: string) {
    const r = this.ready();
    const t = r.text(id);
    if (t === null) return;
    await r.commit(id, setReserved(t, { _ergo_path: rel }), this.now());
  }

  private async walk(): Promise<{ files: Map<string, { size: number; mtime: number }>; dirs: Set<string>; truncated: boolean }> {
    const files = new Map<string, { size: number; mtime: number }>();
    const dirs = new Set<string>();
    const max = this.opts.maxFiles ?? 20_000;
    let truncated = false;
    const stack = [''];
    while (stack.length) {
      const dir = stack.pop()!;
      const ents = await this.fs.readdir(dir);
      for (const e of ents) {
        if (e.name.startsWith('.') || IGNORED_NAMES.has(e.name) || e.name.endsWith('.tmp')) continue;
        const p = dir ? `${dir}/${e.name}` : e.name;
        // a link that points back up the tree would never end: stop at a sane depth
        if (e.kind === 'dir') { if (p.split('/').length <= 32) { dirs.add(p); stack.push(p); } continue; }
        if (files.size >= max) { truncated = true; continue; }
        files.set(p, { size: e.size, mtime: e.mtime });
      }
    }
    return { files, dirs, truncated };
  }

  /** Look at the folder and take in what changed outside the app. Returns how many files were affected. */
  async rescan(): Promise<number> {
    if (!this.replica) return 0;
    return this.diskTask(() => this.scanNow());
  }

  private async scanNow(showProgress = false): Promise<number> {
    const r = this.replica;
    if (!r) return 0;
    if (!(await this.fs.stat(''))) { this.notice = 'The vault folder cannot be reached.'; return 0; }
    const { files, dirs, truncated } = await this.walk();
    const live = [...this.index.keys()].filter(p => !p.startsWith(TRASH_DIR + '/'));
    // a folder that suddenly has nothing in it is an unplugged drive, not a person deleting everything
    if (files.size === 0 && live.length > 0) { this.notice = 'The vault folder looks empty or unavailable; nothing was changed.'; return 0; }
    this.notice = truncated ? `This folder has more than ${(this.opts.maxFiles ?? 20_000).toLocaleString('en')} files; only part of it is shown.` : null;

    interface Cand { path: string; kind: 'note' | 'file'; size: number; mtime: number; text?: string; b64?: string; hash: string }
    const changed: Cand[] = [];
    const settle = this.opts.settleMs ?? 600;
    const cut = Date.now() - settle;
    let again = false;
    const skipped: string[] = [];
    const oversized: string[] = [];
    let seen = 0;
    let lastTick = 0;
    for (const [path, f] of files) {
      if (showProgress && ++seen && Date.now() - lastTick > 150) {
        lastTick = Date.now();
        this.scanProgress = { done: seen, total: files.size };
        this.emit({ type: 'status' });
        await new Promise<void>(res => setTimeout(res, 0)); // let the interface paint between slices
      }
      const known = this.index.get(path);
      if (known && known.size === f.size && known.mtime === f.mtime) continue;
      if (settle > 0 && f.mtime > cut) { again = true; continue; } // still being written by another program
      if (isNotePath(path)) {
        if (f.size > MAX_NOTE_BYTES) { skipped.push(path); continue; }
        const raw = await this.fs.read(path);
        if (!raw) continue;
        let text: string;
        // a file that is not UTF-8 would be damaged by a save: it is left alone and the person is told
        try { text = STRICT_UTF8.decode(raw); } catch { skipped.push(path); continue; }
        if (text.includes('\u0000')) { skipped.push(path); continue; }
        const hash = sha256hex(text);
        if (known && known.hash === hash) { this.setIndex(path, { ...known, size: f.size, mtime: f.mtime }); continue; }
        changed.push({ path, kind: 'note', size: f.size, mtime: f.mtime, text, hash });
      } else {
        if (!attachable(path)) continue;
        if (f.size > MAX_ATTACHMENT) { oversized.push(path); continue; } // still in the folder and readable from it, but not an item (not synced)
        const raw = await this.fs.read(path);
        if (!raw) continue;
        const b64 = toB64(raw);
        const hash = sha256hex(b64);
        if (known && known.hash === hash) { this.setIndex(path, { ...known, size: f.size, mtime: f.mtime }); continue; }
        changed.push({ path, kind: 'file', size: f.size, mtime: f.mtime, b64, hash });
      }
    }
    if (again) setTimeout(() => { void this.rescan(); }, settle + 100);
    if (oversized.length && !this.notice) {
      this.notice = `${oversized.length} file${oversized.length === 1 ? ' is' : 's are'} over ${MAX_ATTACHMENT / 1024 / 1024} MB (${oversized[0]}${oversized.length > 1 ? ', …' : ''}): still in the folder, but not synced to other devices.`;
    }
    if (skipped.length && !this.notice) {
      this.notice = `${skipped.length} Markdown file${skipped.length === 1 ? ' is' : 's are'} not UTF-8 text or too large (${skipped[0]}${skipped.length > 1 ? ', …' : ''}) and left alone.`;
    }

    const missing = new Map<string, IndexEntry>();
    for (const p of live) if (!files.has(p)) missing.set(p, this.index.get(p)!);
    const moved = new Set<string>();
    let n = 0;
    const now = this.now();
    const byPathLive = new Map<string, string>(); // item that already has this path (index lost)
    for (const v of this.views.values()) if (v.type === 'note' && !v.trashed) byPathLive.set(v.path.toLowerCase(), v.id);

    for (const c of changed) {
      const known = this.index.get(c.path);
      let id: string | null = known?.id ?? null;
      if (!id) {
        const fmId = c.kind === 'note' ? parseNote(c.text!).fm.id : undefined;
        const wanted = typeof fmId === 'string' || typeof fmId === 'number' ? String(fmId) : '';
        if (wanted) {
          const at = this.pathById.get(wanted);
          if (at && missing.has(at)) { id = wanted; moved.add(at); } // the file was moved or renamed outside
          else if (!at) id = wanted; // a note that brings its own id
          // else: a copy of a note that is still where it was: a new identity
        }
        if (!id) {
          for (const [p, e] of missing) {
            if (!moved.has(p) && e.kind === c.kind && e.hash === c.hash) { id = e.id; moved.add(p); break; }
          }
        }
        if (!id && c.kind === 'note') {
          const same = byPathLive.get(c.path.toLowerCase());
          if (same && !this.pathById.has(same)) id = same;
        }
        if (!id) id = newId();
      }
      // a file seen for the first time is as old as the file; a change is as new as now
      const ts = r.headId(id) ? now : Math.min(now, c.mtime || now);
      let text: string;
      if (c.kind === 'note') text = toItemText(c.text!, { path: c.path });
      else {
        const name = basename(c.path);
        const fm: Frontmatter = {
          id, _ergo_kind: 'file', _ergo_path: c.path, name, mime: MIME[extOf(c.path)] ?? 'application/octet-stream', sha: c.hash, size: c.size,
          created: new Date(Math.min(now, c.mtime || now)).toISOString(),
        };
        text = joinDoc(fm, c.b64!.replace(/(.{76})/g, '$1\n'));
      }
      // the entry first: the write-out that follows the commit then finds the file already as it should be
      const oldPath = this.pathById.get(id);
      if (oldPath && oldPath !== c.path) this.dropIndex(oldPath);
      this.setIndex(c.path, { id, kind: c.kind, size: c.size, mtime: c.mtime, hash: c.hash });
      const base = known?.commit;
      const head = r.headId(id);
      if (c.kind === 'note' && base && head && base !== head && r.g.has(base) && r.text(id) !== null) {
        // another text arrived (sync) after this file was written: the edit was made on the old one, so it is
        // recorded as a branch and joined with the new one like any two devices' edits
        await r.commitOn(id, base, text, Math.max(ts, 0));
      } else await r.commit(id, text, Math.max(ts, 0));
      const at = this.index.get(c.path);
      if (at) this.index.set(c.path, { ...at, commit: r.headId(id) });
      n++;
    }

    for (const [p, e] of missing) {
      if (moved.has(p)) continue;
      this.dropIndex(p);
      const t = r.text(e.id);
      if (t === null) continue;
      n++;
      if (e.kind === 'file') { await r.purge(e.id, now); continue; }
      // deleted outside the app: the note goes to the Trash, history intact, so it can be brought back
      if (!reservedOf(t)._ergo_trashed) await r.commit(e.id, setReserved(t, { _ergo_trashed: this.iso() }), now);
    }

    this.diskDirs = dirs;
    this.syncFolders();
    if (n) this.emit({ type: 'status' });
    return n;
  }

  startWatching(): void {
    const ms = this.opts.watchMs ?? 3000;
    if (this.watchTimer || ms <= 0) return;
    let busy = false;
    this.watchTimer = setInterval(() => {
      if (busy || !this.replica) return;
      busy = true;
      void this.rescan().catch(() => 0).finally(() => { busy = false; });
    }, ms);
  }
  stopWatching(): void {
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  // ---------- views & index ----------
  private refresh(ids: string[]) {
    const r = this.ready();
    for (const id of ids) {
      const text = r.text(id);
      const prev = this.views.get(id);
      if (prev) { try { this.searchIndex.discard(id); } catch { /* not indexed */ } }
      if (text === null) {
        this.views.delete(id); this.files.delete(id); this.chats.delete(id);
        if (id === AI_CONFIG_ID) this.aiBody = null;
        continue;
      }
      const p = parseNote(text);
      const fm = p.fm;
      const res = reservedOf(text);
      const kind = typeof res._ergo_kind === 'string' ? res._ergo_kind : 'note';
      if (kind === 'config') {
        if (id === AI_CONFIG_ID) this.aiBody = p.body;
        this.views.delete(id);
        continue;
      }
      if (kind === 'chat') {
        this.chats.set(id, {
          id, title: typeof fm.title === 'string' && fm.title ? fm.title : 'Conversation',
          created: typeof fm.created === 'string' ? fm.created : '', updated: typeof fm.updated === 'string' ? fm.updated : '',
          data: p.body,
        });
        this.views.delete(id);
        continue;
      }
      if (kind === 'file') {
        const path = typeof res._ergo_path === 'string' ? res._ergo_path : `${ATTACH_DIR}/${String(fm.name ?? 'file')}`;
        this.files.set(id, {
          name: String(fm.name ?? basename(path)), path, mime: String(fm.mime ?? 'application/octet-stream'), body: p.body,
          size: typeof fm.size === 'number' ? fm.size : b64Bytes(p.body),
          created: typeof fm.created === 'string' ? fm.created : '',
          trashed: typeof res._ergo_trashed === 'string' && res._ergo_trashed !== '',
        });
        if (typeof fm.sha === 'string') this.fileBySha.set(fm.sha, id);
        this.views.delete(id);
        // a transcript arrived or changed: the notes that show its record are found by what was said
        if (path.endsWith('/transcript.txt') && recordDirOf(path)) {
          const dir = recordDirOf(path)!;
          for (const n of this.views.values()) {
            if (n.type !== 'note' || !this.recordDirsOf(n).includes(dir)) continue;
            try { this.searchIndex.discard(n.id); } catch { /* not indexed */ }
            this.addToSearch(n);
          }
        }
        continue;
      }
      const path = typeof res._ergo_path === 'string' && res._ergo_path ? res._ergo_path : 'Untitled.md';
      const user = { ...fm };
      const tags = tagsOf(user);
      const head = r.g.get(r.headId(id) ?? '');
      let created = typeof fm.created === 'string' ? fm.created : '';
      if (!created) {
        let first = head?.ts ?? 0;
        for (const cid of r.g.byItem.get(id) ?? []) first = Math.min(first || Infinity, r.g.get(cid)!.ts);
        created = first ? new Date(first).toISOString() : '';
      }
      const updated = typeof fm.updated === 'string' ? fm.updated : head ? new Date(head.ts).toISOString() : created;
      const dir = dirname(path);
      const view: View = {
        id, type: 'note', fm: user,
        title: titleOfPath(path) || 'Untitled',
        path,
        parent: dir ? folderIdOf(dir) : null,
        tags,
        created, updated,
        trashed: typeof res._ergo_trashed === 'string' && res._ergo_trashed ? res._ergo_trashed : null,
        trashDir: typeof res._ergo_trashdir === 'string' && res._ergo_trashdir ? res._ergo_trashdir : null,
        pinned: fm.pinned === true,
        template: fm.template === true,
        private: fm.private === true,
        role: null,
        daily: typeof fm.daily === 'string' ? fm.daily : null,
        body: p.body,
        snippet: plainSnippet(p.body),
        thumb: firstImage(p.body) ?? null,
        tasks: parseTasks(p.body),
        events: parseEvents(p.body),
        linkRefs: findLinks(p.body),
      };
      this.views.set(id, view);
      this.addToSearch(view);
    }
    this.linkIdx = null;
    this.syncFolders();
  }

  /** Words of a note for search: its text, and what was said in the records it shows. */
  private addToSearch(view: View) {
    let spoken = '';
    for (const dir of this.recordDirsOf(view)) {
      for (const f of this.files.values()) {
        if (f.path !== `${dir}/transcript.txt` || f.trashed) continue;
        try { spoken += ' ' + dec(fromB64(f.body.replace(/\s+/g, ''))).replace(/^\[\d+:\d\d\]\s*$/gm, ' '); } catch { /* unreadable */ }
      }
    }
    this.searchIndex.add({ id: view.id, title: view.title, body: plainSnippet(view.body, 4000) + (spoken ? ' ' + spoken.slice(0, 40_000) : ''), tags: view.tags.join(' ') });
  }

  /** Folders are the directories on disk and the directories notes are in: derived, never stored. */
  private syncFolders() {
    const dirs = new Set<string>();
    const add = (d: string) => { for (let x = d; x; x = dirname(x)) { if (dirs.has(x)) break; dirs.add(x); } };
    for (const d of this.diskDirs) add(d);
    for (const v of this.views.values()) if (v.type === 'note' && !v.trashed) add(dirname(v.path));
    for (const [id, v] of this.views) if (v.type === 'folder' && !dirs.has(v.path)) this.views.delete(id);
    for (const d of dirs) {
      if (d.split('/').some(s => s.startsWith('.')) || d === ATTACH_DIR || d.startsWith(ATTACH_DIR + '/')) continue;
      const id = folderIdOf(d);
      const dir = dirname(d);
      const old = this.views.get(id);
      if (old && old.type === 'folder' && old.path === d) continue;
      this.views.set(id, {
        id, type: 'folder', fm: {}, title: basename(d), path: d, parent: dir ? folderIdOf(dir) : null, tags: [], created: '', updated: '',
        trashed: null, trashDir: null, pinned: false, template: false, private: false, role: dir ? null : ROLES[d.toLowerCase()] ?? null, daily: null,
        body: '', snippet: '', thumb: null, tasks: [], events: [], linkRefs: [],
      });
    }
  }

  private inTrash(v: View, seen = new Set<string>()): boolean {
    if (v.trashed) return true;
    if (!v.parent || seen.has(v.id)) return false;
    seen.add(v.id);
    const p = this.views.get(v.parent);
    return p ? this.inTrash(p, seen) : false;
  }

  private summary(v: View, childCounts: Map<string, number>): ItemSummary {
    const open = v.tasks.filter(t => !t.done);
    const reminders = open.map(t => t.remind).filter((x): x is string => !!x).sort();
    return {
      id: v.id, type: v.type, title: v.title, parent: v.parent, tags: v.tags, created: v.created, updated: v.updated,
      trashed: v.trashed, inTrash: this.inTrash(v), pinned: v.pinned, template: v.template, private: v.private, role: v.role,
      filePath: v.path,
      snippet: v.snippet, thumb: v.thumb, conflicted: v.type === 'note' && this.replica!.hasConflict(v.id),
      tasksOpen: open.length, tasksDone: v.tasks.length - open.length, nextReminder: reminders[0] ?? null,
      childCount: childCounts.get(v.id) ?? 0,
    };
  }

  private counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const v of this.views.values()) if (v.parent && !v.trashed) m.set(v.parent, (m.get(v.parent) ?? 0) + 1);
    return m;
  }

  private path(id: string): { id: string; title: string }[] {
    const out: { id: string; title: string }[] = [];
    const seen = new Set<string>();
    let cur = this.views.get(id)?.parent ?? null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = this.views.get(cur);
      if (!p) break;
      out.unshift({ id: p.id, title: p.title });
      cur = p.parent;
    }
    return out;
  }

  private titleOf(id: string): string { return this.views.get(id)?.title ?? 'Missing note'; }

  // ---------- links ----------
  private linkIndex(): LinkIndex {
    if (!this.linkIdx) {
      const paths: string[] = [];
      for (const v of this.views.values()) if (v.type === 'note' && !v.trashed) paths.push(v.path);
      const dirs = new Set<string>();
      for (const f of this.files.values()) {
        paths.push(f.path);
        const rd = recordDirOf(f.path); // a record is linked by its folder
        if (rd) dirs.add(rd);
      }
      paths.push(...dirs);
      this.linkIdx = buildLinkIndex(paths);
      this.linkCache.clear();
    }
    return this.linkIdx;
  }

  private noteByPath(): Map<string, View> {
    const m = new Map<string, View>();
    for (const v of this.views.values()) if (v.type === 'note' && !v.trashed) m.set(v.path, v);
    return m;
  }

  /** The notes this note links to (ids), cached until something moves. */
  private linksOf(v: View): string[] {
    const idx = this.linkIndex();
    const hit = this.linkCache.get(v.id);
    if (hit) return hit;
    const byPath = this.noteByPath();
    const ids = new Set<string>();
    for (const ref of v.linkRefs) {
      if (ref.embed) continue;
      const t = resolveLink(ref, v.path, idx);
      const target = t ? byPath.get(t) : undefined;
      if (target) ids.add(target.id);
    }
    const out = [...ids];
    this.linkCache.set(v.id, out);
    return out;
  }

  // ---------- reading ----------
  async listItems(): Promise<ItemSummary[]> {
    this.ready();
    const c = this.counts();
    return [...this.views.values()].map(v => this.summary(v, c));
  }

  async getNote(id: string): Promise<NoteDoc | null> {
    this.ready();
    const v = this.views.get(id);
    if (!v || v.type !== 'note') return null;
    const backlinks = [...this.views.values()]
      .filter(x => x.type === 'note' && x.id !== id && !this.inTrash(x) && this.linksOf(x).includes(id))
      .map(x => ({ id: x.id, title: x.title }));
    const idx = this.linkIndex();
    const byPath = this.noteByPath();
    const linkMap: Record<string, string> = {};
    const fileMap: Record<string, string> = {};
    const fileIdAt = new Map([...this.files].map(([fid, f]) => [f.path, fid]));
    for (const ref of v.linkRefs) {
      const t = resolveLink(ref, v.path, idx);
      if (!t) continue;
      const target = byPath.get(t);
      if (target && !ref.embed) linkMap[ref.target] = target.id;
      const fid = fileIdAt.get(t);
      if (fid) fileMap[ref.target] = fid;
    }
    const links = this.linksOf(v);
    return {
      ...this.summary(v, this.counts()),
      body: v.body,
      path: this.path(id),
      backlinks,
      links: links.map(l => ({ id: l, title: this.titleOf(l) })),
      linkMap,
      fileMap,
    };
  }

  // ---------- writing ----------
  private folderPath(id: string | null): string {
    if (!id) return '';
    const f = this.views.get(id);
    if (!f || f.type !== 'folder') throw new Error('That folder does not exist');
    return f.path;
  }

  /** Create a note file. `parent` is a folder id or a vault path. */
  private async createNoteRaw(i: {
    parent: string | null; title?: string; body?: string; tags?: string[]; template?: boolean; daily?: boolean | string;
  }): Promise<ItemSummary> {
    const r = this.ready();
    const id = newId();
    const dir = i.parent && this.views.has(i.parent) ? this.folderPath(i.parent) : i.parent ?? '';
    const path = await this.freePath(dir, safeName(i.title?.trim() || 'Untitled'), '.md');
    const tags = i.tags && i.tags.length ? [...new Set(i.tags.map(cleanTag).filter(Boolean))].sort() : undefined;
    const file = editFm(i.body ?? '', {
      id, tags, template: i.template ? true : undefined,
      daily: typeof i.daily === 'string' ? i.daily : i.daily ? true : undefined,
    }, { top: ['id'] });
    await r.commit(id, toItemText(file, { path }), this.now());
    this.refresh([id]);
    await this.flushDisk();
    return this.summary(this.views.get(id)!, this.counts());
  }

  async createNote(input: { parent?: string | null; title?: string; body?: string; tags?: string[] }): Promise<ItemSummary> {
    let parent: string | null;
    if (input.parent === undefined) parent = await this.captureFolder();
    else if (input.parent === null) parent = null;
    else if (this.isLiveFolder(input.parent)) parent = input.parent;
    else throw new Error('That folder does not exist');
    return this.createNoteRaw({ parent, title: input.title ?? '', body: input.body, tags: input.tags });
  }

  private async makeDir(parent: string | null, title: string): Promise<View> {
    const dir = this.folderPath(parent);
    const name = safeName(title.trim() || 'Untitled folder');
    const path = await this.freePath(dir, name, '');
    await this.diskTask(async () => { await this.fs.mkdir(path); });
    this.diskDirs.add(path);
    this.syncFolders();
    this.emit({ type: 'items', ids: [folderIdOf(path)] });
    return this.views.get(folderIdOf(path))!;
  }

  async createFolder(input: { title: string; parent?: string | null }): Promise<ItemSummary> {
    this.ready();
    const parent = input.parent ?? null;
    if (parent && !this.isLiveFolder(parent)) throw new Error('That folder does not exist');
    const f = await this.makeDir(parent, input.title);
    return this.summary(f, this.counts());
  }

  /** A note's file as it is, under a new id and name, in `parent` (nothing but the identity differs). */
  private async copyNote(id: string, parent: string | null, title: string): Promise<ItemSummary> {
    const r = this.ready();
    const text = r.text(id);
    if (text === null) throw new Error('Note not found');
    const fresh = newId();
    const path = await this.freePath(parent ? this.folderPath(parent) : '', safeName(title), '.md');
    // the copy is not pinned and is not the daily note of its date
    const file = editFm(toFileText(text), { id: fresh, pinned: undefined, daily: undefined }, { top: ['id'] });
    await r.commit(fresh, toItemText(file, { path }), this.now());
    this.refresh([fresh]);
    await this.flushDisk();
    return this.summary(this.views.get(fresh)!, this.counts());
  }

  /** `skip`: the copy's own root, which can lie inside the folder being copied and must not be copied into itself. */
  private async copyFolderInto(from: string, to: string, skip: string): Promise<void> {
    const kids = [...this.views.values()].filter(c => c.parent === from && !c.trashed && c.id !== skip);
    for (const c of kids) {
      if (c.type === 'note') await this.copyNote(c.id, to, c.title);
      else await this.copyFolderInto(c.id, (await this.makeDir(to, c.title)).id, skip);
    }
  }

  async copy(id: string, parent: string | null): Promise<ItemSummary> {
    this.ready();
    const v = this.views.get(id);
    if (!v || v.trashed) throw new Error('Item not found');
    if (parent && !this.isLiveFolder(parent)) throw new Error('Destination is not a folder');
    // next to the original it is “… copy”; in another folder it keeps its name (a number is added when that is taken)
    const title = (v.parent ?? null) === parent ? `${v.title} copy` : v.title;
    if (v.type === 'note') return this.copyNote(id, parent, title);
    const copy = await this.makeDir(parent, title);
    await this.copyFolderInto(id, copy.id, copy.id);
    return this.summary(this.views.get(copy.id)!, this.counts());
  }

  async duplicate(id: string): Promise<ItemSummary> {
    this.ready();
    const v = this.views.get(id);
    if (!v || v.trashed) throw new Error('Item not found');
    return this.copy(id, v.parent ?? null);
  }

  async capture(input: { text: string; title?: string }): Promise<ItemSummary> {
    const first = input.text.split('\n').find(l => l.trim()) ?? '';
    const title = input.title?.trim() || (first.length > 60 ? first.slice(0, 57) + '…' : first) || 'Quick note';
    return this.createNoteRaw({ parent: await this.captureFolder(), title, body: input.text });
  }

  /**
   * One change to one note: properties edited in place, a new body, a new place. The change is committed and
   * the file written before this returns.
   */
  private async update(
    id: string, ch: { fm?: Record<string, unknown>; body?: string; path?: string; trashed?: string | null; trashDir?: string | null },
    o: { quiet?: boolean } = {},
  ): Promise<View> {
    const r = this.ready();
    const v = this.views.get(id);
    const cur = r.text(id);
    if (!v || v.type !== 'note' || cur === null) throw new Error('Item not found');
    const parsed = parseNote(cur);
    const edits: Record<string, unknown> = { ...(ch.fm ?? {}) };
    // the file gets its identity the first time the app writes something into it; moving it, trashing it and
    // rewriting a link for another note's sake leave its content alone
    const content = !o.quiet && (ch.body !== undefined || Object.keys(edits).length > 0);
    if (content && !parsed.broken) {
      if (String(parsed.fm.id ?? '') !== id) edits.id = id;
      if (typeof parsed.fm.updated === 'string') edits.updated = this.iso();
    }
    let t = parsed.broken ? cur : editFm(cur, edits, { top: ['id'] });
    if (ch.body !== undefined) t = withBody(t, ch.body);
    const kv: Record<string, unknown> = {};
    if (ch.path !== undefined) kv._ergo_path = ch.path;
    if (ch.trashed !== undefined) { kv._ergo_trashed = ch.trashed ?? undefined; if (ch.trashed === null) kv._ergo_trashdir = undefined; }
    if (ch.trashDir !== undefined) kv._ergo_trashdir = ch.trashDir ?? undefined;
    if (Object.keys(kv).length) t = setReserved(t, kv);
    const c = await r.commit(id, t, this.now());
    if (c) this.refresh([id]);
    if (ch.trashed !== undefined) await this.followRecords(v, ch.trashed);
    await this.flushDisk();
    return this.views.get(id)!;
  }

  // ---------- records (ADR 0011) ----------
  /** The record folders a note links to: `[…](attachments/record_… "type_record")`. */
  private recordDirsOf(v: View): string[] {
    return recordDirsIn(v.linkRefs, v.path);
  }

  private recordFileIds(dir: string): string[] {
    const pre = dir + '/';
    return [...this.files].filter(([, f]) => f.path.startsWith(pre)).map(([id]) => id);
  }

  /** True when a note other than `except` still links the record. */
  private recordUsed(dir: string, except: Set<string>, liveOnly: boolean): boolean {
    for (const v of this.views.values()) {
      if (v.type !== 'note' || except.has(v.id) || (liveOnly && v.trashed)) continue;
      if (this.recordDirsOf(v).includes(dir)) return true;
    }
    return false;
  }

  /** A note went to the Trash or came back: its records go and come with it, unless another note still shows them. */
  private async followRecords(v: View, trashed: string | null) {
    const r = this.ready();
    const ids: string[] = [];
    for (const dir of this.recordDirsOf(v)) {
      if (trashed && this.recordUsed(dir, new Set([v.id]), true)) continue;
      for (const id of this.recordFileIds(dir)) {
        const t = r.text(id);
        if (t === null || (typeof reservedOf(t)._ergo_trashed === 'string') === !!trashed) continue;
        await r.commit(id, setReserved(t, { _ergo_trashed: trashed ?? undefined }), this.now());
        ids.push(id);
      }
    }
    if (ids.length) this.refresh(ids);
  }

  async saveNote(id: string, patch: { title?: string; body?: string }): Promise<ItemSummary> {
    const cur = this.views.get(id);
    if (!cur || cur.type !== 'note') throw new Error('Item not found');
    let v = cur;
    if (patch.body !== undefined && patch.body !== cur.body) v = await this.update(id, { body: patch.body });
    if (patch.title !== undefined && patch.title.trim() && safeName(patch.title) !== v.title) {
      await this.rename(id, patch.title);
      v = this.views.get(id) ?? v;
    }
    return this.summary(v, this.counts());
  }

  // ---------- moving and renaming (links follow) ----------
  /**
   * Files moved (old path -> new path): rewrite the links that pointed at them and the relative links of notes
   * that moved. One commit per note whose text changes.
   */
  private async followMoves(moves: Map<string, string>, skip: Set<string>, idx: LinkIndex) {
    const edits: { id: string; body: string; path: string }[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || v.trashed || skip.has(v.id)) continue;
      const fromNew = moves.get(v.path) ?? v.path;
      const body = rewriteLinks(v.body, { fromOld: v.path, fromNew, moved: moves, resolve: ref => resolveLink(ref, v.path, idx) });
      if (body !== v.body) edits.push({ id: v.id, body, path: fromNew });
    }
    for (const e of edits) await this.update(e.id, { body: e.body }, { quiet: true });
  }

  async rename(id: string, title: string): Promise<void> {
    const v = this.views.get(id);
    if (!v) throw new Error('Item not found');
    const name = safeName(title);
    if (v.type === 'folder') { await this.moveDir(v, dirname(v.path), name); return; }
    if (name === v.title) return;
    const to = await this.freePath(dirname(v.path), name, extOf(v.path) || '.md');
    await this.relocateNote(v, to);
  }

  private async relocateNote(v: View, to: string) {
    const moves = new Map([[v.path, to]]);
    const idx = this.linkIndex();
    // links in this note (relative ones change with its place) and in every note that points at it
    await this.update(v.id, { path: to });
    const self = this.views.get(v.id)!;
    const fromNew = to;
    const body = rewriteLinks(self.body, { fromOld: v.path, fromNew, moved: moves, resolve: ref => resolveLink(ref, v.path, idx) });
    if (body !== self.body) await this.update(v.id, { body }, { quiet: true });
    await this.followMoves(moves, new Set([v.id]), idx);
  }

  async move(id: string, parent: string | null): Promise<void> {
    const v = this.views.get(id);
    if (!v) throw new Error('Item not found');
    if (parent) {
      const p = this.views.get(parent);
      if (!p || p.type !== 'folder') throw new Error('Destination is not a folder');
      if (isBelow(this.parentOf, parent, id)) throw new Error('Cannot move a folder into itself');
    }
    const dir = this.folderPath(parent);
    if (v.type === 'folder') { await this.moveDir(v, dir, basename(v.path)); return; }
    if (dirname(v.path) === dir) return;
    const to = await this.freePath(dir, stripExt(basename(v.path)), extOf(v.path) || '.md');
    await this.relocateNote(v, to);
  }

  /** Rename or move a directory: the directory goes as a whole, every note and attachment in it follows. */
  private async moveDir(f: View, intoDir: string, name: string) {
    const to = joinPath(intoDir, name);
    if (to.toLowerCase() === f.path.toLowerCase() && to === f.path) return;
    if (to.toLowerCase().startsWith(f.path.toLowerCase() + '/')) throw new Error('Cannot move a folder into itself');
    const target = to.toLowerCase() === f.path.toLowerCase() ? to : await this.freePath(intoDir, name, '');
    const from = f.path;
    const pre = from + '/';
    const moves = new Map<string, string>();
    const affected: string[] = [];
    for (const v of this.views.values()) if (v.type === 'note' && !v.trashed && v.path.startsWith(pre)) { moves.set(v.path, target + '/' + v.path.slice(pre.length)); affected.push(v.id); }
    for (const fl of this.files.values()) if (fl.path.startsWith(pre)) moves.set(fl.path, target + '/' + fl.path.slice(pre.length));
    const idx = this.linkIndex();
    await this.diskTask(async () => {
      await this.fs.rename(from, target);
      // the index follows the directory, so the write-outs below find every file in place
      for (const [p, e] of [...this.index]) {
        if (!p.startsWith(pre)) continue;
        this.dropIndex(p);
        this.setIndex(target + '/' + p.slice(pre.length), e);
      }
    });
    this.diskDirs = new Set([...this.diskDirs].map(d => (d === from ? target : d.startsWith(pre) ? target + '/' + d.slice(pre.length) : d)));
    const r = this.ready();
    for (const [oldP, newP] of moves) {
      const id = [...this.views.values()].find(x => x.type === 'note' && x.path === oldP)?.id ?? [...this.files].find(([, x]) => x.path === oldP)?.[0];
      if (!id) continue;
      const t = r.text(id);
      if (t !== null) await r.commit(id, setReserved(t, { _ergo_path: newP }), this.now());
    }
    this.syncFolders();
    // links: notes elsewhere that pointed in, and relative links of the notes that moved
    const edits: { id: string; body: string }[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || v.trashed) continue;
      const oldFrom = affected.includes(v.id) ? [...moves].find(([, n]) => n === v.path)?.[0] ?? v.path : v.path;
      const body = rewriteLinks(v.body, { fromOld: oldFrom, fromNew: v.path, moved: moves, resolve: ref => resolveLink(ref, oldFrom, idx) });
      if (body !== v.body) edits.push({ id: v.id, body });
    }
    for (const e of edits) await this.update(e.id, { body: e.body }, { quiet: true });
    this.emit({ type: 'items', ids: [folderIdOf(target)] });
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    const t = [...new Set(tags.map(cleanTag).filter(Boolean))].sort();
    const v = this.views.get(id);
    // a tag list somebody wrote as `tag:` stays under that key
    const key = v && v.fm.tags === undefined && v.fm.tag !== undefined ? 'tag' : 'tags';
    await this.update(id, { fm: { [key]: t.length ? t : undefined } });
  }

  /** Rename a tag (and its sub-tags) on every note; one new Commit per affected note, run locally. */
  async renameTag(from: string, to: string): Promise<number> {
    const target = cleanTag(to);
    const src = cleanTag(from);
    if (!target || !src || target === src) return 0;
    let n = 0;
    for (const v of [...this.views.values()]) {
      if (v.type !== 'note') continue;
      const next = v.tags.map(t => (t === src ? target : t.startsWith(src + '/') ? target + t.slice(src.length) : t));
      if (next.some((t, i) => t !== v.tags[i])) { await this.setTags(v.id, next); n++; }
    }
    return n;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.update(id, { fm: { pinned: pinned ? true : undefined } });
  }

  async setPrivate(id: string, isPrivate: boolean): Promise<void> {
    await this.update(id, { fm: { private: isPrivate ? true : undefined } });
  }

  async setTemplate(id: string, isTemplate: boolean): Promise<void> {
    await this.update(id, { fm: { template: isTemplate ? true : undefined } });
  }

  async trash(id: string): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    if (v.type === 'note') { await this.update(id, { trashed: this.iso() }); return; }
    for (const x of this.subtree(id)) {
      const n = this.views.get(x);
      if (n && n.type === 'note' && !n.trashed) await this.update(x, { trashed: this.iso(), trashDir: id });
    }
    // the directory itself goes when nothing but empty folders is left in it
    await this.diskTask(async () => {
      const empty = async (d: string): Promise<boolean> => {
        for (const e of await this.fs.readdir(d)) {
          if (e.kind === 'file') return false;
          if (!(await empty(joinPath(d, e.name)))) return false;
        }
        return true;
      };
      if (await empty(v.path)) await this.fs.remove(v.path);
    });
    this.diskDirs = new Set([...this.diskDirs].filter(d => d !== v.path && !d.startsWith(v.path + '/')));
    this.syncFolders();
    this.emit({ type: 'items', ids: [id] });
  }

  async restore(id: string): Promise<void> {
    const v = this.views.get(id);
    if (!v) {
      // a folder that was trashed: its notes come back, and the directories with them
      for (const n of [...this.views.values()]) if (n.type === 'note' && n.trashed && n.trashDir === id) await this.restore(n.id);
      return;
    }
    if (v.type !== 'note') return;
    const dir = dirname(v.path);
    const free = await this.freePath(dir, stripExt(basename(v.path)), extOf(v.path) || '.md');
    await this.update(id, { trashed: null, path: free });
  }

  private subtree(id: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>(); // tolerate cycles
    const walk = (x: string) => {
      if (seen.has(x)) return;
      seen.add(x);
      out.push(x);
      for (const v of this.views.values()) if (v.parent === x) walk(v.id);
    };
    walk(id);
    return out;
  }

  /** True when any item at or below `id` has a concurrent edit nobody has resolved yet. */
  private hasOpenConflict(id: string): boolean {
    return this.subtree(id).some(x => this.replica!.hasConflict(x));
  }

  async purge(id: string): Promise<void> {
    this.ready();
    if (this.hasOpenConflict(id)) throw new Error('This note was also changed on another device. Resolve that first, then delete it.');
    const notes = this.subtree(id).filter(x => this.views.get(x)?.type === 'note' || x === id).reverse();
    const gone = new Set(notes);
    const dirs = new Set<string>();
    for (const x of notes) { const nv = this.views.get(x); if (nv?.type === 'note') for (const d of this.recordDirsOf(nv)) dirs.add(d); }
    for (const x of notes) if (this.replica!.text(x) !== null) await this.ready().purge(x, this.now());
    for (const d of dirs) if (!this.recordUsed(d, gone, false)) await this.purgeFiles(this.recordFileIds(d));
    for (const x of this.subtree(id)) if (this.views.get(x)?.type === 'note') this.views.delete(x);
    this.refresh([id]);
    await this.flushDisk();
  }

  async emptyTrash(): Promise<void> {
    const top = [...this.views.values()].filter(v => v.type === 'note' && v.trashed);
    // an item with an unresolved concurrent edit stays in the Trash until a person has chosen
    for (const v of top) if (this.views.has(v.id) && !this.hasOpenConflict(v.id)) await this.purge(v.id);
  }

  /** Purge items that have been in the Trash for more than 30 days. */
  private async housekeeping(now: number): Promise<void> {
    await this.settleAiConfig();
    const cutoff = now - TRASH_DAYS * DAY;
    for (const v of [...this.views.values()]) {
      if (v.type === 'note' && v.trashed && Date.parse(v.trashed) < cutoff && this.views.has(v.id) && !this.hasOpenConflict(v.id)) await this.purge(v.id);
    }
  }

  // ---------- organisation ----------
  private folderByRole(role: string): View | undefined {
    return [...this.views.values()].find(v => v.type === 'folder' && v.role === role && !this.inTrash(v));
  }

  /** An item's folder, for the helpers of folder.ts that walk up the tree. */
  private parentOf = (id: string): string | null => this.views.get(id)?.parent ?? null;

  private isLiveFolder(id: string): boolean {
    const f = this.views.get(id);
    return !!f && f.type === 'folder' && !this.inTrash(f);
  }

  private async captureFolder(): Promise<string> {
    const s = (this.meta.settings as Partial<Settings> | undefined) ?? {};
    const configured = s.captureFolder ? this.views.get(s.captureFolder) : undefined;
    if (configured && configured.type === 'folder' && !this.inTrash(configured)) return configured.id;
    const inbox = this.folderByRole('inbox');
    if (inbox) return inbox.id;
    return (await this.makeDir(null, 'Inbox')).id;
  }

  async search(query: string): Promise<ItemSummary[]> {
    this.ready();
    const q = query.trim();
    if (!q) return [];
    const c = this.counts();
    return this.searchIndex.search(q).map(r => this.views.get(String(r.id))).filter((v): v is View => !!v && !this.inTrash(v)).map(v => this.summary(v, c)).slice(0, 50);
  }

  async searchHits(query: string): Promise<SearchHit[]> {
    this.ready();
    const q = query.trim();
    if (!q) return [];
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (v: View, context: string): SearchHit => ({
      id: v.id, type: v.type, title: v.title, path: this.path(v.id), tags: v.tags, context, updated: v.updated,
    });
    const out: SearchHit[] = [];
    const seen = new Set<string>();
    for (const v of this.views.values()) {
      if (v.type !== 'folder' || this.inTrash(v)) continue;
      const t = v.title.toLowerCase();
      if (terms.every(x => t.includes(x))) { out.push(hit(v, '')); seen.add(v.id); }
    }
    for (const r of this.searchIndex.search(q)) {
      const v = this.views.get(String(r.id));
      if (!v || seen.has(v.id) || this.inTrash(v)) continue;
      seen.add(v.id);
      const text = plainSnippet(v.body, 1_000_000);
      const low = text.toLowerCase();
      let at = -1;
      for (const x of terms) { const i = low.indexOf(x); if (i >= 0 && (at < 0 || i < at)) at = i; }
      // the title or a tag matched, not the text: show the note's opening instead
      if (at < 0) { out.push(hit(v, v.snippet)); continue; }
      const from = Math.max(0, at - 40);
      out.push(hit(v, (from > 0 ? '…' : '') + text.slice(from, at + 110).trim() + (at + 110 < text.length ? '…' : '')));
    }
    return out.slice(0, MAX_SEARCH_HITS);
  }

  async linkTargets(query: string): Promise<{ id: string; title: string; path: string }[]> {
    this.ready();
    const q = query.trim().toLowerCase();
    return [...this.views.values()]
      .filter(v => v.type === 'note' && !this.inTrash(v) && (!q || v.title.toLowerCase().includes(q)))
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
      .slice(0, 12)
      .map(v => ({ id: v.id, title: v.title, path: v.path }));
  }

  async tags(): Promise<{ tag: string; count: number }[]> {
    this.ready();
    const m = new Map<string, number>();
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v)) continue;
      for (const t of v.tags) m.set(t, (m.get(t) ?? 0) + 1);
    }
    return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  }

  // ---------- tasks & calendar ----------
  async tasks(): Promise<TaskEntry[]> {
    this.ready();
    const out: TaskEntry[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v) || v.template) continue;
      for (const t of v.tasks) out.push({ ...t, noteId: v.id, noteTitle: v.title });
    }
    return out.sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.noteTitle.localeCompare(b.noteTitle));
  }

  async toggleTask(noteId: string, index: number, done: boolean): Promise<void> {
    const v = this.views.get(noteId);
    if (!v) throw new Error('Item not found');
    await this.update(noteId, { body: setTaskDone(v.body, index, done) });
  }

  async calendar(fromIso: string, toIso: string): Promise<CalendarData> {
    this.ready();
    const c = this.counts();
    const from = fromIso.slice(0, 10), to = toIso.slice(0, 10);
    const inRange = (s: string | undefined | null) => !!s && s.slice(0, 10) >= from && s.slice(0, 10) <= to;
    const localDay = (iso: string) => (iso ? isoDate(new Date(iso)) : '');
    const tasks = (await this.tasks()).filter(t => inRange(t.due) || inRange(t.remind));
    const notes: ItemSummary[] = [];
    const daily: ItemSummary[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v) || v.template) continue;
      if (v.daily && inRange(v.daily)) daily.push(this.summary(v, c));
      else if (inRange(localDay(v.created))) notes.push(this.summary(v, c));
    }
    const events: EventEntry[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v) || v.template) continue;
      for (const e of v.events) if (inRange(e.date)) events.push({ ...e, noteId: v.id, noteTitle: v.title, text: e.text || v.title });
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
    return { tasks, notes, daily, events };
  }

  // ---------- templates & daily notes ----------
  async templates(): Promise<ItemSummary[]> {
    this.ready();
    const c = this.counts();
    return [...this.views.values()].filter(v => v.type === 'note' && v.template && !this.inTrash(v)).sort(sortTitle).map(v => this.summary(v, c));
  }

  private expand(body: string, title: string): string {
    const d = new Date(this.now());
    return body
      .replace(/\{\{\s*date\s*\}\}/g, isoDate(d))
      .replace(/\{\{\s*time\s*\}\}/g, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`)
      .replace(/\{\{\s*weekday\s*\}\}/g, d.toLocaleDateString('en', { weekday: 'long' }))
      .replace(/\{\{\s*title\s*\}\}/g, title)
      .replace(/\{\{\s*cursor\s*\}\}/g, '');
  }

  async createFromTemplate(templateId: string, o: { parent?: string | null; title?: string } = {}): Promise<ItemSummary> {
    const t = this.views.get(templateId);
    if (!t || t.type !== 'note') throw new Error('Template not found');
    const title = o.title?.trim() || t.title;
    let parent: string | null;
    if (o.parent !== undefined) parent = o.parent;
    else {
      const f = typeof t.fm.folder === 'string' ? t.fm.folder : null;
      parent = f && this.views.has(f) ? f : f && this.folderByRole(f) ? this.folderByRole(f)!.id : await this.captureFolder();
    }
    return this.createNoteRaw({ parent, title, body: this.expand(t.body, title), tags: t.tags });
  }

  async dailyNote(date: string): Promise<ItemSummary> {
    this.ready();
    const existing = [...this.views.values()].find(v => v.type === 'note' && v.daily === date && !this.inTrash(v));
    if (existing) return this.summary(existing, this.counts());
    const s = (this.meta.settings as Partial<Settings> | undefined) ?? {};
    let parent: string | null = s.dailyFolder && this.isLiveFolder(s.dailyFolder) ? s.dailyFolder : null;
    if (!parent) {
      const found = [...this.views.values()].find(v => v.type === 'folder' && v.path.toLowerCase() === 'daily' && !this.inTrash(v));
      parent = found?.id ?? (await this.makeDir(null, 'Daily')).id;
      await this.setSettings({ dailyFolder: parent });
    }
    const tpl = [...this.views.values()].find(v => v.type === 'note' && v.template && v.fm.daily === true && !this.inTrash(v));
    const body = tpl ? this.expand(tpl.body, date) : '## Plan\n\n- [ ] \n\n## Notes\n\n';
    return this.createNoteRaw({ parent, title: date, body, tags: tpl?.tags, daily: date });
  }

  // ---------- conflicts & history ----------
  private conflictIds(): string[] {
    const r = this.replica!;
    // a deleted-here / edited-there note is a conflict too: the deleting device must be asked
    return r.items().filter(i => i !== AI_CONFIG_ID && !this.chats.has(i) && !this.files.has(i) && r.hasConflict(i) && (!r.isPurged(i) || r.otherHeads(i).some(h => r.g.get(h)!.kind !== 'purge')));
  }

  private conflictTitle(id: string): string {
    const v = this.views.get(id);
    if (v) return v.title;
    const r = this.replica!;
    for (const h of r.g.heads(id)) {
      const t = r.g.text(h);
      const p = t ? reservedOf(t.join('\n'))._ergo_path : undefined;
      if (typeof p === 'string' && p) return titleOfPath(p);
    }
    return 'Deleted note';
  }

  async conflicts(): Promise<{ id: string; title: string; heads: number }[]> {
    this.ready();
    return this.conflictIds().map(id => ({ id, title: this.conflictTitle(id), heads: this.replica!.g.heads(id).length }));
  }

  private deviceNameOf(id: string): string {
    if (id === this.deviceId) return this.deviceName;
    if (id === 'auto') return 'Automatic merge';
    const names = (this.meta.deviceNames as Record<string, string> | undefined) ?? {};
    return names[id] ?? `Device ${id.slice(0, 6)}`;
  }

  private headInfo(commitId: string): HeadInfo {
    const g = this.replica!.g;
    const c = g.get(commitId)!;
    const lines = g.text(commitId);
    return { commit: c.id, deviceId: c.author, deviceName: this.deviceNameOf(c.author), ts: c.ts, purge: c.kind === 'purge', text: lines ? stripReserved(lines.join('\n')) : '' };
  }

  async conflictDetail(id: string): Promise<ConflictDetail | null> {
    const r = this.ready();
    if (!r.hasConflict(id)) return null;
    const local = r.headId(id)!;
    const others = r.otherHeads(id);
    const known = (this.meta.deviceNames as Record<string, string> | undefined) ?? {};
    if ([local, ...others].some(h => { const a = r.g.get(h)!.author; return a !== this.deviceId && a !== 'auto' && !known[a]; })) {
      const store = await this.getStore().catch(() => null);
      if (store) await this.refreshDeviceNames(store).catch(() => { /* names are cosmetic */ });
    }
    const base = others.length ? baseText(r.g, local, others[0]) : null;
    return {
      id,
      title: this.conflictTitle(id),
      local: this.headInfo(local),
      others: others.map(o => this.headInfo(o)),
      base: base === null ? null : stripReserved(base),
    };
  }

  async resolveConflict(id: string, choice: ConflictChoice): Promise<void> {
    const r = this.ready();
    if (!r.hasConflict(id)) return;
    const local = r.headId(id)!;
    const others = r.otherHeads(id);
    let text: string | null;
    switch (choice.kind) {
      case 'local': text = r.g.get(local)!.kind === 'purge' ? null : r.text(id); break;
      case 'other': {
        const c = r.g.get(choice.commit);
        if (!c) throw new Error('That version no longer exists');
        text = c.kind === 'purge' ? null : (r.g.text(c.id) ?? []).join('\n');
        break;
      }
      case 'both': {
        // keep this device's text in the note and put every other version in a note of its own, beside it
        for (const o of others) {
          const c = r.g.get(o)!;
          if (c.kind === 'purge') continue;
          const otherText = (r.g.text(o) ?? []).join('\n');
          const p = parseNote(stripReserved(otherText));
          const path = reservedOf(otherText)._ergo_path;
          const name = typeof path === 'string' && path ? titleOfPath(path) : 'Untitled';
          const dir = typeof path === 'string' ? dirname(path) : '';
          const title = `${name} (from ${this.deviceNameOf(c.author)})`;
          await this.createNoteRaw({ parent: dir, title, body: p.body, tags: tagsOf(p.fm) });
        }
        text = r.g.get(local)!.kind === 'purge' ? null : r.text(id);
        break;
      }
      case 'combine': {
        let acc = r.text(id) ?? '';
        for (const o of others) {
          if (r.g.get(o)!.kind === 'purge') continue;
          acc = unionText(acc, baseText(r.g, local, o), (r.g.text(o) ?? []).join('\n'));
        }
        text = acc;
        break;
      }
      case 'text': {
        // the editor shows the note without its reserved keys; the place it has stays what this device shows
        const keep = reservedOf(r.text(id) ?? '');
        text = setReserved(choice.text, Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, v])));
        break;
      }
      case 'delete': text = null; break;
    }
    await r.resolve(id, text, this.now());
    this.refresh([id]);
    this.emit({ type: 'items', ids: [id] });
    this.noteLocalChange();
    await this.flushDisk();
  }

  async history(id: string): Promise<VersionInfo[]> {
    const r = this.ready();
    const head = r.headId(id);
    if (!head) return [];
    const seen = new Set<string>();
    const out: VersionInfo[] = [];
    const stack = [head];
    while (stack.length && out.length < 200) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      const c = r.g.get(x);
      if (!c) continue;
      out.push({ commit: c.id, deviceName: this.deviceNameOf(c.author), ts: c.ts, kind: c.kind, current: c.id === head });
      stack.push(...c.parents);
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  async versionText(id: string, commit: string): Promise<string | null> {
    const r = this.ready();
    const c = r.g.get(commit);
    if (!c || c.item !== id || c.kind === 'purge') return null;
    const l = r.g.text(commit);
    return l ? stripReserved(l.join('\n')) : null;
  }

  async restoreVersion(id: string, commit: string): Promise<void> {
    const r = this.ready();
    const c = r.g.get(commit);
    if (!c || c.item !== id || c.kind === 'purge') throw new Error('That version cannot be restored');
    const old = (r.g.text(commit) ?? []).join('\n');
    const cur = r.text(id) ?? old;
    const keep = reservedOf(cur);
    const trashed = typeof keep._ergo_trashed === 'string' && keep._ergo_trashed !== '';
    const here = typeof keep._ergo_path === 'string' ? keep._ergo_path : 'Untitled.md';
    const path = trashed ? await this.freePath(dirname(here), stripExt(basename(here)), extOf(here) || '.md') : here;
    const next = setReserved(old, { _ergo_path: path, _ergo_trashed: undefined, _ergo_eol: keep._ergo_eol, _ergo_bom: keep._ergo_bom });
    await r.commit(id, next, this.now());
    this.refresh([id]);
    await this.flushDisk();
  }

  // ---------- settings & store ----------
  async getSettings(): Promise<Settings> {
    return { captureFolder: null, dailyFolder: null, theme: 'system', ...((this.meta.settings as Partial<Settings> | undefined) ?? {}) };
  }

  async setSettings(s: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.getSettings()), ...s };
    await this.setMeta('settings', next);
    this.emit({ type: 'status' });
    return next;
  }

  // ---------- AI ----------
  /** The full configuration including API keys. Not part of VaultApi: only code that runs where the vault runs may call it. */
  aiConfig(): AiConfig {
    if (!this.aiBody) return defaultAiConfig();
    try { return normalizeAiConfig(JSON.parse(this.aiBody)); } catch { return defaultAiConfig(); } // unreadable: enter the key again
  }

  async getAiSettings(): Promise<AiSettings> {
    this.ready();
    return toSettings(this.aiConfig());
  }

  async setAiSettings(patch: AiSettingsPatch): Promise<AiSettings> {
    const r = this.ready();
    const next = applyAiPatch(this.aiConfig(), patch);
    const fm: Frontmatter = { id: AI_CONFIG_ID, _ergo_kind: 'config', updated: this.iso() };
    const c = await r.commit(AI_CONFIG_ID, joinDoc(fm, JSON.stringify(next)), this.now());
    if (c) this.refresh([AI_CONFIG_ID]);
    this.emit({ type: 'status' });
    return toSettings(next);
  }

  /** Two devices saved the AI settings (or one conversation) at the same time: the newer one wins, nobody has to choose. */
  private async settleAiConfig(): Promise<void> {
    const r = this.replica;
    if (!r) return;
    for (const id of r.items().filter(i => (i === AI_CONFIG_ID || this.chats.has(i)) && r.hasConflict(i))) {
      const local = r.headId(id)!;
      const newest = [local, ...r.otherHeads(id)].map(h => r.g.get(h)!).filter(c => c.kind !== 'purge').sort((a, b) => b.ts - a.ts)[0];
      if (newest) await this.resolveConflict(id, newest.id === local ? { kind: 'local' } : { kind: 'other', commit: newest.id });
    }
  }

  // ---------- assistant conversations ----------
  async listChats(): Promise<ChatSummary[]> {
    this.ready();
    return [...this.chats.values()].map(({ data: _d, ...s }) => s).sort((a, b) => b.updated.localeCompare(a.updated));
  }

  async getChat(id: string): Promise<ChatRecord | null> {
    this.ready();
    return this.chats.get(id) ?? null;
  }

  async saveChat(input: { id?: string; title: string; data: string }): Promise<ChatSummary> {
    const r = this.ready();
    if (input.data.length > 4_000_000) throw new Error('This conversation is too long to keep. Start a new one.');
    const id = input.id && this.chats.has(input.id) ? input.id : input.id && /^[0-9a-f-]{36}$/.test(input.id) ? input.id : newId();
    const prev = this.chats.get(id);
    const t = this.iso();
    const title = input.title.trim().slice(0, 120) || 'Conversation';
    const fm: Frontmatter = { id, _ergo_kind: 'chat', title, created: prev?.created || t, updated: t };
    await r.commit(id, joinDoc(fm, input.data.replace(/\r?\n/g, ' ')), this.now());
    this.refresh([id]);
    const c = this.chats.get(id)!;
    return { id: c.id, title: c.title, created: c.created, updated: c.updated };
  }

  async deleteChat(id: string): Promise<void> {
    const r = this.ready();
    if (!this.chats.has(id)) return;
    await r.purge(id, this.now());
    this.chats.delete(id);
    this.refresh([id]);
  }

  private async buildStore(cfg: StoreConfig): Promise<Store> {
    if (cfg.type === 's3') return new S3Store(cfg, this.opts.fetchImpl);
    if (cfg.type === 'webdav') return new WebDavStore(cfg, this.opts.fetchImpl);
    if (this.opts.storeFactory) return this.opts.storeFactory(cfg);
    throw new Error(`${cfg.type} storage is not available on this device`);
  }

  private async getStore(): Promise<Store | null> {
    if (this.store !== undefined) return this.store;
    const cfg = this.meta.store as StoreConfig | undefined;
    this.store = cfg ? await this.buildStore(cfg) : null;
    return this.store;
  }

  async setStore(cfg: StoreConfig | null): Promise<void> {
    this.ready();
    this.stopAutoSync();
    if (!cfg) {
      this.store = null;
      await this.setMeta('store', undefined);
      delete this.meta.store;
      this.emit({ type: 'status' });
      return;
    }
    const s = await this.buildStore(cfg);
    if (s instanceof S3Store) await s.ensureBucket().catch(() => { /* the bucket may already exist or be managed elsewhere */ });
    const existing = await s.get('vault.json');
    if (existing) {
      const f = JSON.parse(dec(existing)) as VaultFile;
      if (f.wrappedKey !== this.vaultFile!.wrappedKey && f.created !== this.vaultFile!.created) {
        throw new Error('That storage already holds a different vault. Join it from a new device instead.');
      }
    } else {
      await s.put('vault.json', enc(JSON.stringify(this.vaultFile)));
    }
    this.store = s;
    await this.setMeta('store', cfg);
    this.emit({ type: 'status' });
    await this.sync({ full: true });
  }

  // ---------- sync ----------
  private ctx(store: Store): SyncContext { return { store, sealer: this.sealer!, now: this.opts.now }; }

  async sync(o: { full?: boolean } = {}): Promise<SyncReport> {
    if (this.syncing) return this.syncing;
    const run = async (): Promise<SyncReport> => {
      const rep: SyncReport = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, compacted: 0 };
      try {
        const store = await this.getStore();
        const r = this.ready();
        // what was edited in other programs goes into this pass
        await this.rescan();
        let now = this.now();
        if (store) { try { now += await r.storeClockOffset(this.ctx(store)); } catch { /* offline: local clock */ } }
        if (!store) { await this.housekeeping(now); return rep; }
        const ctx = this.ctx(store);
        // once a day look at everything on the Store, not only at what the inbox announced
        const lastFull = (this.meta.lastFullAt as number | undefined) ?? 0;
        const full = o.full === true || this.now() - lastFull > DAY;
        const pull = await r.pull(ctx, { full });
        if (full) await this.setMeta('lastFullAt', this.now());
        rep.pulled = pull.fetched + pull.overlays;
        rep.merged = pull.merged;
        // after the pull, so a concurrent edit is known before anything is purged; the Store's clock when known:
        // a wrong device clock must not purge the Trash
        await this.housekeeping(now);
        const push = await r.push(ctx);
        rep.pushed = push.pushed;
        const last = (this.meta.lastCompactAt as number | undefined) ?? 0;
        if (this.now() - last > DAY) {
          const c = await r.compact(ctx);
          rep.compacted = c.dropped;
          await this.setMeta('lastCompactAt', this.now());
          await this.refreshDeviceNames(store);
        }
        rep.conflicts = this.conflictIds().length;
        this.lastSyncError = null;
        await this.setMeta('lastSyncAt', this.now());
      } catch (e) {
        this.lastSyncError = e instanceof Error ? e.message : String(e);
        rep.error = this.lastSyncError;
      }
      await this.flushDisk();
      this.emit({ type: 'status' });
      return rep;
    };
    this.syncing = run().finally(() => { this.syncing = null; });
    this.emit({ type: 'status' });
    return this.syncing;
  }

  private async refreshDeviceNames(store: Store) {
    const names: Record<string, string> = { ...((this.meta.deviceNames as Record<string, string> | undefined) ?? {}) };
    for (const k of await store.list('devices/')) {
      const blob = await store.get(k.key);
      if (!blob) continue;
      try {
        const rec = await this.sealer!.openJson<{ name: string }>(blob);
        names[k.key.slice('devices/'.length)] = rec.name;
      } catch { /* ignore */ }
    }
    await this.setMeta('deviceNames', names);
  }

  /** Push right now (closing a note, switching device, pressing Sync). */
  async flush(): Promise<void> {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = null; }
    await this.rescan().catch(() => 0);
    const store = await this.getStore().catch(() => null);
    if (!store || !this.replica) return;
    // look for news first: a delta must not be pushed on top of a base another device just compacted away
    try { await this.replica.pull(this.ctx(store)); } catch { /* offline: push what we can */ }
    try { await this.replica.push(this.ctx(store)); } catch (e) { this.lastSyncError = e instanceof Error ? e.message : String(e); }
    await this.flushDisk();
    this.emit({ type: 'status' });
  }

  private noteLocalChange() {
    if (!this.pullTimer || this.pushTimer) return; // auto sync not running, or a push is already scheduled
    this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.flush(); }, PUSH_DEBOUNCE_MS);
  }

  startAutoSync(): void {
    this.startWatching();
    if (this.pullTimer) return;
    this.pullTimer = setInterval(() => {
      if (!this.replica || this.syncing) return;
      const last = (this.meta.lastSyncAt as number | undefined) ?? 0;
      // once an hour run the whole pass (push, trash purge, compaction); in between just look for news
      if (this.now() - last > 60 * MIN) { void this.sync(); return; }
      void this.getStore().then(s => s && this.replica!.pull(this.ctx(s))).catch(e => { this.lastSyncError = String(e); });
    }, PULL_EVERY_MS);
    void this.sync();
  }

  /** Stop background work and let anything already started finish writing (server shutdown, tests). */
  async close(): Promise<void> {
    this.stopAutoSync();
    this.stopWatching();
    try { await this.syncing; } catch { /* reported through status */ }
    await this.flushDisk();
    await this.saveIndexNow();
    await this.persist.close?.();
  }

  stopAutoSync(): void {
    if (this.pullTimer) clearInterval(this.pullTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pullTimer = null;
    this.pushTimer = null;
  }

  // ---------- attachments ----------
  /** Written to `attachments/` as a real file and kept as an item so it syncs and is encrypted in the Store. */
  async addFile(input: FileBlob & { dir?: string }): Promise<{ id: string; path: string }> {
    const r = this.ready();
    if (input.data.length > Math.ceil((MAX_ATTACHMENT * 4) / 3) + 1024) throw new Error('That file is larger than 100 MB.');
    const sha = sha256hex(input.data);
    let id: string;
    let path: string;
    if (input.dir !== undefined) {
      // a file of a record folder: exactly this name, in this folder, replaced when it is written again
      const dir = normalizePath(input.dir);
      if (!dir || !isRecordDir(dir.split('/').slice(0, 2).join('/')) || dir.split('/').some(sg => sg.startsWith('.'))) throw new Error('A record file belongs in attachments/record_….');
      const name = safeName(input.name, 100);
      if (!ATTACH_EXT.has(extOf(name))) throw new Error('That kind of file cannot be kept in a record.');
      path = joinPath(dir, name);
      const at = this.byLower.get(path.toLowerCase());
      const known = at ? this.index.get(at) : undefined;
      id = known && known.kind === 'file' ? known.id : newId();
      if (known && known.kind === 'file' && at) path = at;
      else if (known || (await this.fs.stat(path))) path = await this.freePath(dir, stripExt(name), extOf(name));
    } else {
      const existing = this.fileBySha.get(sha);
      // stored once per distinct content, but never pointing into a record: removing that frame would break the other use
      if (existing && this.files.has(existing) && !recordDirOf(this.files.get(existing)!.path)) return { id: existing, path: this.files.get(existing)!.path };
      id = newId();
      const name = safeName(stripExt(input.name) === input.name ? input.name : input.name, 100);
      const ext = extOf(name);
      path = await this.freePath(ATTACH_DIR, ext ? name.slice(0, -ext.length) : name, ext);
    }
    const fm: Frontmatter = { id, _ergo_kind: 'file', _ergo_path: path, name: basename(path), mime: input.mime, sha, size: b64Bytes(input.data), created: this.iso() };
    const body = input.data.replace(/(.{76})/g, '$1\n');
    await r.commit(id, joinDoc(fm, body), this.now());
    this.refresh([id]);
    await this.flushDisk();
    return { id, path };
  }

  /** Delete attachments by path: the file items go (and the files with them). Only `attachments/` can be reached. */
  async removeFiles(paths: string[]): Promise<number> {
    this.ready();
    const want = new Set(paths.map(p => normalizePath(p) ?? '').filter(p => p.startsWith(ATTACH_DIR + '/')));
    const ids = [...this.files].filter(([, f]) => want.has(f.path)).map(([id]) => id);
    await this.purgeFiles(ids);
    return ids.length;
  }

  private async purgeFiles(ids: string[]) {
    const r = this.ready();
    for (const id of ids) if (r.text(id) !== null) await r.purge(id, this.now());
    this.refresh(ids);
    await this.flushDisk();
  }

  private recordInfo(dir: string): RecordInfo | null {
    const pre = dir + '/';
    const mine = [...this.files].filter(([, f]) => f.path.startsWith(pre) && !f.trashed);
    if (!mine.length) return null;
    let meta: RecordMeta | null = null;
    let transcript: string | null = null;
    const audio: { path: string; n: string }[] = [];
    const frames: { second: number; path: string }[] = [];
    let size = 0;
    for (const [, f] of mine) {
      const rel = f.path.slice(pre.length);
      size += f.size;
      const text = () => dec(fromB64(f.body.replace(/\s+/g, '')));
      if (rel === 'record.json') meta = parseRecordMeta(text());
      else if (rel === 'transcript.txt') transcript = text();
      else if (rel.startsWith('frames/')) { const sec = frameSecond(rel); if (sec !== null) frames.push({ second: sec, path: f.path }); }
      else if (!rel.includes('/') && /^audio(-\d+)?\.[a-z0-9]+$/i.test(rel)) audio.push({ path: f.path, n: rel });
    }
    // the joined file wins over its pieces (the pieces are removed once it exists)
    const joined = audio.filter(a => !isPartName(a.n));
    const parts = joined.length ? joined : audio.sort((a, b) => a.n.localeCompare(b.n));
    let user: View | undefined;
    for (const v of this.views.values()) if (v.type === 'note' && !this.inTrash(v) && this.recordDirsOf(v).includes(dir)) { user = v; break; }
    return {
      path: dir, meta, audio: parts.map(a => a.path), frames: frames.sort((a, b) => a.second - b.second), transcript, size,
      noteId: user?.id ?? null, noteTitle: user?.title ?? null,
    };
  }

  async getRecord(path: string): Promise<RecordInfo | null> {
    this.ready();
    const dir = normalizePath(path);
    return dir && isRecordDir(dir) ? this.recordInfo(dir) : null;
  }

  async listRecords(): Promise<RecordInfo[]> {
    this.ready();
    const dirs = new Set<string>();
    for (const f of this.files.values()) { const d = recordDirOf(f.path); if (d && !f.trashed) dirs.add(d); }
    return [...dirs].map(d => this.recordInfo(d)).filter((x): x is RecordInfo => !!x)
      .sort((a, b) => (b.meta?.startedAt ?? b.path).localeCompare(a.meta?.startedAt ?? a.path));
  }

  async listFiles(): Promise<FileInfo[]> {
    this.ready();
    const idx = this.linkIndex();
    const users = new Map<string, View>();
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v)) continue;
      for (const ref of v.linkRefs) {
        const t = resolveLink(ref, v.path, idx);
        if (t && !users.has(t)) users.set(t, v);
      }
    }
    const out: FileInfo[] = [];
    for (const [id, f] of this.files) {
      if (f.trashed || recordDirOf(f.path)) continue; // a record's files are listed as the record (listRecords)
      const user = users.get(f.path);
      out.push({ id, name: f.name, path: f.path, mime: f.mime, size: f.size, created: f.created, noteId: user?.id ?? null, noteTitle: user?.title ?? null });
    }
    return out.sort((a, b) => b.created.localeCompare(a.created));
  }

  async getFile(id: string): Promise<FileBlob | null> {
    this.ready();
    const f = this.files.get(id);
    return f ? { name: f.name, mime: f.mime, data: f.body.replace(/\s+/g, '') } : null;
  }

  async getFileByPath(path: string): Promise<FileBlob | null> {
    this.ready();
    const clean = normalizePath(path);
    if (!clean) return null;
    const lower = clean.toLowerCase();
    for (const [id, f] of this.files) if (f.path.toLowerCase() === lower) return this.getFile(id);
    // a bare file name (`![[diagram.png]]` in another tool's notes): the nearest file of that name
    if (!clean.includes('/')) {
      const hits = [...this.files].filter(([, f]) => f.name.toLowerCase() === lower).sort((a, b) => a[1].path.split('/').length - b[1].path.split('/').length);
      if (hits.length) return this.getFile(hits[0][0]);
    }
    // a file too large to be an item, or one that arrived a moment ago: read it from the folder
    const ext = extOf(clean);
    if (!ATTACH_EXT.has(ext) || clean.split('/').some(s => s.startsWith('.'))) return null;
    const st = await this.fs.stat(clean);
    if (!st || st.kind !== 'file' || st.size > 200 * 1024 * 1024) return null;
    const raw = await this.fs.read(clean);
    return raw ? { name: basename(clean), mime: MIME[ext] ?? 'application/octet-stream', data: toB64(raw) } : null;
  }

  // ---------- import / export ----------
  /** Copy Markdown files into the vault under `parent`; they become notes on the next look at the folder. */
  async importMarkdown(files: ImportFile[], parent: string | null = null): Promise<{ notes: number; folders: number }> {
    const r = await this.importFiles(files.filter(f => /\.(md|markdown|txt)$/i.test(f.path)), parent ?? this.folderByRole('resources')?.id ?? null);
    return { notes: r.notes, folders: r.folders };
  }

  /**
   * Take files into the vault under `parent` with their folders: Markdown becomes notes, the kinds of file a note can
   * embed (images, PDF, audio…) are copied to the same relative place so links between them keep working. The rest is
   * counted as skipped. They become items on the look at the folder that follows.
   */
  async importFiles(files: ImportFile[], parent: string | null = null): Promise<ImportResult> {
    this.ready();
    const base = parent ? this.folderPath(parent) : '';
    const out: ImportResult = { notes: 0, files: 0, folders: 0, skipped: 0 };
    const dirs = new Set<string>();
    const known = (d: string) => this.diskDirs.has(d) || [...this.views.values()].some(v => v.type === 'folder' && v.path === d);
    for (const f of files) {
      const raw = f.path.replace(/\\/g, '/');
      const ext = extOf(raw);
      const isNote = /\.(md|markdown|txt)$/i.test(raw);
      const bytes = f.data !== undefined ? fromB64(f.data) : f.content !== undefined ? enc(f.content) : null;
      if (!bytes || (!isNote && (!ATTACH_EXT.has(ext) || SCAN_ONLY_IN_RECORD.has(ext))) || bytes.length > (isNote ? MAX_NOTE_BYTES : MAX_ATTACHMENT)) { out.skipped++; continue; }
      const segs = raw.split('/').filter(s => s && s !== '.' && s !== '..').map(s => safeName(s));
      const file = segs.pop();
      if (!file) { out.skipped++; continue; }
      const dir = joinPath(base, ...segs);
      // the folders this file makes (the ones above that are already there do not count)
      for (let d = dir; d && !dirs.has(d) && !known(d); d = dirname(d)) dirs.add(d);
      const path = isNote ? await this.freePath(dir, stripExt(file).replace(/\.txt$/i, ''), '.md') : await this.freePath(dir, file.slice(0, file.lastIndexOf('.')), file.slice(file.lastIndexOf('.')));
      await this.diskTask(async () => { await this.fs.write(path, bytes); });
      if (isNote) out.notes++; else out.files++;
    }
    await this.rescan();
    out.folders = dirs.size;
    return out;
  }

  async exportNote(id: string, format: 'md' | 'html'): Promise<ExportResult> {
    this.ready();
    const v = this.views.get(id);
    if (!v || v.type !== 'note') throw new Error('Note not found');
    const safe = safeName(v.title);
    const idx = this.linkIndex();
    const byPath = this.noteByPath();
    const fileAt = (p: string) => [...this.files.values()].find(f => f.path === p);
    // attachments become data URIs, links to other notes become plain text: the export stands alone
    let plainBody = '';
    let pos = 0;
    for (const ref of v.linkRefs) {
      const t = resolveLink(ref, v.path, idx);
      const f = t ? fileAt(t) : undefined;
      let text: string | null = null;
      const rec = t && ref.kind === 'md' && isRecordDir(t) ? this.recordInfo(t) : null;
      if (rec) {
        // a record has no single file to embed: its name stays, with what was said (frames and audio stay in the vault)
        const said = parseTranscript(rec.transcript ?? '').map(b => `**${fmtMark(b.at)}** ${b.text}`).join('\n\n');
        text = said ? `${ref.label}\n\n<details>\n<summary>Transcript</summary>\n\n${said}\n\n</details>` : ref.label;
      } else if (f) {
        const uri = `data:${f.mime};base64,${f.body.replace(/\s+/g, '')}`;
        text = ref.kind === 'md' ? `${ref.embed ? '!' : ''}[${ref.label}](${uri}${ref.title})` : ref.embed ? `![${f.name}](${uri})` : f.name;
      } else if (t && byPath.has(t) && !ref.embed) text = ref.kind === 'md' ? ref.label : titleOfPath(t);
      if (text === null) continue;
      plainBody += v.body.slice(pos, ref.start) + text;
      pos = ref.end;
    }
    plainBody += v.body.slice(pos);
    if (format === 'md') {
      const text = this.replica!.text(id) ?? '';
      return { filename: `${safe}.md`, mime: 'text/markdown', content: withBody(stripReserved(text), plainBody) };
    }
    const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
    const audio: string[] = [];
    const prepared = plainBody
      .replace(/```ergonote-excalidraw[\s\S]*?```/g, '*(drawing – open in Ergonotes)*')
      .replace(/<div style="page-break-after:\s*always;?"><\/div>/gi, '\nPAGEBREAKMARK\n')
      .replace(/<summary>([^<\n]*)<\/summary>/gi, '\nTOGGLETITLE:$1\n')
      .replace(/<details[^>]*>/gi, '\nTOGGLEOPEN\n')
      .replace(/<\/details>/gi, '\nTOGGLECLOSE\n')
      .replace(/\[([^\]]*)\]\((data:audio\/[^)\s]+)\s+"audio"\)/g, (_m, label: string, uri: string) => { audio.push(uri); return `AUDIOMARK${audio.length - 1}:${label}`; })
      .replace(/^\$\$[ \t]*$/gm, '```\n')
      .replace(/^(\s*)[-*+] \[( |x|X)\] /gm, (_m, sp: string, c: string) => `${sp}- ${c === ' ' ? '☐' : '☑'} `)
      .replace(/\s*@(due|remind)\(([^)]+)\)/g, ' _($1 $2)_')
      .replace(/\s*@event\(([^)]+)\)/g, ' _(event $1)_')
      .replace(/@date\((\d{4}-\d{2}-\d{2})\)/g, '$1')
      .replace(/\s*@flag\b/g, ' ⚑');
    const body = md.render(prepared)
      .replace(/<p>PAGEBREAKMARK<\/p>/g, '<div style="break-after:page"></div><hr>')
      .replace(/<p>TOGGLEOPEN<\/p>/g, '<details open>')
      .replace(/<p>TOGGLETITLE:(.*?)<\/p>/g, '<summary>$1</summary>')
      .replace(/<p>TOGGLECLOSE<\/p>/g, '</details>')
      .replace(/AUDIOMARK(\d+):([^<]*)/g, (_m, i: string, label: string) => `<audio controls src="${audio[Number(i)]}"></audio> ${label}`);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${md.utils.escapeHtml(v.title)}</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Inter,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#2d2d2d}
h1{font-size:2em}code,pre{background:#f4f4f6;border-radius:4px}pre{padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}
blockquote{border-left:3px solid #2dbe60;margin-left:0;padding-left:16px;color:#555}img{max-width:100%}details{border:1px solid #ddd;border-radius:6px;padding:6px 12px;margin:8px 0}summary{cursor:pointer;font-weight:600}</style></head>
<body><h1>${md.utils.escapeHtml(v.title)}</h1>${v.tags.length ? `<p>${v.tags.map(t => `<code>${md.utils.escapeHtml(t)}</code>`).join(' ')}</p>` : ''}
${body}</body></html>`;
    return { filename: `${safe}.html`, mime: 'text/html', content: html };
  }
}

function storeLabel(cfg: StoreConfig): string {
  if (cfg.type === 's3') return `${cfg.bucket} @ ${new URL(cfg.endpoint).host}`;
  if (cfg.type === 'webdav') return new URL(cfg.url).host;
  return cfg.path;
}

export { WrongPasswordError };
// kept for hosts that show where a note lives relative to another
export { relativePath as relativeVaultPath };
