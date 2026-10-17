// The API the UI talks to. `Vault` implements it in-process (desktop/mobile shells); the web build calls the
// same methods over HTTP RPC against the Server peer.
import type { S3Config } from './store-s3.ts';
import type { WebDavConfig } from './store-webdav.ts';
import type { NoteEvent, Task } from './markdown.ts';
import type { AiSettings, AiSettingsPatch } from './ai/types.ts';
import type { RecordMeta } from './record.ts';

export interface FolderStoreConfig { type: 'folder'; path: string }
export type StoreConfig = S3Config | WebDavConfig | FolderStoreConfig;

export type ItemType = 'note' | 'folder';
export type VaultState = 'no-vault' | 'locked' | 'ready';

export interface VaultStatus {
  state: VaultState;
  deviceId: string;
  deviceName: string;
  store: { type: StoreConfig['type']; label: string } | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  syncing: boolean;
  /** commits waiting to be pushed */
  pending: number;
  conflicts: number;
  remembered: boolean;
  /** true when this build can only reach a vault through a server (web) */
  remote: boolean;
  /** server only: this browser session is signed in */
  authenticated?: boolean;
  /** something about the vault folder the person should know (a very large folder, a file that could not be written) */
  notice?: string | null;
  /** false: the vault is open without a password (ADR 0012) */
  hasPassword: boolean;
  /** this Device may keep a vault with no password, and so may set or remove one */
  passwordOptional: boolean;
  /** the first look at the folder is still running: how many files have been read of how many */
  scan: { done: number; total: number } | null;
}

export interface ItemSummary {
  id: string;
  type: ItemType;
  title: string;
  parent: string | null;
  tags: string[];
  created: string;
  updated: string;
  trashed: string | null;
  inTrash: boolean;
  pinned: boolean;
  template: boolean;
  /** hidden from the AI chat and from agents that use the MCP endpoint */
  private: boolean;
  role: string | null;
  /** where the file (a folder: the directory) is, relative to the vault folder */
  filePath: string;
  snippet: string;
  thumb: string | null;
  conflicted: boolean;
  tasksOpen: number;
  tasksDone: number;
  nextReminder: string | null;
  childCount: number;
}

export interface NoteDoc extends ItemSummary {
  body: string;
  path: { id: string; title: string }[];
  backlinks: { id: string; title: string }[];
  links: { id: string; title: string }[];
  /** every link in the body, as written, to the note it points at (`[Plan](../Plan.md)` -> id) */
  linkMap: Record<string, string>;
  /** the same for links and embeds that point at an attachment (href as written -> file id) */
  fileMap: Record<string, string>;
}

export interface TaskEntry extends Task {
  noteId: string;
  noteTitle: string;
}

export interface HeadInfo {
  commit: string;
  deviceId: string;
  deviceName: string;
  ts: number;
  purge: boolean;
  text: string;
}
export interface ConflictDetail {
  id: string;
  title: string;
  local: HeadInfo;
  others: HeadInfo[];
  base: string | null;
}
export type ConflictChoice =
  | { kind: 'local' }
  | { kind: 'other'; commit: string }
  | { kind: 'both' }
  | { kind: 'combine' }
  | { kind: 'text'; text: string }
  | { kind: 'delete' };

export interface VersionInfo { commit: string; deviceName: string; ts: number; kind: string; current: boolean }

export interface SyncReport {
  pulled: number;
  pushed: number;
  merged: number;
  conflicts: number;
  compacted: number;
  error?: string;
}

export interface Settings {
  captureFolder: string | null;
  dailyFolder: string | null;
  theme: 'system' | 'light' | 'dark';
}

export interface EventEntry extends NoteEvent {
  noteId: string;
  noteTitle: string;
}

export interface CalendarData {
  tasks: TaskEntry[];
  events: EventEntry[];
  notes: ItemSummary[];
  daily: ItemSummary[];
}

export interface FileBlob { name: string; mime: string; data: string }
/** A file to take into the Vault: Markdown by its text, anything else by its bytes (base64). `path` is relative to where it lands. */
export interface ImportFile { path: string; content?: string; data?: string }
export interface ImportResult { notes: number; files: number; folders: number; skipped: number }
/** One record folder (ADR 0011) as the player needs it. Paths are vault-relative. */
export interface RecordInfo {
  /** `attachments/record_…` */
  path: string;
  meta: RecordMeta | null;
  /** the audio, in order: the joined file, or the pieces of a recording that has not been joined */
  audio: string[];
  frames: { second: number; path: string }[];
  /** the text of transcript.txt */
  transcript: string | null;
  /** bytes of everything in the folder */
  size: number;
  /** a note that shows it, if any */
  noteId: string | null;
  noteTitle: string | null;
}
/** One attachment: what it is, how big, and the note that uses it. */
export interface FileInfo { id: string; name: string; path: string; mime: string; size: number; created: string; noteId: string | null; noteTitle: string | null }
/** One row of the search popup: where it lives and the passage that matched. */
export interface SearchHit {
  id: string;
  type: ItemType;
  title: string;
  /** folder titles from the root down to the item's folder */
  path: { id: string; title: string }[];
  tags: string[];
  /** passage around the first match in the body, or the note's opening when only the title or a tag matched; empty for folders */
  context: string;
  updated: string;
}

/** A saved assistant conversation. `data` is opaque to the core (the app serialises its own chat state). */
export interface ChatSummary { id: string; title: string; created: string; updated: string }
export interface ChatRecord extends ChatSummary { data: string }

export interface ExportResult { filename: string; mime: string; content: string }

export interface VaultApi {
  status(): Promise<VaultStatus>;
  /** `setupToken` is only read by a Server peer that was started with one */
  createVault(password: string, opts?: { deviceName?: string; remember?: boolean; setupToken?: string; noPassword?: boolean }): Promise<void>;
  joinVault(store: StoreConfig, password: string, opts?: { deviceName?: string; remember?: boolean; setupToken?: string }): Promise<void>;
  unlock(password: string, opts?: { remember?: boolean }): Promise<void>;
  lock(): Promise<void>;
  /** Also how a password is first set on a vault with no password (`oldPassword` is ignored then). */
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  /** Back to a vault with no password (ADR 0012); only where `status().passwordOptional`. */
  removePassword(password: string): Promise<void>;
  /** Forget a password-less vault that has no Store, to join an existing one instead. */
  leaveVault(): Promise<void>;
  setDeviceName(name: string): Promise<void>;

  listItems(): Promise<ItemSummary[]>;
  getNote(id: string): Promise<NoteDoc | null>;
  createNote(input: { parent?: string | null; title?: string; body?: string; tags?: string[] }): Promise<ItemSummary>;
  saveNote(id: string, patch: { title?: string; body?: string }): Promise<ItemSummary>;
  createFolder(input: { title: string; parent?: string | null }): Promise<ItemSummary>;
  capture(input: { text: string; title?: string }): Promise<ItemSummary>;
  rename(id: string, title: string): Promise<void>;
  /** A copy next to the original, named “… copy”; a folder is copied with everything in it. Attachments and records are shared, not copied. */
  duplicate(id: string): Promise<ItemSummary>;
  /** A copy in the folder `parent` (null: the top). Next to the original it is named “… copy”, elsewhere it keeps its name. */
  copy(id: string, parent: string | null): Promise<ItemSummary>;
  move(id: string, parent: string | null): Promise<void>;
  setTags(id: string, tags: string[]): Promise<void>;
  renameTag(from: string, to: string): Promise<number>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  /** Private notes never reach an AI provider or an MCP agent. */
  setPrivate(id: string, isPrivate: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<void>;

  search(query: string): Promise<ItemSummary[]>;
  /** Notes (with the matching passage) and folders whose name matches; for the search popup. */
  searchHits(query: string): Promise<SearchHit[]>;
  /** Notes a link can point at, with the path to link to (relative to the vault folder). */
  linkTargets(query: string): Promise<{ id: string; title: string; path: string }[]>;
  tags(): Promise<{ tag: string; count: number }[]>;
  tasks(): Promise<TaskEntry[]>;
  toggleTask(noteId: string, index: number, done: boolean): Promise<void>;
  calendar(fromIso: string, toIso: string): Promise<CalendarData>;
  templates(): Promise<ItemSummary[]>;
  createFromTemplate(templateId: string, opts?: { parent?: string | null; title?: string }): Promise<ItemSummary>;
  setTemplate(id: string, isTemplate: boolean): Promise<void>;
  dailyNote(date: string): Promise<ItemSummary>;

  conflicts(): Promise<{ id: string; title: string; heads: number }[]>;
  conflictDetail(id: string): Promise<ConflictDetail | null>;
  resolveConflict(id: string, choice: ConflictChoice): Promise<void>;
  history(id: string): Promise<VersionInfo[]>;
  versionText(id: string, commit: string): Promise<string | null>;
  restoreVersion(id: string, commit: string): Promise<void>;

  /** assistant conversations, newest first; they sync like notes but are not notes */
  listChats(): Promise<ChatSummary[]>;
  getChat(id: string): Promise<ChatRecord | null>;
  saveChat(input: { id?: string; title: string; data: string }): Promise<ChatSummary>;
  deleteChat(id: string): Promise<void>;

  getSettings(): Promise<Settings>;
  setSettings(s: Partial<Settings>): Promise<Settings>;
  /** AI provider settings as a client may see them (the API key itself is never returned). */
  getAiSettings(): Promise<AiSettings>;
  setAiSettings(patch: AiSettingsPatch): Promise<AiSettings>;
  setStore(store: StoreConfig | null): Promise<void>;
  sync(opts?: { full?: boolean }): Promise<SyncReport>;
  flush(): Promise<void>;

  /**
   * Writes the file into `attachments/`; `path` is what a note embeds. With `dir` (a record folder, ADR 0011) it is
   * written there under exactly `name`, and written again it is replaced.
   */
  addFile(input: FileBlob & { dir?: string }): Promise<{ id: string; path: string }>;
  /** Delete attachments (by vault path) for good. */
  removeFiles(paths: string[]): Promise<number>;
  listFiles(): Promise<FileInfo[]>;
  /** Record folders, newest first. */
  listRecords(): Promise<RecordInfo[]>;
  getRecord(path: string): Promise<RecordInfo | null>;
  getFile(id: string): Promise<FileBlob | null>;
  /** An attachment by its vault-relative path (what `![](attachments/x.png)` resolves to). */
  getFileByPath(path: string): Promise<FileBlob | null>;

  importMarkdown(files: ImportFile[], parent?: string | null): Promise<{ notes: number; folders: number }>;
  /** Notes and the attachments beside them, with their folders kept (a folder dropped from the computer). `null`: the top of the Vault. */
  importFiles(files: ImportFile[], parent?: string | null): Promise<ImportResult>;
  exportNote(id: string, format: 'md' | 'html'): Promise<ExportResult>;
}

export const VAULT_METHODS = [
  'status', 'createVault', 'joinVault', 'unlock', 'lock', 'changePassword', 'removePassword', 'leaveVault', 'setDeviceName',
  'listItems', 'getNote', 'createNote', 'saveNote', 'createFolder', 'capture', 'rename', 'duplicate', 'copy', 'move', 'setTags',
  'renameTag', 'setPinned', 'setPrivate', 'trash', 'restore', 'purge', 'emptyTrash', 'search', 'searchHits', 'linkTargets', 'tags', 'tasks', 'toggleTask',
  'calendar', 'templates', 'createFromTemplate', 'setTemplate', 'dailyNote', 'conflicts', 'conflictDetail',
  'resolveConflict', 'history', 'versionText', 'restoreVersion', 'listChats', 'getChat', 'saveChat', 'deleteChat', 'getSettings', 'setSettings', 'getAiSettings', 'setAiSettings', 'setStore',
  'sync', 'flush', 'addFile', 'removeFiles', 'listFiles', 'listRecords', 'getRecord', 'getFile', 'getFileByPath', 'importMarkdown', 'importFiles', 'exportNote',
] as const satisfies readonly (keyof VaultApi)[];

type Unlisted = Exclude<keyof VaultApi, (typeof VAULT_METHODS)[number]>;
/**
 * Every method of `VaultApi` has to be in `VAULT_METHODS`, or the web build (which builds its `VaultApi` from the list) would
 * have it as `undefined`. This stops compiling when one is left out, and the error names it: `{ unlisted: "copy" }`.
 */
export const VAULT_METHODS_ARE_COMPLETE: [Unlisted] extends [never] ? true : { unlisted: Unlisted } = true;
