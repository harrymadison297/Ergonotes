// The Vault: the domain layer over a Replica. Items are Notes and Folders; the folder tree is the `parent`
// field (ADR 0005). Everything the UI can do goes through the VaultApi implemented here.
import MarkdownIt from 'markdown-it';
import MiniSearch from 'minisearch';
import type {
  CalendarData, ConflictChoice, ConflictDetail, ExportResult, FileBlob, HeadInfo, ImportFile, ItemSummary, NoteDoc,
  Settings, StoreConfig, SyncReport, TaskEntry, VaultApi, VaultState, VaultStatus, VersionInfo,
} from './api.ts';
import {
  DEFAULT_KDF, Sealer, WrongPasswordError, checkPassword, createVaultFile, unwrapMasterKey, wrapMasterKey,
  type VaultFile,
} from './crypto.ts';
import {
  extractLinkIds, firstImage, joinDoc, parseTasks, plainSnippet, setTaskDone, splitDoc, WIKILINK_RE,
  type Frontmatter, type Task,
} from './markdown.ts';
import { baseText, unionText } from './merge.ts';
import type { Persist } from './persist.ts';
import { Replica, type SyncContext } from './replica.ts';
import type { Store } from './store.ts';
import { S3Store } from './store-s3.ts';
import { WebDavStore } from './store-webdav.ts';
import { DAY, dec, enc, fromB64, MIN, newId, toB64 } from './util.ts';

export interface VaultOptions {
  persist: Persist;
  /** build a Store for configs the core cannot handle itself (folder stores in Node) */
  storeFactory?: (cfg: StoreConfig) => Promise<Store> | Store;
  fetchImpl?: typeof fetch;
  kdf?: { m: number; t: number; p: number };
  now?: () => number;
  defaultDeviceName?: string;
}

interface View {
  id: string;
  type: 'note' | 'folder';
  fm: Frontmatter;
  title: string;
  parent: string | null;
  tags: string[];
  created: string;
  updated: string;
  trashed: string | null;
  pinned: boolean;
  template: boolean;
  role: string | null;
  daily: string | null;
  body: string;
  snippet: string;
  thumb: string | null;
  tasks: Task[];
  links: string[];
}

export type VaultEvent = { type: 'items'; ids: string[] } | { type: 'status' };

const TRASH_DAYS = 30;
const PUSH_DEBOUNCE_MS = 5 * MIN;
const PULL_EVERY_MS = 45_000;

const DEFAULT_FOLDERS: { title: string; role: string }[] = [
  { title: 'Inbox', role: 'inbox' },
  { title: 'Projects', role: 'projects' },
  { title: 'Areas', role: 'areas' },
  { title: 'Resources', role: 'resources' },
  { title: 'Archive', role: 'archive' },
  { title: 'Templates', role: 'templates' },
];

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

export class Vault implements VaultApi {
  private persist: Persist;
  private opts: VaultOptions;
  private meta: Record<string, unknown> = {};
  private replica: Replica | null = null;
  private sealer: Sealer | null = null;
  private masterKey: Uint8Array | null = null;
  private vaultFile: VaultFile | null = null;
  private views = new Map<string, View>();
  private files = new Map<string, { name: string; mime: string; body: string }>();
  private search_ = new MiniSearch<{ id: string; title: string; body: string; tags: string }>({
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

  private constructor(opts: VaultOptions) {
    this.opts = opts;
    this.persist = opts.persist;
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
    if (v.vaultFile && remembered) {
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
    };
  }

  private async activate(masterKey: Uint8Array): Promise<void> {
    this.masterKey = masterKey;
    this.sealer = new Sealer(masterKey);
    this.replica = await Replica.open(this.persist, this.deviceId, this.deviceName);
    this.unsub = this.replica.onChange(items => { this.refresh(items); this.emit({ type: 'items', ids: items }); this.noteLocalChange(); });
    this.views.clear();
    this.files.clear();
    for (const id of this.replica.items()) this.refresh([id], true);
    this.emit({ type: 'status' });
  }

  async createVault(password: string, o: { deviceName?: string; remember?: boolean } = {}): Promise<void> {
    if (this.vaultFile) throw new Error('A vault already exists on this device');
    const problem = checkPassword(password);
    if (problem) throw new Error(problem);
    const { file, masterKey } = await createVaultFile(password, this.opts.kdf ?? DEFAULT_KDF);
    this.vaultFile = file;
    await this.setMeta('vaultFile', file);
    if (o.deviceName) await this.setMeta('deviceName', o.deviceName);
    if (o.remember) await this.setMeta('rememberedKey', toB64(masterKey));
    await this.activate(masterKey);
    await this.seedDefaults();
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
    await this.sync({ full: true });
  }

  async unlock(password: string, o: { remember?: boolean } = {}): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault on this device');
    if (this.replica) return;
    const key = await unwrapMasterKey(password, this.vaultFile);
    if (o.remember) await this.setMeta('rememberedKey', toB64(key));
    await this.activate(key);
  }

  /** Check a password without changing any state (used by the server to sign a browser in). */
  async verifyPassword(password: string): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault on this device');
    await unwrapMasterKey(password, this.vaultFile);
  }

  async lock(): Promise<void> {
    this.stopAutoSync();
    this.unsub?.();
    this.replica = null;
    this.sealer = null;
    this.masterKey = null;
    this.views.clear();
    this.search_.removeAll();
    await this.setMeta('rememberedKey', undefined);
    delete this.meta.rememberedKey;
    this.emit({ type: 'status' });
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.vaultFile) throw new Error('No vault');
    const problem = checkPassword(newPassword);
    if (problem) throw new Error(problem);
    const key = await unwrapMasterKey(oldPassword, this.vaultFile);
    const file = await wrapMasterKey(newPassword, key, this.opts.kdf ?? DEFAULT_KDF, this.vaultFile.epoch);
    file.created = this.vaultFile.created;
    this.vaultFile = file;
    await this.setMeta('vaultFile', file);
    const s = await this.getStore();
    if (s) await s.put('vault.json', enc(JSON.stringify(file)));
  }

  async setDeviceName(name: string): Promise<void> {
    await this.setMeta('deviceName', name.trim() || 'This device');
    if (this.replica) this.replica.deviceName = this.deviceName;
    this.emit({ type: 'status' });
  }

  private async seedDefaults() {
    const ids: Record<string, string> = {};
    for (const f of DEFAULT_FOLDERS) {
      const it = await this.createFolderRaw({ title: f.title, parent: null, role: f.role });
      ids[f.role] = it.id;
    }
    for (const t of DEFAULT_TEMPLATES) {
      await this.createNoteRaw({ parent: ids.templates, title: t.title, body: t.body, tags: t.tags, template: true, daily: t.daily });
    }
    const welcome = await this.createNoteRaw({
      parent: ids.inbox,
      title: 'Welcome to Ergonotes',
      body: [
        'Your notes live on your devices first and sync through storage you own.',
        '',
        '- Everything new lands in **Inbox**; move it to Projects, Areas, Resources or Archive when you know where it belongs.',
        '- Link notes with `[[` and see backlinks under each note.',
        '- Turn a line into a task with the checkbox button; tasks show up in **Tasks** and the **Calendar**.',
        '- Draw with the **Insert → Drawing** menu.',
        '',
        '- [ ] Try creating a note from a template',
        '',
      ].join('\n'),
    });
    void welcome;
  }

  // ---------- views & index ----------
  private refresh(ids: string[], quiet = false) {
    const r = this.ready();
    for (const id of ids) {
      const text = r.text(id);
      const prev = this.views.get(id);
      if (prev) { try { this.search_.discard(id); } catch { /* not indexed */ } }
      if (text === null) { this.views.delete(id); this.files.delete(id); continue; }
      const { fm, body } = splitDoc(text);
      if (fm.type === 'file') { this.files.set(id, { name: String(fm.name ?? 'file'), mime: String(fm.mime ?? 'application/octet-stream'), body }); this.views.delete(id); continue; }
      const type = fm.type === 'folder' ? 'folder' : 'note';
      const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
      const view: View = {
        id, type, fm,
        title: typeof fm.title === 'string' && fm.title ? fm.title : 'Untitled',
        parent: typeof fm.parent === 'string' ? fm.parent : null,
        tags,
        created: typeof fm.created === 'string' ? fm.created : '',
        updated: typeof fm.updated === 'string' ? fm.updated : '',
        trashed: typeof fm.trashed === 'string' ? fm.trashed : null,
        pinned: fm.pinned === true,
        template: fm.template === true,
        role: typeof fm.role === 'string' ? fm.role : null,
        daily: typeof fm.daily === 'string' ? fm.daily : null,
        body,
        snippet: type === 'note' ? plainSnippet(body) : '',
        thumb: firstImage(body) ?? null,
        tasks: type === 'note' ? parseTasks(body) : [],
        links: extractLinkIds(body),
      };
      this.views.set(id, view);
      if (type === 'note') this.search_.add({ id, title: view.title, body: plainSnippet(body, 4000), tags: tags.join(' ') });
    }
    void quiet;
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
      trashed: v.trashed, inTrash: this.inTrash(v), pinned: v.pinned, template: v.template, role: v.role,
      snippet: v.snippet, thumb: v.thumb, conflicted: this.replica!.hasConflict(v.id),
      tasksOpen: open.length, tasksDone: v.tasks.length - open.length, nextReminder: reminders[0] ?? null,
      childCount: childCounts.get(v.id) ?? 0,
    };
  }

  private counts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const v of this.views.values()) if (v.parent) m.set(v.parent, (m.get(v.parent) ?? 0) + 1);
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

  // ---------- reading ----------
  async listItems(): Promise<ItemSummary[]> {
    this.ready();
    const c = this.counts();
    return [...this.views.values()].map(v => this.summary(v, c));
  }

  async getNote(id: string): Promise<NoteDoc | null> {
    this.ready();
    const v = this.views.get(id);
    if (!v) return null;
    const backlinks = [...this.views.values()].filter(x => x.links.includes(id) && x.id !== id && !this.inTrash(x)).map(x => ({ id: x.id, title: x.title }));
    return {
      ...this.summary(v, this.counts()),
      body: v.body,
      path: this.path(id),
      backlinks,
      links: v.links.filter(l => this.views.has(l)).map(l => ({ id: l, title: this.titleOf(l) })),
    };
  }

  // ---------- writing ----------
  private compose(fm: Frontmatter, body: string): string { return joinDoc(fm, body); }

  private async createNoteRaw(i: {
    parent: string | null; title?: string; body?: string; tags?: string[]; template?: boolean; daily?: boolean | string; role?: string;
  }): Promise<ItemSummary> {
    const id = newId();
    const t = this.iso();
    const fm: Frontmatter = {
      id, type: 'note', title: i.title?.trim() || 'Untitled', parent: i.parent ?? undefined,
      tags: i.tags && i.tags.length ? [...new Set(i.tags.map(cleanTag).filter(Boolean))].sort() : undefined,
      created: t, updated: t,
      template: i.template ? true : undefined,
      daily: typeof i.daily === 'string' ? i.daily : i.daily ? true : undefined,
    };
    await this.ready().commit(id, this.compose(fm, i.body ?? ''), this.now());
    this.refresh([id]);
    return this.summary(this.views.get(id)!, this.counts());
  }

  private async createFolderRaw(i: { title: string; parent: string | null; role?: string }): Promise<ItemSummary> {
    const id = newId();
    const t = this.iso();
    const fm: Frontmatter = { id, type: 'folder', title: i.title.trim() || 'Untitled folder', parent: i.parent ?? undefined, created: t, updated: t, role: i.role };
    await this.ready().commit(id, this.compose(fm, ''), this.now());
    this.refresh([id]);
    return this.summary(this.views.get(id)!, this.counts());
  }

  async createNote(input: { parent?: string | null; title?: string; body?: string; tags?: string[] }): Promise<ItemSummary> {
    const parent = input.parent === undefined ? await this.captureFolder() : input.parent;
    return this.createNoteRaw({ parent, title: input.title ?? '', body: input.body, tags: input.tags });
  }

  async createFolder(input: { title: string; parent?: string | null }): Promise<ItemSummary> {
    return this.createFolderRaw({ title: input.title, parent: input.parent ?? null });
  }

  async capture(input: { text: string; title?: string }): Promise<ItemSummary> {
    const first = input.text.split('\n').find(l => l.trim()) ?? '';
    const title = input.title?.trim() || (first.length > 60 ? first.slice(0, 57) + '…' : first) || 'Quick note';
    return this.createNoteRaw({ parent: await this.captureFolder(), title, body: input.text });
  }

  private async mutate(id: string, fn: (fm: Frontmatter, body: string) => { fm?: Frontmatter; body?: string } | void): Promise<View> {
    const v = this.views.get(id);
    if (!v) throw new Error('Item not found');
    const fm = { ...v.fm };
    const r = fn(fm, v.body) ?? {};
    const nfm = r.fm ?? fm;
    const body = r.body ?? v.body;
    const text = this.compose({ ...nfm, id, updated: this.iso() }, body);
    const c = await this.ready().commit(id, text, this.now());
    if (c) this.refresh([id]);
    return this.views.get(id)!;
  }

  async saveNote(id: string, patch: { title?: string; body?: string }): Promise<ItemSummary> {
    const v = await this.mutate(id, (fm, body) => {
      if (patch.title !== undefined) fm.title = patch.title.trim() || 'Untitled';
      return { fm, body: patch.body ?? body };
    });
    return this.summary(v, this.counts());
  }

  async rename(id: string, title: string): Promise<void> {
    await this.mutate(id, fm => { fm.title = title.trim() || 'Untitled'; });
  }

  private isDescendant(id: string, ancestor: string): boolean {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur && !seen.has(cur)) {
      if (cur === ancestor) return true;
      seen.add(cur);
      cur = this.views.get(cur)?.parent ?? null;
    }
    return false;
  }

  async move(id: string, parent: string | null): Promise<void> {
    if (parent) {
      const p = this.views.get(parent);
      if (!p || p.type !== 'folder') throw new Error('Destination is not a folder');
      if (this.isDescendant(parent, id)) throw new Error('Cannot move a folder into itself');
    }
    await this.mutate(id, fm => { if (parent) fm.parent = parent; else delete fm.parent; });
  }

  async setTags(id: string, tags: string[]): Promise<void> {
    const t = [...new Set(tags.map(cleanTag).filter(Boolean))].sort();
    await this.mutate(id, fm => { if (t.length) fm.tags = t; else delete fm.tags; });
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.mutate(id, fm => { if (pinned) fm.pinned = true; else delete fm.pinned; });
  }

  async setTemplate(id: string, isTemplate: boolean): Promise<void> {
    await this.mutate(id, fm => { if (isTemplate) fm.template = true; else delete fm.template; });
  }

  async trash(id: string): Promise<void> {
    await this.mutate(id, fm => { fm.trashed = this.iso(); });
  }

  async restore(id: string): Promise<void> {
    const v = this.views.get(id);
    if (!v) return;
    // a note whose folder is gone lands in the capture folder (ADR / Q34)
    const parentOk = !v.parent || (this.views.has(v.parent) && !this.inTrash(this.views.get(v.parent)!));
    const target = parentOk ? v.parent : await this.captureFolder();
    await this.mutate(id, fm => { delete fm.trashed; if (target) fm.parent = target; else delete fm.parent; });
  }

  private subtree(id: string): string[] {
    const out = [id];
    for (const v of this.views.values()) if (v.parent === id) out.push(...this.subtree(v.id));
    return out;
  }

  async purge(id: string): Promise<void> {
    for (const x of this.subtree(id).reverse()) await this.ready().purge(x, this.now());
    for (const x of this.subtree(id)) this.views.delete(x);
    this.refresh([id]);
  }

  async emptyTrash(): Promise<void> {
    const top = [...this.views.values()].filter(v => v.trashed);
    for (const v of top) if (this.views.has(v.id)) await this.purge(v.id);
  }

  /** Purge items that have been in the Trash for more than 30 days. */
  private async housekeeping(): Promise<void> {
    const cutoff = this.now() - TRASH_DAYS * DAY;
    for (const v of [...this.views.values()]) {
      if (v.trashed && Date.parse(v.trashed) < cutoff && this.views.has(v.id)) await this.purge(v.id);
    }
  }

  // ---------- organisation ----------
  private folderByRole(role: string): View | undefined {
    return [...this.views.values()].find(v => v.type === 'folder' && v.role === role && !this.inTrash(v));
  }

  private async captureFolder(): Promise<string> {
    const s = (this.meta.settings as Partial<Settings> | undefined) ?? {};
    const configured = s.captureFolder ? this.views.get(s.captureFolder) : undefined;
    if (configured && configured.type === 'folder' && !this.inTrash(configured)) return configured.id;
    const inbox = this.folderByRole('inbox');
    if (inbox) return inbox.id;
    return (await this.createFolderRaw({ title: 'Inbox', parent: null, role: 'inbox' })).id;
  }

  async search(query: string): Promise<ItemSummary[]> {
    this.ready();
    const q = query.trim();
    if (!q) return [];
    const c = this.counts();
    return this.search_.search(q).map(r => this.views.get(String(r.id))).filter((v): v is View => !!v && !this.inTrash(v)).map(v => this.summary(v, c)).slice(0, 50);
  }

  async linkTargets(query: string): Promise<{ id: string; title: string }[]> {
    this.ready();
    const q = query.trim().toLowerCase();
    return [...this.views.values()]
      .filter(v => v.type === 'note' && !this.inTrash(v) && (!q || v.title.toLowerCase().includes(q)))
      .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
      .slice(0, 12)
      .map(v => ({ id: v.id, title: v.title }));
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
    await this.mutate(noteId, (_fm, body) => ({ body: setTaskDone(body, index, done) }));
  }

  async calendar(fromIso: string, toIso: string): Promise<CalendarData> {
    this.ready();
    const c = this.counts();
    const inRange = (s: string | undefined | null) => !!s && s >= fromIso && s <= toIso;
    const tasks = (await this.tasks()).filter(t => inRange(t.due) || inRange(t.remind));
    const notes: ItemSummary[] = [];
    const daily: ItemSummary[] = [];
    for (const v of this.views.values()) {
      if (v.type !== 'note' || this.inTrash(v) || v.template) continue;
      if (v.daily && inRange(v.daily)) daily.push(this.summary(v, c));
      else if (inRange(v.created)) notes.push(this.summary(v, c));
    }
    return { tasks, notes, daily };
  }

  // ---------- templates & daily notes ----------
  async templates(): Promise<ItemSummary[]> {
    this.ready();
    const c = this.counts();
    return [...this.views.values()].filter(v => v.template && !this.inTrash(v)).sort(sortTitle).map(v => this.summary(v, c));
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
    if (!t) throw new Error('Template not found');
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
    const existing = [...this.views.values()].find(v => v.daily === date && !this.inTrash(v));
    if (existing) return this.summary(existing, this.counts());
    const s = (this.meta.settings as Partial<Settings> | undefined) ?? {};
    let parent: string | null = s.dailyFolder && this.views.has(s.dailyFolder) ? s.dailyFolder : null;
    if (!parent) {
      const areas = this.folderByRole('areas');
      const existingDaily = [...this.views.values()].find(v => v.type === 'folder' && v.title === 'Daily' && v.parent === (areas?.id ?? null) && !this.inTrash(v));
      parent = existingDaily?.id ?? (await this.createFolderRaw({ title: 'Daily', parent: areas?.id ?? null })).id;
      await this.setSettings({ dailyFolder: parent });
    }
    const tpl = [...this.views.values()].find(v => v.template && v.fm.daily === true && !this.inTrash(v));
    const body = tpl ? this.expand(tpl.body, date) : '## Plan\n\n- [ ] \n\n## Notes\n\n';
    return this.createNoteRaw({ parent, title: date, body, tags: tpl?.tags, daily: date });
  }

  // ---------- conflicts & history ----------
  private conflictIds(): string[] {
    const r = this.replica!;
    return r.items().filter(i => r.hasConflict(i) && !r.isPurged(i));
  }

  async conflicts(): Promise<{ id: string; title: string; heads: number }[]> {
    this.ready();
    return this.conflictIds().map(id => ({ id, title: this.titleOf(id), heads: this.replica!.g.heads(id).length }));
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
    return { commit: c.id, deviceId: c.author, deviceName: this.deviceNameOf(c.author), ts: c.ts, purge: c.kind === 'purge', text: lines ? lines.join('\n') : '' };
  }

  async conflictDetail(id: string): Promise<ConflictDetail | null> {
    const r = this.ready();
    if (!r.hasConflict(id)) return null;
    const local = r.headId(id)!;
    const others = r.otherHeads(id);
    return {
      id,
      title: this.titleOf(id),
      local: this.headInfo(local),
      others: others.map(o => this.headInfo(o)),
      base: others.length ? baseText(r.g, local, others[0]) : null,
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
        let acc = r.text(id) ?? '';
        for (const o of others) {
          if (r.g.get(o)!.kind === 'purge') continue;
          acc = unionText(acc, baseText(r.g, local, o), (r.g.text(o) ?? []).join('\n'));
        }
        text = acc;
        break;
      }
      case 'text': text = choice.text; break;
      case 'delete': text = null; break;
    }
    await r.resolve(id, text, this.now());
    this.refresh([id]);
    this.emit({ type: 'items', ids: [id] });
    this.noteLocalChange();
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
    return l ? l.join('\n') : null;
  }

  async restoreVersion(id: string, commit: string): Promise<void> {
    const t = await this.versionText(id, commit);
    if (t === null) throw new Error('That version cannot be restored');
    const { fm, body } = splitDoc(t);
    await this.mutate(id, cur => ({ fm: { ...fm, id, parent: fm.parent ?? cur.parent, trashed: undefined }, body }));
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
        if (!store) return rep;
        const ctx = this.ctx(store);
        const pull = await r.pull(ctx, { full: o.full });
        rep.pulled = pull.fetched + pull.overlays;
        rep.merged = pull.merged;
        const push = await r.push(ctx);
        rep.pushed = push.pushed;
        await this.housekeeping();
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
    const store = await this.getStore().catch(() => null);
    if (!store || !this.replica) return;
    try { await this.replica.push(this.ctx(store)); } catch (e) { this.lastSyncError = e instanceof Error ? e.message : String(e); }
    this.emit({ type: 'status' });
  }

  private noteLocalChange() {
    if (!this.pullTimer || this.pushTimer) return; // auto sync not running, or a push is already scheduled
    this.pushTimer = setTimeout(() => { this.pushTimer = null; void this.flush(); }, PUSH_DEBOUNCE_MS);
  }

  startAutoSync(): void {
    if (this.pullTimer) return;
    this.pullTimer = setInterval(() => {
      if (this.replica && !this.syncing) void this.getStore().then(s => s && this.replica!.pull(this.ctx(s))).catch(e => { this.lastSyncError = String(e); });
    }, PULL_EVERY_MS);
    void this.sync();
  }

  stopAutoSync(): void {
    if (this.pullTimer) clearInterval(this.pullTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pullTimer = null;
    this.pushTimer = null;
  }

  // ---------- attachments ----------
  /** Stored as an immutable `file` item (base64 body) so it syncs and encrypts like everything else. */
  async addFile(input: FileBlob): Promise<{ id: string }> {
    const r = this.ready();
    if (input.data.length > 34_000_000) throw new Error('That file is larger than 25 MB.');
    const id = newId();
    const fm: Frontmatter = { id, type: 'file', name: input.name, mime: input.mime, size: Math.floor((input.data.length * 3) / 4), created: this.iso() };
    const body = input.data.replace(/(.{76})/g, '$1\n');
    await r.commit(id, joinDoc(fm, body), this.now());
    this.refresh([id]);
    return { id };
  }

  async getFile(id: string): Promise<FileBlob | null> {
    this.ready();
    const f = this.files.get(id);
    return f ? { name: f.name, mime: f.mime, data: f.body.replace(/\s+/g, '') } : null;
  }

  // ---------- import / export ----------
  async importMarkdown(files: ImportFile[], parent: string | null = null): Promise<{ notes: number; folders: number }> {
    this.ready();
    const root = parent ?? this.folderByRole('resources')?.id ?? null;
    const folderIds = new Map<string, string>();
    let folders = 0;
    const ensureFolder = async (segs: string[]): Promise<string | null> => {
      let cur: string | null = root;
      let key = '';
      for (const s of segs) {
        key += '/' + s;
        let id = folderIds.get(key);
        if (!id) {
          id = (await this.createFolderRaw({ title: s, parent: cur })).id;
          folderIds.set(key, id);
          folders++;
        }
        cur = id;
      }
      return cur;
    };
    const created: { id: string; title: string; body: string; tags: string[]; fm: Frontmatter }[] = [];
    for (const f of files) {
      if (!/\.(md|markdown|txt)$/i.test(f.path)) continue;
      const segs = f.path.replace(/\\/g, '/').split('/').filter(Boolean);
      const file = segs.pop()!;
      const dir = await ensureFolder(segs);
      const { fm, body } = splitDoc(f.content);
      const h1 = /^#\s+(.+)$/m.exec(body)?.[1];
      const title = (typeof fm.title === 'string' && fm.title) || h1 || file.replace(/\.(md|markdown|txt)$/i, '');
      const rawTags = fm.tags ?? fm.tag;
      const tags = Array.isArray(rawTags) ? rawTags.map(String) : typeof rawTags === 'string' ? rawTags.split(/[,\s]+/) : [];
      const note = await this.createNoteRaw({ parent: dir, title, body, tags });
      created.push({ id: note.id, title, body, tags, fm });
    }
    // second pass: [[Title]] -> [[id|Title]]
    const byTitle = new Map(created.map(c => [c.title.toLowerCase(), c.id]));
    for (const c of created) {
      let changed = false;
      const body = c.body.replace(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, t: string, alias?: string) => {
        const id = byTitle.get(t.trim().toLowerCase());
        if (!id) return m;
        changed = true;
        return `[[${id}|${(alias ?? t).trim()}]]`;
      });
      if (changed) await this.mutate(c.id, () => ({ body }));
    }
    return { notes: created.length, folders };
  }

  async exportNote(id: string, format: 'md' | 'html'): Promise<ExportResult> {
    this.ready();
    const v = this.views.get(id);
    if (!v) throw new Error('Note not found');
    const safe = v.title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'note';
    const inlineFiles = (b: string) => b.replace(/\(ergo-file:([0-9a-f-]{36})\)/g, (m, fid: string) => {
      const f = this.files.get(fid);
      return f ? `(data:${f.mime};base64,${f.body.replace(/\s+/g, '')})` : m;
    });
    const plainBody = inlineFiles(v.body).replace(WIKILINK_RE, (_m, _id, t: string) => `[[${t}]]`);
    if (format === 'md') {
      const fm: Frontmatter = { title: v.title, tags: v.tags.length ? v.tags : undefined, created: v.created, updated: v.updated };
      return { filename: `${safe}.md`, mime: 'text/markdown', content: joinDoc(fm, plainBody) };
    }
    const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
    const prepared = plainBody
      .replace(/```ergonote-excalidraw[\s\S]*?```/g, '*(drawing – open in Ergonotes)*')
      .replace(/^(\s*)[-*+] \[( |x|X)\] /gm, (_m, sp: string, c: string) => `${sp}- ${c === ' ' ? '☐' : '☑'} `)
      .replace(/\s*@(due|remind)\(([^)]+)\)/g, ' _($1 $2)_')
      .replace(/\s*@flag\b/g, ' ⚑');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${md.utils.escapeHtml(v.title)}</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Inter,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#2d2d2d}
h1{font-size:2em}code,pre{background:#f4f4f6;border-radius:4px}pre{padding:12px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}
blockquote{border-left:3px solid #00a82d;margin-left:0;padding-left:16px;color:#555}img{max-width:100%}</style></head>
<body><h1>${md.utils.escapeHtml(v.title)}</h1>${v.tags.length ? `<p>${v.tags.map(t => `<code>${md.utils.escapeHtml(t)}</code>`).join(' ')}</p>` : ''}
${md.render(prepared)}</body></html>`;
    return { filename: `${safe}.html`, mime: 'text/html', content: html };
  }
}

function storeLabel(cfg: StoreConfig): string {
  if (cfg.type === 's3') return `${cfg.bucket} @ ${new URL(cfg.endpoint).host}`;
  if (cfg.type === 'webdav') return new URL(cfg.url).host;
  return cfg.path;
}

export { WrongPasswordError };
